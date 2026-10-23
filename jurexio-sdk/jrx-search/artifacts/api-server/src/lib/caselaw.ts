import { db, caselawDocumentsTable, type Authority } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "./logger";

export const COURTLISTENER_BASE = "https://www.courtlistener.com";
const CL_SEARCH_URL = `${COURTLISTENER_BASE}/api/rest/v4/search/`;

export type CaselawDocOut = {
  id: number | null;
  jurisdiction: string;
  source: string;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  judges: string | null;
  authorJudge: string | null;
  citation: string | null;
  cnr: string | null;
  decisionDate: string | null;
  disposalNature: string | null;
  court: string | null;
  year: number | null;
  languages: string[];
  description: string | null;
  url: string | null;
  courtType?: string | null;
  caseType?: string | null;
  caseNo?: string | null;
  benchName?: string | null;
  judicialSection?: string | null;
  pdfLink?: string | null;
  /** Owned-archive s3://bucket/key of the judgment PDF (HC RDS rows only). */
  s3Path?: string | null;
};

const FTS_EXPR = sql`to_tsvector('english',
  coalesce(${caselawDocumentsTable.title},'') || ' ' ||
  coalesce(${caselawDocumentsTable.petitioner},'') || ' ' ||
  coalesce(${caselawDocumentsTable.respondent},'') || ' ' ||
  coalesce(${caselawDocumentsTable.description},'') || ' ' ||
  coalesce(${caselawDocumentsTable.citation},''))`;

export function rowToDoc(
  row: typeof caselawDocumentsTable.$inferSelect,
): CaselawDocOut {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    source: row.source,
    title: row.title,
    petitioner: row.petitioner,
    respondent: row.respondent,
    judges: row.judges,
    authorJudge: row.authorJudge,
    citation: row.citation,
    cnr: row.cnr,
    decisionDate: row.decisionDate,
    disposalNature: row.disposalNature,
    court: row.court,
    year: row.year,
    languages: row.languages ?? [],
    description: row.description,
    url: null,
  };
}

/**
 * Statement timeout (ms) applied to the FTS search transaction so a heavy
 * ingestion write load cannot make search queries hang indefinitely.
 */
export const SEARCH_STATEMENT_TIMEOUT_MS = 8000;

/**
 * Raised when the caselaw FTS search is cancelled by the server statement
 * timeout — signals the corpus is busy (likely ingesting) and the client
 * should retry shortly. Routes map this to HTTP 503.
 */
export class CorpusBusyError extends Error {
  constructor(
    message = "The caselaw corpus is busy (likely ingesting). Please retry shortly.",
  ) {
    super(message);
    this.name = "CorpusBusyError";
  }
}

/** Postgres error code 57014 = query_canceled (statement_timeout hit). */
export function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "57014"
  );
}

/**
 * If the local caselaw corpus is completely empty (fresh environment where
 * `seed:caselaw` hasn't been run), return an actionable hint; otherwise null.
 * Never throws — a failed check just means no hint.
 */
async function emptyCorpusMessage(): Promise<string | null> {
  try {
    const rows = await db
      .select({ one: sql<number>`1` })
      .from(caselawDocumentsTable)
      .limit(1);
    if (rows.length === 0) {
      return (
        "The local Indian caselaw corpus is not seeded, so search returns no results. " +
        "Run: pnpm --filter @workspace/api-server run seed:caselaw"
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to check whether caselaw corpus is empty");
  }
  return null;
}

export async function searchIndianCaselaw(opts: {
  q: string;
  year?: number;
  limit?: number;
}): Promise<{ total: number; results: CaselawDocOut[]; message?: string }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const tsQuery = sql`websearch_to_tsquery('english', ${opts.q})`;
  const conditions = [sql`${FTS_EXPR} @@ ${tsQuery}`];
  if (opts.year) {
    conditions.push(sql`${caselawDocumentsTable.year} = ${opts.year}`);
  }
  const where = sql.join(conditions, sql` AND `);

  const runSearch = () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`SET LOCAL statement_timeout = ${SEARCH_STATEMENT_TIMEOUT_MS}`),
      );

      const rows = await tx
        .select()
        .from(caselawDocumentsTable)
        .where(where)
        .orderBy(sql`ts_rank(${FTS_EXPR}, ${tsQuery}) DESC`)
        .limit(limit);

      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(caselawDocumentsTable)
        .where(where)) as [{ count: number }];

      return { total: count, results: rows.map(rowToDoc) };
    });

  try {
    const out = await runSearch();
    if (out.total === 0) {
      const message = await emptyCorpusMessage();
      if (message) return { ...out, message };
    }
    return out;
  } catch (err) {
    if (!isStatementTimeout(err)) throw err;
    // Retry once — transient contention from an ingestion burst often clears.
    logger.warn(
      { q: opts.q },
      "IN caselaw search hit statement_timeout; retrying once",
    );
    try {
      return await runSearch();
    } catch (retryErr) {
      if (isStatementTimeout(retryErr)) {
        logger.warn(
          { q: opts.q },
          "IN caselaw search timed out again; corpus busy",
        );
        throw new CorpusBusyError();
      }
      throw retryErr;
    }
  }
}

