/**
 * Batch-embed the caselaw corpus into the pgvector `embedding` column.
 * Resumable: only processes rows where embedding IS NULL.
 *
 * Dev (Replit Postgres): uses the local caselaw_documents table.
 * Production worker (CASELAW_BACKEND=rds): adds/backfills an `embedding
 * vector(1024)` column on the RDS `judgments` table via Bedrock Titan.
 *
 * Usage: tsx src/embed-corpus.ts [maxRows] [batchSize] [scope]
 *   scope: all (default) | sc | hc | dc — restricts which court_type is embedded
 *   (RDS backend only), letting a small SC pass finish ahead of the HC bulk.
 *   Parallel workers: EMBED_SHARDS=N EMBED_SHARD=i  (id % N = i; own checkpoint).
 *
 * Env (ops knobs — dial down on Bedrock ThrottlingException or RDS load):
 *   EMBED_CONCURRENCY — parallel Bedrock invokes per batch slice (default 16, max 64)
 *   EMBED_BATCH — default batchSize when argv[3] omitted (default 100)
 *   EMBED_TRUNCATE_CHARS — Titan input truncate (default 8000; see embeddings.ts)
 *
 * Keep model on amazon.titan-embed-text-v2:0 (low-cost). Do not switch bulk
 * vectors to Cohere Embed or chat LLMs.
 *
 * Progress visibility (RDS): every batch upserts embed_progress (embedded
 * total for this run, cumulative lastId, updated_at) so /caselaw/stats can
 * report backfill progress without a 20M-row count(*).
 */
import { db, caselawDocumentsTable, pool } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { embedText, caseEmbeddingText, embeddingProvider, EMBEDDING_DIM } from "./lib/embeddings";
import { rdsBackendEnabled } from "./lib/rdsCaselaw";
import { logger } from "./lib/logger";
import { isStatementTimeout } from "./lib/caselaw";


async function withStatementTimeoutRetry<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isStatementTimeout(err)) throw err;
    logger.warn({ label }, "embed RDS hit statement_timeout; retrying once");
    await new Promise((r) => setTimeout(r, 750));
    return await run();
  }
}

function envPositiveInt(name: string, fallback: number, max?: number): number {
  const n = Number(process.env[name] ?? "");
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (max != null && n > max) return max;
  return Math.floor(n);
}

const maxRows = Number(process.argv[2] ?? 5000);
const batchSize = Number(process.argv[3] ?? envPositiveInt("EMBED_BATCH", 100, 500));
/** Parallel Bedrock embeds per slice. Raise carefully (16–24); drop to 8 on throttle/RDS pressure. */
const concurrency = envPositiveInt("EMBED_CONCURRENCY", 16, 64);
const scope = (process.argv[4] ?? "all") as "all" | "sc" | "hc" | "dc";
if (!["all", "sc", "hc", "dc"].includes(scope)) {
  logger.error({ scope }, "invalid scope; expected all|sc|hc|dc");
  process.exit(1);
}
const shardCount = envPositiveInt("EMBED_SHARDS", 1, 16);
const shardIndexRaw = Number(process.env.EMBED_SHARD ?? "0");
const shardIndex = Number.isFinite(shardIndexRaw) ? Math.floor(shardIndexRaw) : 0;
if (shardIndex < 0 || shardIndex >= shardCount) {
  logger.error({ shardIndex, shardCount }, "invalid EMBED_SHARD; expected 0..EMBED_SHARDS-1");
  process.exit(1);
}
/*
 * NYS-EMBED-NEWEST-FIRST-001 — EMBED_YEAR_MIN, parsed here (before progressScope) because
 * a windowed run MUST get its own checkpoint row. Sharing the un-windowed scope's row would
 * jump last_id to ~20.5M and permanently skip the 2024-and-older backlog.
 */
const yearMinRaw = Number(process.env.EMBED_YEAR_MIN ?? "");
const yearMin =
  Number.isFinite(yearMinRaw) && yearMinRaw >= 1900 && yearMinRaw <= 2100
    ? Math.floor(yearMinRaw)
    : null;
const shardSuffix = shardCount > 1 ? `:s${shardIndex}of${shardCount}` : "";
const yearSuffix = yearMin != null ? `:y${yearMin}` : "";
const progressScope = `${scope}${shardSuffix}${yearSuffix}`;

