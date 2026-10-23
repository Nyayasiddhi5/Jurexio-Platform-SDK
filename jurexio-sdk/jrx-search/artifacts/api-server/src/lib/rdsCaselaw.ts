import { getRdsPool } from "./rdsPool";
import { logger } from "./logger";
import type { CaselawDocOut } from "./caselaw";
import { isStatementTimeout } from "./caselaw";

/** Per-query budget for RDS FTS search (mirrors the local backend's #7 resilience). */
const RDS_SEARCH_STATEMENT_TIMEOUT_MS = Number(
  process.env.NYS_CASELAW_SEARCH_TIMEOUT_MS ?? 8_000,
);

/**
 * NYS-CASELAW-SEARCH-LATENCY-001 — how many GIN-matched rows get ranked.
 *
 * Was a flat 10,000, which is the whole of the bare-numeric latency defect that
 * NSP measured as `IPC 302` 0.107 s vs `302` 13.995 s. The cause is NOT an
 * unselective match: `302` matches 11,545 rows out of 26.26 M, and the GIN index
 * scan itself costs 3.3 ms. The cost is what happens next — the bitmap heap scan
 * must fetch those candidate rows, they are scattered across a **281 GB** table,
 * and RDS `shared_buffers` is only ~3.9 GB, so ~1.4 % of the table can be
 * cached. Measured with `EXPLAIN (ANALYZE, BUFFERS)` on the live instance:
 *
 *   query   candidates   shared read   exec
 *   bail        10,000         7,015    1,526 ms
 *   bail         2,000         3,435      735 ms
 *   bail           500           295       63 ms
 *   302         10,000    (50,191 buffers touched)  26 ms warm / 16,756 ms cold
 *
 * So latency tracks candidate count almost linearly, and the 130x ratio NSP saw
 * is simply whether a query reaches the cap: `IPC 302` matches 1,429 rows and
 * never does; `302` and `bail` do. Ranking fewer candidates is therefore the fix.
 *
 * This is not a precision loss being traded for speed. The inner scan has no
 * `ORDER BY`, so GIN returns rows in physical (TID) order and the 10,000 were
 * already an ARBITRARY subset of the matches, not the best-ranked ones. Ranking
 * an arbitrary 400 instead of an arbitrary 10,000 changes which arbitrary subset
 * is scored, and costs ~25x less I/O.
 */
const RANK_CANDIDATE_MULTIPLIER = 20;
const MIN_RANK_CANDIDATES = 400;
const MAX_RANK_CANDIDATES = 2_000;

function rankCandidateBudget(limit: number, offset: number): number {
  return Math.min(
    MAX_RANK_CANDIDATES,
    Math.max(MIN_RANK_CANDIDATES, (limit + offset) * RANK_CANDIDATE_MULTIPLIER),
  );
}

/**
 * Exact result count up to this cap; beyond it `total` is reported as a LOWER
 * BOUND, never as an estimate.
 *
 * Lowered 10,000 → 1,000 because the count query re-runs the same bitmap heap
 * scan as the ranking query, so it was doubling the I/O described above
 * (measured for `bail`: 1,431 ms at cap 2,000 vs 284–431 ms at 1,000).
 *
 * A planner estimate was evaluated as the alternative for large matches and
 * REJECTED as unpublishable. Measured `EXPLAIN` row estimates against real
 * counts: `murder` 33,330 vs 497 actual (67x high), `IPC 302` 42 vs 1,429 (34x
 * low), `302` 33,330 vs 11,545 (2.9x high). A number that wrong is worse than no
 * number, because it looks precise. "At least 1,000" is instead literally true.
 */
const COUNT_CAP = 1_000;

/**
 * NYS-SEARCH-SLO-001 — published latency contract for caselaw search, so a
 * partner sizes timeouts from a contract instead of from their own measurements.
 *
 * Derived from measurement on the live instance (2026-08-20), not aspiration.
 * After the candidate-window change above, server-side execution for the worst
 * query class measured 31 ms warm (`bail`, previously 4,090 ms) and 11 ms for a
 * bare numeric (`302`). The published figures are deliberately far looser than
 * those, because the dominant term in an end-to-end p99 is NOT the query plan:
 *
 *  - The corpus table is 281 GB against ~3.9 GB of `shared_buffers`, so a cold
 *    candidate window pays real EBS reads. The same `302` query measured 27 ms
 *    warm and 16,756 ms cold on an unwarmed buffer cache.
 *  - Four embed workers share the instance; under that load the FTS path can hit
 *    the 8 s `statement_timeout`, which surfaces as a retryable 503
 *    ("corpus is busy") rather than a slow success.
 *
 * A client that sets its timeout to the warm number will therefore fail on cold
 * cache. `timeoutRecommendationMs` is the number to configure; `p99Ms` is what
 * to expect when the working set is warm.
 */