type ClSearchResult = {
  caseName?: string;
  citation?: string[] | null;
  court?: string;
  dateFiled?: string | null;
  judge?: string | null;
  absolute_url?: string;
  snippet?: string;
  opinions?: Array<{ snippet?: string }>;
};

export class UpstreamError extends Error {}

export async function searchUsCaselaw(opts: {
  q: string;
  court?: string;
  limit?: number;
}): Promise<{ total: number; results: CaselawDocOut[] }> {
  const params = new URLSearchParams({
    q: opts.q,
    type: "o",
    order_by: "score desc",
  });
  if (opts.court) params.set("court", opts.court);

  const headers: Record<string, string> = {
    "User-Agent": "NYS-AgenticAI/1.0",
  };
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (token) headers["Authorization"] = `Token ${token}`;

  let res: Response;
  try {
    res = await fetch(`${CL_SEARCH_URL}?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    logger.warn({ err: String(err) }, "CourtListener request failed");
    throw new UpstreamError(
      err instanceof Error && err.name === "TimeoutError"
        ? "CourtListener timed out. Try again shortly."
        : "Could not reach CourtListener. Try again shortly.",
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, body: body.slice(0, 200) },
      "CourtListener search failed",
    );
    throw new UpstreamError(
      res.status === 401 || res.status === 403
        ? "CourtListener requires an API token for this request. Set COURTLISTENER_API_TOKEN to enable US search."
        : `CourtListener search failed with status ${res.status}.`,
    );
  }

  const data = (await res.json()) as {
    count?: number;
    results?: ClSearchResult[];
  };

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const results: CaselawDocOut[] = (data.results ?? [])
    .slice(0, limit)
    .map((r) => ({
      id: null,
      jurisdiction: "US",
      source: "courtlistener",
      title: r.caseName ?? "Untitled",
      petitioner: null,
      respondent: null,
      judges: r.judge ?? null,
      authorJudge: null,
      citation:
        Array.isArray(r.citation) && r.citation.length > 0
          ? r.citation.join("; ")
          : null,
      cnr: null,
      decisionDate: r.dateFiled ?? null,
      disposalNature: null,
      court: r.court ?? null,
      year: r.dateFiled ? new Date(r.dateFiled).getFullYear() : null,
      languages: ["english"],
      description:
        r.opinions?.[0]?.snippet?.replace(/<[^>]+>/g, "") ??
        r.snippet?.replace(/<[^>]+>/g, "") ??
        null,
      url: r.absolute_url ? `${COURTLISTENER_BASE}${r.absolute_url}` : null,
    }));

  return { total: data.count ?? results.length, results };
}

export async function getCaselawDocById(
  id: number,
): Promise<CaselawDocOut | null> {
  const [row] = await db
    .select()
    .from(caselawDocumentsTable)
    .where(eq(caselawDocumentsTable.id, id))
    .limit(1);
  return row ? rowToDoc(row) : null;
}

export async function retrieveAuthorities(opts: {
  query: string;
  limit?: number;
  jurisdiction?: string;
}): Promise<Authority[]> {
  const limit = opts.limit ?? 5;
  const jurisdiction = opts.jurisdiction ?? "US";
  const authorities: Authority[] = [];

  if (jurisdiction === "IN") {
    try {
      const { rdsBackendEnabled, searchRdsJudgments } = await import(
        "./rdsCaselaw"
      );
      const inRes = rdsBackendEnabled()
        ? await searchRdsJudgments({ q: opts.query, limit })
        : await searchIndianCaselaw({ q: opts.query, limit });
      for (const r of inRes.results.slice(0, limit)) {
        authorities.push({
          title: r.title,
          citation: r.citation,
          court: r.court ?? "Supreme Court of India",
          date: r.decisionDate,
          url: r.url,
          source: "in-corpus",
        });
      }
    } catch (err) {
      logger.warn(
        { err: String(err) },
        "IN authority retrieval unavailable; continuing without it",
      );
    }
    return authorities;
  }

  if (jurisdiction !== "US") {
    // Reserved jurisdictions (GCC, UK, EU, SG): no grounding source yet.
    return authorities;
  }

  try {
    const us = await searchUsCaselaw({ q: opts.query, limit });
    for (const r of us.results.slice(0, limit)) {
      authorities.push({
        title: r.title,
        citation: r.citation,
        court: r.court,
        date: r.decisionDate,
        url: r.url,
        source: "courtlistener",
      });
    }
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "US authority retrieval unavailable; continuing without it",
    );
  }

  return authorities;
}
