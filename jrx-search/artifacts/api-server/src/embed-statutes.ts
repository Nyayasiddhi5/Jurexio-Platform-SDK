/**
 * Batch-embed the statutes corpus into the pgvector `embedding` column.
 * Resumable: only processes rows where embedding IS NULL (keyset by id).
 *
 * Dev (Replit Postgres): deterministic hash embeddings.
 * Production worker (AI_PROVIDER=bedrock): Bedrock Titan Text Embeddings v2.
 * Both talk to the app DB via DATABASE_URL (dev Replit PG / prod nyvapp RDS).
 *
 * Usage: tsx src/embed-statutes.ts [maxRows] [batchSize]
 */
import { pool } from "@workspace/db";
import {
  embedText,
  statuteEmbeddingText,
  embeddingProvider,
  EMBEDDING_DIM,
} from "./lib/embeddings";
import { STATUTES_HNSW_DDL } from "./lib/statutesDdl";
import { logger } from "./lib/logger";

const maxRows = Number(process.argv[2] ?? 50000);
const batchSize = Number(process.argv[3] ?? 100);

/**
 * Hard application-level timeout + retry around a single embed call.
 * Bedrock/socket hangs have been observed to stall the run indefinitely;
 * this guarantees forward progress regardless of SDK timeout behavior.
 */
async function embedWithRetry(text: string, attempts = 4): Promise<number[]> {
  let lastErr: unknown;
  for (let a = 1; a <= attempts; a++) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        embedText(text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("embed call timed out after 45s")),
            45_000,
          );
        }),
      ]);
    } catch (err) {
      lastErr = err;
      logger.warn({ err: String(err), attempt: a }, "embed attempt failed");
      await new Promise((r) => setTimeout(r, Math.min(2000 * a, 8000)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function main() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(
    `ALTER TABLE statutes ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`,
  );

  let done = 0;
  let lastId = 0;
  while (done < maxRows) {
    const r = await pool.query<{
      id: number;
      code: string;
      section: string;
      heading: string;
      chapter: string | null;
      text: string;
      act_name: string | null;
    }>(
      `SELECT id, code, section, heading, chapter, text, act_name
       FROM statutes WHERE embedding IS NULL AND id > $2 ORDER BY id LIMIT $1`,
      [Math.min(batchSize, maxRows - done), lastId],
    );
    if (r.rows.length === 0) break;
    const concurrency = 8;
    for (let i = 0; i < r.rows.length; i += concurrency) {
      await Promise.all(
        r.rows.slice(i, i + concurrency).map(async (row) => {
          const emb = await embedWithRetry(
            statuteEmbeddingText({
              code: row.code,
              section: row.section,
              heading: row.heading,
              chapter: row.chapter,
              text: row.text,
              actName: row.act_name,
            }),
          );
          await pool.query(
            "UPDATE statutes SET embedding = $1::vector WHERE id = $2",
            [`[${emb.join(",")}]`, row.id],
          );
        }),
      );
    }
    done += r.rows.length;
    lastId = r.rows[r.rows.length - 1]!.id;
    logger.info({ done, lastId }, "embedded batch (statutes)");
  }

  // HNSW index once embeddings exist; IF NOT EXISTS keeps it idempotent.
  await pool.query(STATUTES_HNSW_DDL);
  // Refresh planner stats so KNN queries pick the HNSW index over a seq scan.
  await pool.query("ANALYZE statutes (embedding)");
  logger.info(
    { done, provider: embeddingProvider() },
    "statutes embedding complete",
  );
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "embed-statutes failed");
  process.exit(1);
});