export const CASELAW_SEARCH_SLO = {
  endpoint: "GET /caselaw/search",
  p50Ms: 150,
  p99Ms: 2_000,
  /** Set client timeouts here: covers a cold buffer cache plus one retry. */
  timeoutRecommendationMs: 30_000,
  /** Server-side statement budget; exceeding it yields 503 + retryable, not a hang. */
  statementTimeoutMs: RDS_SEARCH_STATEMENT_TIMEOUT_MS,
  retryable: [503],
  notes:
    "Measured 2026-08-20: worst-case warm execution 31ms (broad single term) and 11ms (bare numeric) after NYS-CASELAW-SEARCH-LATENCY-001. p99 allows for cold reads on a 281GB table with ~3.9GB shared_buffers; the same query measured 16.8s on a fully cold cache. Under concurrent embed load the server returns 503 with retryable:true rather than exceeding the statement budget.",
} as const;

/**
 * NYS-SEARCH-SLO-001 — statutes search contract.
 *
 * Measured end-to-end over HTTP on the live host (2026-08-20, 4 runs each):
 * `IPC 302` 0.29–0.48 s, `BNS 103` 0.28–0.49 s, `bail` 0.51–0.52 s, `murder`
 * 0.87–0.89 s, and `302` **5.68–5.99 s warm**. The statutes corpus is small
 * enough that the caselaw candidate-window problem does not apply (its hybrid leg
 * already caps at 30 candidates); the bare-numeric outlier there is a separate,
 * still-open issue and the published p99 reflects it honestly rather than quoting
 * the median and letting a partner discover the outlier in production.
 */
export const STATUTES_SEARCH_SLO = {
  endpoint: "GET /statutes/search",
  p50Ms: 500,
  p99Ms: 6_000,
  timeoutRecommendationMs: 30_000,
  retryable: [503],
  notes:
    "Measured 2026-08-20 over HTTP: IPC 302 0.29s, BNS 103 0.28s, bail 0.51s, murder 0.87s, 302 5.9s warm. The p99 is set by the bare-numeric case (`302`), which is a known open issue tracked separately from NYS-CASELAW-SEARCH-LATENCY-001 — that fix addressed the caselaw candidate window, which is not the statutes bottleneck.",
} as const;

export function rdsBackendEnabled(): boolean {
  return process.env.CASELAW_BACKEND === "rds";
}

type JudgmentRow = {
  id: number;
  court_type: string;
  court_code: string | null;
  court: string;
  bench: string | null;
  bench_name: string | null;
  year: number;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  judges: string | null;
  author_judge: string | null;
  citation: string | null;
  cnr: string | null;
  case_type: string | null;
  case_no: string | null;
  judicial_section: string | null;
  decision_date: string | null;
  disposal_nature: string | null;
  languages: string | null;
  description: string | null;
  pdf_link: string | null;
  source: string;
};

/**
 * Derive the owned-bucket S3 key for a High Court judgment PDF from its
 * partition metadata. The HC PDF estate uses keys shaped
 * data/pdf/year=Y/court=XX_YY/bench=<bench>/<basename(pdf_link)> — the
 * court code uses `_` in S3 keys where the metadata uses `~`. SC rows and
 * rows missing partition data get no s3Path.
 */
function hcS3Path(r: JudgmentRow): string | null {
  if (r.court_type !== "hc" || !r.pdf_link || !r.court_code || !r.bench) {
    return null;
  }
  const basename = r.pdf_link.split("/").pop();
  if (!basename || !basename.toLowerCase().endsWith(".pdf")) return null;
  const courtDir = r.court_code.replace(/~/g, "_");
  return `s3://ns-highcourt-data-bucket/data/pdf/year=${r.year}/court=${courtDir}/bench=${r.bench}/${basename}`;
}

function rowToDoc(r: JudgmentRow): CaselawDocOut {
  return {
    id: Number(r.id),
    jurisdiction: "IN",
    source: r.source,
    title: r.title,
    petitioner: r.petitioner,
    respondent: r.respondent,
    judges: r.judges,
    authorJudge: r.author_judge,
    citation: r.citation,
    cnr: r.cnr,
    decisionDate: r.decision_date
      ? new Date(r.decision_date).toISOString().slice(0, 10)
      : null,
    disposalNature: r.disposal_nature,
    court: r.court,
    year: r.year,
    languages: r.languages
      ? r.languages.split(",").map((x) => x.trim()).filter(Boolean)
      : [],
    description: r.description,
    url: null,
    courtType: r.court_type,
    caseType: r.case_type,
    caseNo: r.case_no,
    benchName: r.bench_name,
    judicialSection: r.judicial_section,
    pdfLink: r.pdf_link,
    s3Path: hcS3Path(r),
  };
}

const SELECT_COLS = `id, court_type, court_code, court, bench, bench_name, year, title, petitioner,
  respondent, judges, author_judge, citation, cnr, case_type, case_no,
  judicial_section, decision_date, disposal_nature, languages, description,
  pdf_link, source`;

/**
 * NYS-CASELAW-SEARCH-FILTERS-001 — server-side filters, pagination and sort.
 *
 * Every field here is one the schema genuinely supports; the ones NSP asked for
 * that the corpus cannot honestly answer are documented on
 * `CASELAW_FILTER_SUPPORT` below rather than approximated.
 */