async function embedDevCorpus() {
  let done = 0;
  while (done < maxRows) {
    const rows = await db
      .select()
      .from(caselawDocumentsTable)
      .where(isNull(caselawDocumentsTable.embedding))
      .limit(Math.min(batchSize, maxRows - done));
    if (rows.length === 0) break;
    for (const row of rows) {
      const emb = await embedText(caseEmbeddingText(row));
      await pool.query(
        "UPDATE caselaw_documents SET embedding = $1::vector WHERE id = $2",
        [`[${emb.join(",")}]`, row.id],
      );
    }
    done += rows.length;
    logger.info({ done }, "embedded batch (dev corpus)");
  }
  logger.info({ done, provider: embeddingProvider() }, "dev corpus embedding complete");
}

async function embedRdsCorpus() {
  const { getRdsPool } = await import("./lib/rdsPool");
  const pool2 = await getRdsPool();
  // Dedicated client: the shared pool's 25s statement_timeout is tuned for
  // search paths and is too tight for batch scans over the full table.
  const rds = await pool2.connect();
  await rds.query("SET statement_timeout = '600s'");
  await rds.query("CREATE EXTENSION IF NOT EXISTS vector");
  await rds.query(
    `ALTER TABLE judgments ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`,
  );
  await rds.query(
    `CREATE TABLE IF NOT EXISTS embed_progress (
       scope text PRIMARY KEY,
       embedded_in_run bigint NOT NULL DEFAULT 0,
       total_embedded bigint,
       last_id bigint NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  // Prefer checkpoint over count(*) — exact count on ~20M judgments can stall
  // for many minutes and contends with concurrent ingest-rds.
  const prior = await rds.query<{ total_embedded: string | null; last_id: string }>(
    `SELECT total_embedded, last_id FROM embed_progress WHERE scope = $1`,
    [progressScope],
  );
  let totalEmbedded = Number(prior.rows[0]?.total_embedded ?? 0);
  if (!Number.isFinite(totalEmbedded) || totalEmbedded <= 0) {
    // Approx via pg_class when no checkpoint yet (ops-safe; not exact).
    try {
      const approx = await rds.query<{ n: string }>(
        `SELECT COALESCE(reltuples, 0)::bigint::text AS n
         FROM pg_class WHERE relname = 'judgments'`,
      );
      // We do not know embedded fraction from reltuples; leave 0 and let batches climb.
      void approx;
      totalEmbedded = 0;
    } catch {
      totalEmbedded = 0;
    }
  }
  logger.info(
    {
      scope,
      progressScope,
      shardIndex,
      shardCount,
      totalEmbedded,
      resumedLastId: Number(prior.rows[0]?.last_id ?? 0),
      batchSize,
      concurrency,
    },
    "embed start (checkpoint; skipped count(*))",
  );
  const scopeCond = scope === "all" ? "" : ` AND court_type = '${scope}'`;
  const shardCond = shardCount > 1 ? ` AND id % $3 = $4` : "";

  /*
   * NYS-EMBED-NEWEST-FIRST-001 (2026-08-18) — EMBED_YEAR_MIN: embed recent years first.
   *
   * The walk is `id > last_id ORDER BY id`, and ids increase monotonically with year
   * (measured: 2026 = 19,730,303-20,528,841; 2025 = 17,697,117-19,730,302). So the default
   * pass goes OLDEST -> NEWEST, which left HC 2025 and 2026 — 2.79M of the most-cited
   * judgments — at 0% embedded while shards worked through 2024.
   *
   * `yearFloorId` is why this is a year *floor* rather than only a `year >= n` predicate:
   * the predicate alone would still make the pkey scan walk (and discard) every already
   * embedded row below the window. That cost grows as the corpus fills and is the likely
   * source of the `canceling statement due to statement timeout` errors already in the log.
   * Starting the scan at MIN(id) for the window skips those rows at the index level.
   *
   * The `year >= n` condition is ALSO kept, because relying on id ordering alone would
   * silently embed the wrong rows if ingest ever back-fills an old judgment with a new id.
   */
  const yearCond = yearMin != null ? ` AND year >= ${yearMin}` : "";
  /*
   * NYS-EMBED-NEWEST-FIRST-001 — the floor is a CONSTANT, deliberately not a query.
   *
   * The obvious `SELECT min(id) WHERE year >= n AND court_type = s` **times out**, measured:
   * it and three variants (`ORDER BY id LIMIT 1`, year-only, per-year `GROUP BY`) all failed
   * at a 45 s cap, and the original attempt exceeded 300 s. The reason is visible in the
   * index list — `judgments_court_year_idx` is `(court_type, year)` and carries **no `id`**,
   * so every id-ordered or MIN(id) plan must heap-fetch millions of rows. Had this shipped,
   * every windowed run would have died at startup before embedding anything.
   *
   * Ids increase monotonically with year, so a floor per year is a stable fact about the
   * corpus rather than something to recompute. These are measured minimums (SSM
   * `nys-embed-gap`); a value slightly BELOW the true minimum is safe — the `year >= n`
   * predicate still filters correctly and we merely scan a few extra index entries. A value
   * above it would skip rows, so round DOWN when adding a year.
   *
   * Adding `(year, id)` or `(court_type, year, id)` as an index would let this be computed,
   * but building it on a 267 GB table is a separate, heavier decision.
   */
  const YEAR_FLOOR_IDS: Record<number, number> = {
    2026: 19_730_303,
    2025: 17_697_117,
    2024: 15_949_436,
    2023: 13_870_679,
    2022: 11_924_666,
    2021: 10_539_351,
    2020: 9_577_048,
  };
  let yearFloorId = 0;
  if (yearMin != null) {
    yearFloorId = YEAR_FLOOR_IDS[yearMin] ?? 0;
    if (yearFloorId === 0) {
      /*
       * Unknown year: run with the predicate but NO floor rather than guessing. Slower, and
       * it may hit the statement timeout on a full corpus — but it can never skip rows,
       * which a wrong floor would do silently.
       */
      logger.warn(
        { yearMin, known: Object.keys(YEAR_FLOOR_IDS) },
        "EMBED_YEAR_MIN has no known id floor — running without one (slower, still correct)",
      );
    }
    logger.info(
      { scope, progressScope, yearMin, yearFloorId },
      "embed year window active (newest-first)",
    );
  }

  let done = 0;
  // Resume from last_id when present so restarts do not re-scan from 0.
  let lastId = Number(prior.rows[0]?.last_id ?? 0);
  if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;
  /*
   * Never resume BELOW the window floor. The checkpoint for a `:y<year>` scope is its own
   * row (see progressScope), so the un-windowed scope keeps its position untouched and the
   * general pass can still finish the older remainder later — a shared checkpoint would
   * have jumped to ~20.5M and permanently skipped the 2024-and-older backlog.
   */
  if (yearFloorId > lastId) lastId = yearFloorId - 1;
  while (done < maxRows) {
    const fetchLimit = Math.min(batchSize, maxRows - done);
    const selectParams =
      shardCount > 1
        ? [fetchLimit, lastId, shardCount, shardIndex]
        : [fetchLimit, lastId];
    const r = await withStatementTimeoutRetry("embed-select-batch", () =>
      rds.query<{
        id: number;
        title: string;
        petitioner: string | null;
        respondent: string | null;
        court: string | null;
        disposal_nature: string | null;
        description: string | null;
      }>(
        `SELECT id, title, petitioner, respondent, court, disposal_nature, description
       FROM judgments WHERE embedding IS NULL${scopeCond}${yearCond} AND id > $2${shardCond} ORDER BY id LIMIT $1`,
        selectParams as [number, number] | [number, number, number, number],
      ),
    );
    if (r.rows.length === 0) break;
    /*
     * NYS-EMBED-BATCH-UPDATE-001 (2026-08-18) — one UPDATE per slice, not one per row.
     *
     * Measured on the live worker (SSM `nys-bottleneck-isolate2`), embedding vs embedding
     * plus the write:
     *   conc=8 : embed 1,128ms -> embed+UPDATE 3,693ms  (UPDATE = 2,565ms, 462ms/row)
     *   conc=20: embed 1,140ms -> embed+UPDATE 1,280ms  (UPDATE =   140ms,  64ms/row)
     * So the per-row write DOMINATED at the concurrency we actually run, and the model call
     * was never the constraint. Each row was a separate round-trip to RDS in ap-south-1 and
     * paid HNSW index maintenance per statement.
     *
     * `unnest` pairs the id and vector arrays so the whole slice lands in ONE statement:
     * N round-trips become 1, and Postgres does index maintenance once. This is
     * provider-independent — it speeds up Titan and Gemini equally.
     *
     * Rows whose embedding failed are simply absent from the arrays, so they stay
     * `embedding IS NULL` and are retried on a later pass. That is the same behaviour as
     * before; the failure just no longer aborts its sibling writes.
     */
    for (let i = 0; i < r.rows.length; i += concurrency) {
      const slice = r.rows.slice(i, i + concurrency);
      const embedded = await Promise.all(
        slice.map(async (row) => {
          try {
            const emb = await embedText(
              caseEmbeddingText({
                title: row.title,
                petitioner: row.petitioner,
                respondent: row.respondent,
                court: row.court,
                disposalNature: row.disposal_nature,
                description: row.description,
              }),
            );
            if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIM) {
              logger.warn({ id: row.id, got: emb?.length }, "embedding wrong length; skipping row");
              return null;
            }
            return { id: row.id, vec: `[${emb.join(",")}]` };
          } catch (err) {
            /*
             * One bad row must not sink the slice. Previously a throw here rejected the
             * whole `Promise.all`, so up to `concurrency` successful embeddings were
             * discarded and re-paid for on the next pass.
             */
            logger.warn(
              { id: row.id, err: err instanceof Error ? err.message : String(err) },
              "embed failed for row; leaving NULL for a later pass",
            );
            return null;
          }
        }),
      );
      const ok = embedded.filter(
        (x): x is { id: number; vec: string } => x !== null,
      );
      if (ok.length > 0) {
        // Use the shared pool — never concurrent queries on the dedicated `rds` client.
        await withStatementTimeoutRetry("embed-batch-update", () =>
          pool2.query(
            `UPDATE judgments AS j
              SET embedding = v.emb::vector
             FROM (SELECT * FROM unnest($1::bigint[], $2::text[]) AS t(id, emb)) AS v
            WHERE j.id = v.id`,
            [ok.map((x) => x.id), ok.map((x) => x.vec)],
          ),
        );
      }
      if (ok.length !== slice.length) {
        logger.warn(
          { sliceSize: slice.length, written: ok.length },
          "some rows in slice failed to embed; they remain NULL",
        );
      }
    }
    done += r.rows.length;
    totalEmbedded += r.rows.length;
    lastId = r.rows[r.rows.length - 1]!.id;
    await withStatementTimeoutRetry("embed-progress-upsert", () =>
      pool2.query(
        `INSERT INTO embed_progress (scope, embedded_in_run, total_embedded, last_id, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (scope) DO UPDATE SET embedded_in_run = $2, total_embedded = $3, last_id = $4, updated_at = now()`,
        [progressScope, done, totalEmbedded, lastId],
      ),
    );
    logger.info({ done, lastId, totalEmbedded, scope, progressScope }, "embedded batch (rds corpus)");
  }
  // HNSW index once a meaningful fraction is embedded; IF NOT EXISTS keeps it idempotent.
  await rds.query(
    "CREATE INDEX IF NOT EXISTS judgments_embedding_hnsw ON judgments USING hnsw (embedding vector_cosine_ops)",
  );
  // Refresh planner stats: with stale stats the planner assumes ~no rows have
  // embeddings and picks a full seq scan over the HNSW index for KNN queries.
  await rds.query("ANALYZE judgments (embedding)");
  logger.info({ done, provider: embeddingProvider() }, "rds corpus embedding complete");
  rds.release();
}

async function main() {
  if (rdsBackendEnabled()) {
    await embedRdsCorpus();
  } else {
    await pool.query(
      "CREATE INDEX IF NOT EXISTS caselaw_embedding_hnsw ON caselaw_documents USING hnsw (embedding vector_cosine_ops)",
    );
    await embedDevCorpus();
  }
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "embed-corpus failed");
  process.exit(1);
});