export interface CaselawSearchFilters {
  q: string;
  courtType?: "sc" | "hc" | "dc";
  /** Substring match on the court name (e.g. "Bombay"). */
  court?: string;
  /** Exact year; `yearFrom`/`yearTo` express a range instead. */
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  /** Decision-date range, inclusive, ISO `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  /**
   * Substring match on the `judges` free-text column. Populated for ~87 % of
   * High Court rows and all Supreme Court rows; **empty for every District Court
   * row**, so a DC-scoped judge filter returns nothing by construction.
   */
  judge?: string;
  /**
   * Substring match on `citation`. Populated for 43,505/43,505 Supreme Court
   * rows and **zero** High Court or District Court rows, so this filter is
   * effectively Supreme-Court-only.
   */
  reporter?: string;
  /**
   * Bench strength, High Court only. `bench_name` carries the literal strings
   * "Single" / "Single Bench" / "Division" / "Division Bench" for the ~6 % of HC
   * rows where it is populated. It is NOT a bench strength on the other tiers —
   * for District Court rows the same column holds a district name ("Kadapa",
   * "Guntur"), and for Supreme Court rows it is empty — so this filter is
   * restricted to `courtType: 'hc'` and refuses elsewhere rather than silently
   * matching district names.
   */
  benchStrength?: "single" | "division";
  limit?: number;
  offset?: number;
  /** `relevance` (ts_rank, default) or `date` (most recent decision first). */
  sort?: "relevance" | "date";
  /** `hybrid` (FTS + vector RRF, default) or `fts` (keyword only). */
  mode?: "hybrid" | "fts";
}

/**
 * Machine-readable statement of what this endpoint can and cannot filter on, so
 * a partner sizes their UI from a contract instead of from trial and error.
 * Reported alongside results; the "unsupported" entries carry the reason.
 */
export const CASELAW_FILTER_SUPPORT = {
  supported: [
    "courtType",
    "court",
    "year",
    "yearFrom",
    "yearTo",
    "dateFrom",
    "dateTo",
    "judge",
    "reporter",
    "benchStrength",
    "offset",
    "sort",
  ],
  partial: {
    judge: "judges is populated for ~87% of High Court rows and all Supreme Court rows; it is empty for every District Court row.",
    reporter:
      "citation is populated for all 43,505 Supreme Court rows and 0 of the 20.4M High Court / 5.7M District Court rows.",
    benchStrength:
      "Derived from bench_name, which carries Single/Division only for High Court rows (~6% populated). Rejected for other tiers because the same column holds a district name for District Court rows.",
  },
  unsupported: {
    authorJudge:
      "author_judge is empty for every row in every tier, including the Supreme Court, so there is nothing to filter on.",
    exactTotal:
      "An exact COUNT(*) over a broad FTS match on a 281GB / 26.26M-row table is not affordable per request. total is exact below the cap and a labelled lower bound above it; a planner estimate was measured and rejected as unpublishable (murder: 33,330 estimated vs 497 actual).",
  },
} as const;

/** Metadata FTS leg plus optional SC body leg (NYS-SC-BODY-FTS-001). */
const FTS_TSQUERY = "websearch_to_tsquery('english', $1)";
const FTS_METADATA_MATCH_SQL = `search_tsv @@ ${FTS_TSQUERY}`;
const FTS_METADATA_RANK_SQL = `ts_rank(search_tsv, ${FTS_TSQUERY})`;
const FTS_MATCH_SQL = `(${FTS_METADATA_MATCH_SQL} OR (court_type = 'sc' AND body_search_tsv IS NOT NULL AND body_search_tsv @@ ${FTS_TSQUERY}))`;
const FTS_RANK_SQL = `GREATEST(
  ts_rank(search_tsv, ${FTS_TSQUERY}),
  CASE WHEN court_type = 'sc' AND body_search_tsv IS NOT NULL
       THEN ts_rank(body_search_tsv, ${FTS_TSQUERY}) ELSE 0::real END
)`;

type FtsLeg = "full" | "metadata";

function buildFilters(
  opts: CaselawSearchFilters,
  leg: FtsLeg = "full",
): { where: string; params: unknown[]; rankSql: string } {
  const matchSql = leg === "metadata" ? FTS_METADATA_MATCH_SQL : FTS_MATCH_SQL;
  const rankSql = leg === "metadata" ? FTS_METADATA_RANK_SQL : FTS_RANK_SQL;
  const conds: string[] = [matchSql];
  const params: unknown[] = [opts.q];
  const push = (value: unknown, sqlFor: (placeholder: string) => string) => {
    params.push(value);
    conds.push(sqlFor(`$${params.length}`));
  };

  if (opts.courtType) push(opts.courtType, (p) => `court_type = ${p}`);
  if (opts.year) push(opts.year, (p) => `year = ${p}`);
  if (opts.yearFrom) push(opts.yearFrom, (p) => `year >= ${p}`);
  if (opts.yearTo) push(opts.yearTo, (p) => `year <= ${p}`);
  if (opts.court) push(`%${opts.court}%`, (p) => `court ILIKE ${p}`);
  if (opts.dateFrom) push(opts.dateFrom, (p) => `decision_date >= ${p}::date`);
  if (opts.dateTo) push(opts.dateTo, (p) => `decision_date <= ${p}::date`);
  if (opts.judge) push(`%${opts.judge}%`, (p) => `judges ILIKE ${p}`);
  if (opts.reporter) push(`%${opts.reporter}%`, (p) => `citation ILIKE ${p}`);
  if (opts.benchStrength) {
    // Both spellings occur in the corpus ("Single" and "Single Bench"), and the
    // tier guard is what keeps this from matching District Court district names.
    push(`${opts.benchStrength}%`, (p) => `(court_type = 'hc' AND bench_name ILIKE ${p})`);
  }
  return { where: conds.join(" AND "), params, rankSql };
}

export async function searchRdsJudgments(opts: CaselawSearchFilters): Promise<{
  total: number;
  totalCapped: boolean;
  /**
   * True when `total` is a LOWER BOUND (the match set exceeded COUNT_CAP), not
   * an exact figure. Named explicitly so a client cannot mistake a floor for a
   * corpus total.
   */
  totalIsLowerBound: boolean;
  countCap: number;
  offset: number;
  limit: number;
  results: CaselawDocOut[];
  message?: string;
  /** True when a cheaper fallback leg answered instead of the full FTS path. */
  degraded?: boolean;
  degradedReason?: string;
  fallbackMode?: "metadata_only";
}> {
  const pool = await getRdsPool();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), 10_000);
  const candidates = rankCandidateBudget(limit, offset);

  const runSearch = async (leg: FtsLeg) => {
    const { where, params, rankSql } = buildFilters(opts, leg);
    const order =
      opts.sort === "date"
        ? "ORDER BY decision_date DESC NULLS LAST, id DESC"
        : `ORDER BY ${rankSql} DESC, id DESC`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SET LOCAL statement_timeout = ${RDS_SEARCH_STATEMENT_TIMEOUT_MS}`,
      );
      const rows = await client.query<JudgmentRow>(
        `SELECT ${SELECT_COLS}
         FROM (
           SELECT ${SELECT_COLS}, search_tsv, body_search_tsv
           FROM judgments
           WHERE ${where}
           LIMIT ${candidates}
         ) candidates
         ${order}
         OFFSET ${offset}
         LIMIT ${limit}`,
        params,
      );
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM (
           SELECT 1 FROM judgments WHERE ${where} LIMIT ${COUNT_CAP}
         ) c`,
        params,
      );
      await client.query("COMMIT");
      const total = count.rows[0]?.count ?? rows.rows.length;
      const capped = total >= COUNT_CAP;
      return {
        total,
        totalCapped: capped,
        totalIsLowerBound: capped,
        countCap: COUNT_CAP,
        offset,
        limit,
        results: rows.rows.map(rowToDoc),
        ...(leg === "metadata"
          ? {
              degraded: true,
              degradedReason:
                "Full-text search timed out under corpus load; metadata-only results returned.",
              fallbackMode: "metadata_only" as const,
              message:
                "Search degraded to metadata-only (title/headnote). Body-text matches may be missing until the corpus is idle.",
            }
          : {}),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  const emptyDegraded = (): Awaited<ReturnType<typeof searchRdsJudgments>> => ({
    total: 0,
    totalCapped: false,
    totalIsLowerBound: false,
    countCap: COUNT_CAP,
    offset,
    limit,
    results: [],
    degraded: true,
    degradedReason: "corpus_busy",
    message:
      "Caselaw search is temporarily busy (embed/backfill load). Retry shortly or narrow the query.",
  });

  try {
    return await runSearch("full");
  } catch (err) {
    if (!isStatementTimeout(err)) throw err;
    logger.warn(
      { q: opts.q },
      "RDS caselaw search hit statement_timeout; retrying once",
    );
    try {
      return await runSearch("full");
    } catch (retryErr) {
      if (!isStatementTimeout(retryErr)) throw retryErr;
      logger.warn(
        { q: opts.q },
        "RDS caselaw search timed out again; trying metadata-only fallback",
      );
      try {
        return await runSearch("metadata");
      } catch (metaErr) {
        if (isStatementTimeout(metaErr)) {
          logger.warn(
            { q: opts.q },
            "RDS caselaw metadata fallback also timed out; returning empty degraded envelope",
          );
          return emptyDegraded();
        }
        throw metaErr;
      }
    }
  }
}

/** Reciprocal Rank Fusion constant (mirrors statutes.ts). */
const RRF_K = 60;
const HYBRID_VEC_CANDIDATES = 30;
const RDS_VEC_STATEMENT_TIMEOUT_MS = 8_000;

function maxCaselawVecDistance(): number {
  // Same cutoffs as statutes: Titan looser, hash embedder stricter.
  return process.env.EMBEDDING_PROVIDER === "bedrock" ||
    process.env.NYS_EMBEDDING_PROVIDER === "bedrock"
    ? 0.8
    : 0.5;
}

export type CaselawSearchMethod = "hybrid_rrf" | "fts";

export type CaselawEmbeddingCoverage = {
  total: number;
  embedded: number;
  unembedded: number;
  coveragePct: number;
  approx: boolean;
  /*
   * NYS-COVERAGE-GAUGE-001 — per-court-type breakdown. A single blended percentage hid
   * that sc is 100% complete while hc is ~77% and dc ~41%: three different operational
   * stories that need different decisions.
   */
  perCourtType: Array<{
    courtType: string;
    total: number;
    embedded: number;
    coveragePct: number;
  }>;
  scopes: Array<{
    scope: string;
    totalEmbedded: number | null;
    updatedAt: string | null;
    stale: boolean;
  }>;
  slo: {
    targetCoveragePct: number;
    maxStalenessHours: number;
    overallStatus: "ok" | "degraded" | "critical" | "unknown";
    reasons: string[];
  };
  cachedAt: string;
};

const CASELAW_COVERAGE_TTL_MS = 60_000;

/*
 * NYS-COVERAGE-GAUGE-001 — the exact-count TTL is deliberately long.
 *
 * The `COUNT(*) FILTER (WHERE embedding IS NOT NULL)` scan takes ~249 s measured over
 * 26.2 M rows. Two consequences the 60 s TTL above cannot absorb:
 *   1. It exceeds the pool's default 25 s `statement_timeout`, so the query MUST raise its
 *      own timeout for this statement or it is cancelled every time and the gauge silently
 *      falls back to `coverage_query_failed`.
 *   2. At a 60 s TTL the scan would be re-issued continuously, pinning a connection and
 *      competing with the embed workers for the same RDS instance.
 * A backfill moves the needle by well under a percent per hour, so a 30-minute cache loses
 * no useful precision while making the endpoint cheap.
 */
const CASELAW_EXACT_COUNT_TTL_MS = Number(
  process.env.NYS_CASELAW_COUNT_TTL_MS ?? 30 * 60_000,
);
/** Must exceed the measured ~249 s scan; the pool default of 25 s would cancel it. */
const CASELAW_COUNT_STATEMENT_TIMEOUT_MS = Number(
  process.env.NYS_CASELAW_COUNT_TIMEOUT_MS ?? 600_000,
);

/*
 * NYS-COVERAGE-GAUGE-001 — coverage is reported for Indian courts only. `us-fed` (59,781)
 * and `us-ny` (26,755) are deliberately unembedded, so counting them would permanently
 * depress the headline figure for corpora we have chosen not to process.
 */
const INDIA_COURT_TYPES = ["sc", "hc", "dc"] as const;

/** Exact per-court-type counts, cached separately from the cheap coverage envelope. */
let exactCountCache:
  | { at: number; rows: CaselawEmbeddingCoverage["perCourtType"] }
  | null = null;
let caselawCoverageCache: { at: number; value: CaselawEmbeddingCoverage } | null =
  null;

/**
 * Cheap embedding coverage + SLO for judgments (ops / Console).
 * Uses pg_class approx + embed_progress — avoids COUNT(*) on 500k+ rows.
 */
export async function getCaselawEmbeddingCoverage(): Promise<CaselawEmbeddingCoverage> {
  const now = Date.now();
  if (
    caselawCoverageCache &&
    now - caselawCoverageCache.at < CASELAW_COVERAGE_TTL_MS
  ) {
    return caselawCoverageCache.value;
  }

  const targetCoveragePct = Number(
    process.env.NYS_CASELAW_EMBED_SLO_PCT ?? "99",
  );
  const maxStalenessHours = Number(
    process.env.NYS_CASELAW_EMBED_SLO_STALE_HOURS ?? "168",
  );
  const reasons: string[] = [];
  let total = 0;
  let embedded = 0;
  let approx = true;
  const scopes: CaselawEmbeddingCoverage["scopes"] = [];
  const perCourtType: CaselawEmbeddingCoverage["perCourtType"] = [];

  try {
    const pool = await getRdsPool();

    /*
     * NYS-COVERAGE-GAUGE-001 (2026-08-18) — count embedded rows; do NOT read a run counter.
     *
     * This function previously derived `embedded` from `MAX(embed_progress.total_embedded)`,
     * preferring the `all` scope. That column is a PER-RUN tally written by whichever worker
     * last ran, not a count of embedded rows. The `all` scope was last written 2026-07-30 at
     * 1,462,592, so the endpoint reported **5.56 %** coverage while the true figure was
     * **69.4 %** (18,163,495 of 26,172,689 Indian rows). It also emitted
     * `slo.overallStatus: "degraded"` on the back of that false number. Summing the
     * per-scope counters is equally wrong — shards overlap and reset, giving 7.7 M.
     *
     * Only a real `COUNT(*) FILTER (WHERE embedding IS NOT NULL)` is correct. It is a ~240 s
     * sequential scan over ~26 M rows, which is why the existing `CASELAW_COVERAGE_TTL_MS`
     * cache matters and why `approx` stays true for the `reltuples` total.
     *
     * Scoped to Indian court types on purpose: `us-fed` (59,781) and `us-ny` (26,755) are
     * parked, and including them would drag the headline number down for corpora we have
     * deliberately chosen not to embed. Per-court-type figures are reported alongside,
     * because sc=100 %, hc≈77 % and dc≈41 % are three different operational stories that a
     * single blended percentage hides.
     */
    const byCourtRows = await (async () => {
      if (
        exactCountCache
        && now - exactCountCache.at < CASELAW_EXACT_COUNT_TTL_MS
      ) {
        return exactCountCache.rows;
      }
      /*
       * Dedicated client, not `pool.query`: this statement needs a timeout far above the
       * pool-wide 25 s, and `SET LOCAL` inside an explicit transaction keeps the override
       * scoped so it cannot leak to the next borrower of this connection.
       */
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL statement_timeout = ${CASELAW_COUNT_STATEMENT_TIMEOUT_MS}`,
        );
        const res = await client.query<{
          court_type: string | null;
          total: string;
          embedded: string;
        }>(
          `SELECT court_type,
                  count(*)::text AS total,
                  count(*) FILTER (WHERE embedding IS NOT NULL)::text AS embedded
             FROM judgments
            WHERE court_type = ANY($1::text[])
            GROUP BY court_type`,
          [INDIA_COURT_TYPES],
        );
        await client.query("COMMIT");
        const rows = res.rows.map((row) => {
          const t = Number(row.total) || 0;
          const e = Number(row.embedded) || 0;
          return {
            courtType: row.court_type ?? "(null)",
            total: t,
            embedded: e,
            coveragePct: t === 0 ? 100 : Number(((e / t) * 100).toFixed(2)),
          };
        });
        exactCountCache = { at: now, rows };
        return rows;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        /*
         * Serve a stale exact count rather than reporting zero coverage. A failed scan is
         * an instrument problem; claiming 0 % embedded because of it is exactly the class
         * of false alarm this whole change exists to remove.
         */
        if (exactCountCache) {
          logger.warn(
            { err: String(err) },
            "coverage exact count failed; serving cached counts",
          );
          return exactCountCache.rows;
        }
        throw err;
      } finally {
        client.release();
      }
    })();

    for (const row of byCourtRows) {
      total += row.total;
      embedded += row.embedded;
      perCourtType.push(row);
    }
    // Real counts, not a reltuples estimate.
    approx = false;

    const progress = await rdsEmbeddingProgress();
    const maxStaleMs = maxStalenessHours * 3600_000;
    for (const p of progress) {
      const updatedMs = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
      const stale =
        !Number.isFinite(updatedMs) || now - updatedMs > maxStaleMs;
      scopes.push({
        scope: p.scope,
        totalEmbedded: p.totalEmbedded,
        updatedAt: p.updatedAt,
        stale,
      });
      /*
       * A stale checkpoint is only a fault for a scope that should still be advancing.
       * `sc` is 100 % embedded, so its checkpoint has been untouched since 2026-07-14 and
       * that is CORRECT — reporting it as a reason is what made the SLO look degraded on a
       * finished corpus. `all` is disabled by `EMBED_ALL_MAX_ROWS=0` (India-only), so its
       * staleness is also by design.
       */
      const scopeIsFinishedOrDisabled =
        p.scope === "sc" || p.scope === "all"
        || perCourtType.some(
          (c) => c.courtType === p.scope.split(":")[0] && c.coveragePct >= 100,
        );
      if (stale && !scopeIsFinishedOrDisabled) {
        reasons.push(`embed_progress scope=${p.scope} stale >${maxStalenessHours}h`);
      }
    }
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "getCaselawEmbeddingCoverage failed",
    );
    reasons.push("coverage_query_failed");
  }

  const coveragePct =
    total === 0 ? 100 : Number(((embedded / total) * 100).toFixed(2));
  if (total > 0 && coveragePct < targetCoveragePct) {
    reasons.push(
      `coveragePct ${coveragePct} < target ${targetCoveragePct}`,
    );
  }

  let overallStatus: CaselawEmbeddingCoverage["slo"]["overallStatus"] =
    "unknown";
  if (reasons.includes("coverage_query_failed")) overallStatus = "unknown";
  // Honest backfill bands (NYS-CASELAW-EMBED-SLO): <5% critical, else
  // below target = degraded (in progress), not "half of 99% = critical".
  else if (coveragePct < 5) overallStatus = "critical";
  else if (reasons.length > 0) overallStatus = "degraded";
  else overallStatus = "ok";

  const value: CaselawEmbeddingCoverage = {
    perCourtType,
    total,
    embedded,
    unembedded: Math.max(0, total - embedded),
    coveragePct,
    approx,
    scopes,
    slo: {
      targetCoveragePct,
      maxStalenessHours,
      overallStatus,
      reasons,
    },
    cachedAt: new Date().toISOString(),
  };
  caselawCoverageCache = { at: now, value };
  return value;
}

/**
 * Hybrid FTS + pgvector RRF over RDS judgments (mirrors statutes hybrid).
 * Degrades to FTS when embeddings unavailable or vector leg fails.
 */
export async function searchRdsJudgmentsHybrid(opts: CaselawSearchFilters): Promise<{
  total: number;
  totalCapped: boolean;
  totalIsLowerBound: boolean;
  countCap: number;
  offset: number;
  limit: number;
  results: CaselawDocOut[];
  method: CaselawSearchMethod;
  embeddingCoverage?: CaselawEmbeddingCoverage;
  message?: string;
  degraded?: boolean;
  degradedReason?: string;
  fallbackMode?: "metadata_only";
}> {
  const mode = opts.mode ?? "hybrid";
  const fts = await searchRdsJudgments(opts);
  if (mode === "fts") {
    return { ...fts, method: "fts" };
  }
  /*
   * RRF fuses two independently-ranked lists, so it cannot be paginated by
   * slicing one of them: page 2 of a fused ranking is not the fused ranking of
   * page 2. Rather than return a silently wrong page, an offset request is served
   * by the FTS leg, which has a well-defined stable order. The method field
   * reports which leg actually answered so the client is never guessing.
   */
  if ((opts.offset ?? 0) > 0) {
    return { ...fts, method: "fts" };
  }

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const candidateLimit = Math.min(
    Math.max(limit * 2, HYBRID_VEC_CANDIDATES),
    60,
  );

  let vecDocs: CaselawDocOut[] = [];
  try {
    const { embedText, embeddingProvider } = await import("./embeddings");
    const emb = await embedText(opts.q);
    const embLiteral = `[${emb.join(",")}]`;
    const pool = await getRdsPool();
    // Reuse the same filter builder as the FTS leg so a filter cannot apply to
    // one leg and not the other — which would let a fused page contain rows the
    // caller explicitly filtered out.
    const built = buildFilters(opts);
    // $1 is the tsquery for the FTS leg; the vector leg needs the embedding in
    // its place, and the remaining predicates keep their original numbering.
    const params = [embLiteral, ...built.params.slice(1)];
    const where = built.where.replace(FTS_MATCH_SQL, "embedding IS NOT NULL");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SET LOCAL statement_timeout = ${RDS_VEC_STATEMENT_TIMEOUT_MS}`,
      );
      const rows = await client.query<JudgmentRow & { dist: number }>(
        `SELECT ${SELECT_COLS}, (embedding <=> $1::vector) AS dist
         FROM judgments
         WHERE ${where}
         ORDER BY embedding <=> $1::vector
         LIMIT ${candidateLimit}`,
        params,
      );
      await client.query("COMMIT");
      const cutoff =
        embeddingProvider() === "bedrock" ? 0.8 : maxCaselawVecDistance();
      vecDocs = rows.rows
        .filter((r) => Number(r.dist) <= cutoff)
        .map((r) => rowToDoc(r));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn(
      { err: String(err), q: opts.q.slice(0, 80) },
      "caselaw vector search failed; falling back to FTS",
    );
    const coverage = await getCaselawEmbeddingCoverage().catch(() => undefined);
    return { ...fts, method: "fts", embeddingCoverage: coverage };
  }

  if (vecDocs.length === 0) {
    const coverage = await getCaselawEmbeddingCoverage().catch(() => undefined);
    return { ...fts, method: "fts", embeddingCoverage: coverage };
  }

  const scores = new Map<number, { doc: CaselawDocOut; score: number }>();
  const fuse = (docs: CaselawDocOut[]) => {
    docs.forEach((doc, i) => {
      const entry = scores.get(doc.id) ?? { doc, score: 0 };
      entry.score += 1 / (RRF_K + i + 1);
      scores.set(doc.id, entry);
    });
  };
  fuse(fts.results);
  fuse(vecDocs);

  const fused = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.doc);

  const coverage = await getCaselawEmbeddingCoverage().catch(() => undefined);
  return {
    ...fts,
    total: Math.max(fts.total, fused.length),
    results: fused,
    method: "hybrid_rrf",
    embeddingCoverage: coverage,
  };
}

export async function getRdsJudgmentById(
  id: number,
): Promise<CaselawDocOut | null> {
  const pool = await getRdsPool();
  const r = await pool.query<JudgmentRow>(
    `SELECT ${SELECT_COLS} FROM judgments WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? rowToDoc(r.rows[0]) : null;
}

/**
 * pgvector cosine KNN over judgments.embedding. Returns null when the
 * target document has no embedding yet (caller falls back to FTS).
 */
export async function findSimilarRdsByEmbedding(
  id: number,
  limit: number,
): Promise<CaselawDocOut[] | null> {
  const pool = await getRdsPool();
  const target = await pool.query<{ embedding: string | null }>(
    `SELECT embedding::text AS embedding FROM judgments WHERE id = $1`,
    [id],
  );
  if (target.rows.length === 0) return null;
  const emb = target.rows[0].embedding;
  if (!emb) return null;
  const rows = await pool.query<JudgmentRow>(
    `SELECT ${SELECT_COLS}
     FROM judgments
     WHERE embedding IS NOT NULL AND id <> $1
     ORDER BY embedding <=> $2::vector
     LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
    [id, emb],
  );
  return rows.rows.map(rowToDoc);
}

/** Public AWS Open Data HC bucket: judgment PDFs live alongside the parquet. */
const HC_PDF_BUCKET_URL =
  "https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com";

export type RdsPdfTarget =
  | { kind: "absolute"; url: string }
  | { kind: "public"; url: string }
  | { kind: "presign"; s3Path: string }
  | null;

/**
 * Resolve where a judgment PDF actually lives:
 *  - absolute http(s) pdf_link → serve as-is;
 *  - SC rows carry an owned-bucket s3:// path (backfilled from parquet `path`)
 *    → presign via the allowlisted document presigner;
 *  - HC rows carry the ecourts-relative pdf_link → the same file exists in the
 *    public HC Open Data bucket at
 *    data/pdf/year=<year>/court=<code with ~ → _>/bench=<bench>/<basename>.
 */
export async function getRdsPdfTarget(id: number): Promise<RdsPdfTarget> {
  const pool = await getRdsPool();
  const r = await pool.query<{
    court_type: string;
    court_code: string | null;
    bench: string | null;
    year: number;
    pdf_link: string | null;
  }>(
    `SELECT court_type, court_code, bench, year, pdf_link FROM judgments WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row || !row.pdf_link) return null;
  const link = row.pdf_link.trim();
  if (/^https?:\/\//i.test(link)) return { kind: "absolute", url: link };
  if (link.startsWith("s3://")) return { kind: "presign", s3Path: link };
  if (row.court_type === "hc" && row.court_code && row.bench) {
    const basename = link.split("/").pop();
    if (!basename || !basename.toLowerCase().endsWith(".pdf")) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(basename)) return null;
    const court = row.court_code.replace(/~/g, "_");
    if (!/^[A-Za-z0-9_]+$/.test(court) || !/^[A-Za-z0-9_-]+$/.test(row.bench)) {
      return null;
    }
    const key = `data/pdf/year=${row.year}/court=${court}/bench=${row.bench}/${basename}`;
    return { kind: "public", url: `${HC_PDF_BUCKET_URL}/${key}` };
  }
  return null;
}

export type EmbeddingProgress = {
  scope: string;
  embeddedInRun: number;
  totalEmbedded: number | null;
  lastId: number;
  updatedAt: string;
};

/** Reads the embed_progress checkpoints kept by embed-corpus (cheap; no count(*)). */
export async function rdsEmbeddingProgress(): Promise<EmbeddingProgress[]> {
  const pool = await getRdsPool();
  try {
    const r = await pool.query<{
      scope: string;
      embedded_in_run: string;
      total_embedded: string | null;
      last_id: string;
      updated_at: string;
    }>(
      `SELECT scope, embedded_in_run, total_embedded, last_id, updated_at
       FROM embed_progress ORDER BY updated_at DESC`,
    );
    return r.rows.map((row) => ({
      scope: row.scope,
      embeddedInRun: Number(row.embedded_in_run),
      totalEmbedded: row.total_embedded === null ? null : Number(row.total_embedded),
      lastId: Number(row.last_id),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  } catch (err) {
    // Table only exists once the embedder has run at least once.
    logger.warn({ err: String(err) }, "embed_progress unavailable");
    return [];
  }
}

type RdsStatsRow = {
  source: string;
  jurisdiction: string;
  documentCount: number;
  minYear: number | null;
  maxYear: number | null;
};

const STATS_TTL_MS = 10 * 60 * 1000;
let statsCache: { at: number; rows: RdsStatsRow[] } | null = null;
let statsRefreshInFlight: Promise<RdsStatsRow[]> | null = null;

async function rdsStatsHeavy(): Promise<RdsStatsRow[]> {
  const pool = await getRdsPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const r = await client.query<{
      source: string;
      n: number;
      min_year: number | null;
      max_year: number | null;
    }>(
      `SELECT source, count(*)::int AS n, min(year) AS min_year, max(year) AS max_year
       FROM judgments GROUP BY source ORDER BY source`,
    );
    await client.query("COMMIT");
    const rows = r.rows.map((row) => ({
      source: row.source,
      jurisdiction: "IN",
      documentCount: row.n,
      minYear: row.min_year,
      maxYear: row.max_year,
    }));
    statsCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fast path: return cached rows immediately; refresh in background when stale.
 * Cold start uses pg_class estimate instead of blocking on COUNT(*) over 500k+ rows.
 */
export async function rdsStats(): Promise<RdsStatsRow[]> {
  const now = Date.now();
  if (statsCache && now - statsCache.at < STATS_TTL_MS) {
    return statsCache.rows;
  }
  if (statsCache) {
    // Stale-while-revalidate
    if (!statsRefreshInFlight) {
      statsRefreshInFlight = rdsStatsHeavy()
        .catch((err) => {
          logger.warn({ err: String(err) }, "rdsStats background refresh failed");
          return statsCache!.rows;
        })
        .finally(() => {
          statsRefreshInFlight = null;
        });
    }
    return statsCache.rows;
  }

  // Cold: approximate from pg_class (instant) then kick off exact refresh
  try {
    const pool = await getRdsPool();
    const est = await pool.query<{ n: number }>(
      `SELECT COALESCE(c.reltuples, 0)::bigint::int AS n
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'judgments' AND n.nspname = 'public'`,
    );
    const approx = est.rows[0]?.n ?? 0;
    const rows: RdsStatsRow[] = [
      {
        source: "rds-approx",
        jurisdiction: "IN",
        documentCount: approx,
        minYear: null,
        maxYear: null,
      },
    ];
    statsCache = { at: now, rows };
    if (!statsRefreshInFlight) {
      statsRefreshInFlight = rdsStatsHeavy()
        .catch((err) => {
          logger.warn({ err: String(err) }, "rdsStats cold exact refresh failed");
          return rows;
        })
        .finally(() => {
          statsRefreshInFlight = null;
        });
    }
    return rows;
  } catch (err) {
    logger.warn({ err: String(err) }, "rdsStats approx failed; falling back to heavy");
    return rdsStatsHeavy();
  }
}
