import { db, statutesTable, type Statute } from "@workspace/db";
import { sql, and, eq, isNotNull, ne } from "drizzle-orm";
import { embedText, statuteEmbeddingText, embeddingProvider } from "./embeddings";
import { logger } from "./logger";

export type StatuteOut = {
  id: number;
  code: string;
  jurisdiction: string;
  section: string;
  uscTitle: string | null;
  heading: string;
  chapter: string | null;
  text: string;
  mappedCode: string | null;
  mappedSections: string[];
  changeNotes: string | null;
  actName: string | null;
  actYear: string | null;
  actNo: string | null;
  ministry: string | null;
  practiceArea: string | null;
  provisionType: string;
  enactmentDate: string | null;
};

export function statuteToOut(row: Statute): StatuteOut {
  return {
    id: row.id,
    code: row.code,
    jurisdiction: row.jurisdiction,
    section: row.section,
    uscTitle: row.uscTitle,
    heading: row.heading,
    chapter: row.chapter,
    text: row.text,
    mappedCode: row.mappedCode,
    mappedSections: row.mappedSections ?? [],
    changeNotes: row.changeNotes,
    actName: row.actName,
    actYear: row.actYear,
    actNo: row.actNo,
    ministry: row.ministry,
    practiceArea: row.practiceArea,
    provisionType: row.provisionType ?? "section",
    enactmentDate: row.enactmentDate,
  };
}

export type StatuteActOut = {
  code: string;
  actName: string;
  jurisdiction: string;
  actYear: string | null;
  actNo: string | null;
  ministry: string | null;
  practiceArea: string | null;
  enactmentDate: string | null;
  sectionCount: number;
};

// Display names for core codes that predate act-level metadata.
const CORE_ACT_NAMES: Record<string, string> = {
  BNS: "Bharatiya Nyaya Sanhita, 2023",
  BNSS: "Bharatiya Nagarik Suraksha Sanhita, 2023",
  BSA: "Bharatiya Sakshya Adhiniyam, 2023",
  IPC: "The Indian Penal Code, 1860",
  CRPC: "The Code of Criminal Procedure, 1973",
  IEA: "The Indian Evidence Act, 1872",
  USC: "United States Code (selected provisions)",
  COI: "The Constitution of India",
};

/**
 * Act-level browse: every code in the corpus with its true section count and
 * act metadata (aggregated in SQL — counts are exact, never page-capped).
 */
export async function listStatuteActs(opts: {
  practiceArea?: string;
  jurisdiction?: string;
  q?: string;
  limit?: number;
}): Promise<{
  total: number;
  totalSections: number;
  practiceAreas: string[];
  results: StatuteActOut[];
}> {
  const conds = [sql`TRUE`];
  if (opts.jurisdiction)
    conds.push(sql`${statutesTable.jurisdiction} = ${opts.jurisdiction}`);
  const where = sql.join(conds, sql` AND `);

  const grouped = await db
    .select({
      code: statutesTable.code,
      jurisdiction: statutesTable.jurisdiction,
      actName: sql<string | null>`max(${statutesTable.actName})`,
      actYear: sql<string | null>`max(${statutesTable.actYear})`,
      actNo: sql<string | null>`max(${statutesTable.actNo})`,
      ministry: sql<string | null>`max(${statutesTable.ministry})`,
      practiceArea: sql<string | null>`max(${statutesTable.practiceArea})`,
      enactmentDate: sql<string | null>`max(${statutesTable.enactmentDate})`,
      sectionCount: sql<number>`count(*)::int`,
    })
    .from(statutesTable)
    .where(where)
    .groupBy(statutesTable.code, statutesTable.jurisdiction);

  let acts: StatuteActOut[] = grouped.map((g) => ({
    code: g.code,
    actName: g.actName ?? CORE_ACT_NAMES[g.code] ?? g.code,
    jurisdiction: g.jurisdiction,
    actYear: g.actYear,
    actNo: g.actNo,
    ministry: g.ministry,
    practiceArea: g.practiceArea,
    enactmentDate: g.enactmentDate,
    sectionCount: g.sectionCount,
  }));

  const practiceAreas = [
    ...new Set(acts.map((a) => a.practiceArea).filter((p): p is string => !!p)),
  ].sort();

  if (opts.practiceArea) {
    acts = acts.filter((a) => a.practiceArea === opts.practiceArea);
  }
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    acts = acts.filter(
      (a) =>
        a.actName.toLowerCase().includes(needle) ||
        a.code.toLowerCase().includes(needle),
    );
  }
  acts.sort((a, b) => a.actName.localeCompare(b.actName));

  const total = acts.length;
  const totalSections = acts.reduce((s, a) => s + a.sectionCount, 0);
  const results =
    opts.limit !== undefined
      ? acts.slice(0, Math.min(Math.max(opts.limit, 1), 1000))
      : acts;

  return {
    total,
    totalSections,
    practiceAreas,
    results,
  };
}

export type StatuteEmbeddingCoverage = {
  /** Total rows in the statutes corpus (after any scope filters = none; corpus-wide). */
  total: number;
  /** Rows with a non-null embedding (participate in the vector leg). */
  embedded: number;
  /** Rows the vector leg silently skips until embed:statutes is re-run. */
  unembedded: number;
  /** embedded / total as a 0-100 percentage (100 when the corpus is empty). */
  coveragePct: number;
};

/** Cache TTL for the corpus-wide embedding coverage count (ms). */
const COVERAGE_TTL_MS = 60_000;
let coverageCache: { at: number; value: StatuteEmbeddingCoverage } | null = null;

/**
 * Cheap corpus-wide embedding coverage check so meaning-based search drift
 * is visible: newly seeded/ingested rows have NULL embeddings and are
 * invisible to the vector leg until `embed:statutes` runs. Cached for 60s.
 */
export async function getStatuteEmbeddingCoverage(): Promise<StatuteEmbeddingCoverage> {
  const now = Date.now();
  if (coverageCache && now - coverageCache.at < COVERAGE_TTL_MS) {
    return coverageCache.value;
  }
  const [row] = (await db
    .select({
      total: sql<number>`count(*)::int`,
      embedded: sql<number>`count(${statutesTable.embedding})::int`,
    })
    .from(statutesTable)) as [{ total: number; embedded: number }];
  const total = row?.total ?? 0;
  const embedded = row?.embedded ?? 0;
  const value: StatuteEmbeddingCoverage = {
    total,
    embedded,
    unembedded: total - embedded,
    coveragePct:
      total === 0 ? 100 : Number(((embedded / total) * 100).toFixed(2)),
  };
  coverageCache = { at: now, value };
  return value;
}

/** Test hook: clear the coverage cache so fixtures see fresh counts. */
export function clearStatuteCoverageCache(): void {
  coverageCache = null;
}

const STATUTE_FTS = sql`to_tsvector('english',
  coalesce(${statutesTable.code},'') || ' ' ||
  coalesce(${statutesTable.section},'') || ' ' ||
  coalesce(${statutesTable.heading},'') || ' ' ||
  coalesce(${statutesTable.text},''))`;

export type StatuteSearchMethod = "hybrid_rrf" | "fts";

/** Reciprocal Rank Fusion constant (standard k=60). */
const RRF_K = 60;

/**
 * Max cosine distance for a vector candidate to count as semantically
 * related. Beyond this the KNN is just returning the nearest of unrelated
 * rows (a KNN always returns *something*), which would pollute results for
 * queries with no real match. The dev hash embedder is far noisier than
 * Titan (md5 feature collisions give unrelated short rows cosine up to
 * ~0.45), so it gets a much stricter cutoff.
 */
function maxVecDistance(): number {
  return embeddingProvider() === "bedrock" ? 0.8 : 0.5;
}

/**
 * Hybrid search: Postgres FTS + pgvector cosine KNN fused with Reciprocal
 * Rank Fusion (RRF, k=60). Falls back to pure FTS when the corpus has no
 * embeddings yet or the query embedding fails — `method` reports which path
 * produced the results. `total` is the exact FTS match count for the filter.
 */
export async function searchStatutes(opts: {
  q: string;
  code?: string;
  jurisdiction?: string;
  limit?: number;
}): Promise<{
  total: number;
  results: StatuteOut[];
  method: StatuteSearchMethod;
  embeddingCoverage: StatuteEmbeddingCoverage;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const candidateLimit = Math.min(limit * 3, 60);
  const tsQuery = sql`websearch_to_tsquery('english', ${opts.q})`;

  const filterConds: ReturnType<typeof sql>[] = [];
  if (opts.code) filterConds.push(sql`${statutesTable.code} = ${opts.code}`);
  if (opts.jurisdiction)
    filterConds.push(sql`${statutesTable.jurisdiction} = ${opts.jurisdiction}`);

  const ftsWhere = sql.join(
    [sql`${STATUTE_FTS} @@ ${tsQuery}`, ...filterConds],
    sql` AND `,
  );

  const ftsRows = await db
    .select()
    .from(statutesTable)
    .where(ftsWhere)
    .orderBy(sql`ts_rank(${STATUTE_FTS}, ${tsQuery}) DESC`)
    .limit(candidateLimit);

  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statutesTable)
    .where(ftsWhere)) as [{ count: number }];

  // Vector branch: cosine KNN over embedded rows. Any failure (or an
  // unembedded corpus) degrades to pure FTS — never blocks the search.
  let vecRows: Statute[] = [];
  try {
    const emb = await embedText(opts.q);
    const embLiteral = `[${emb.join(",")}]`;
    const distance = sql<number>`${statutesTable.embedding} <=> ${embLiteral}::vector`;
    const vecWhere = sql.join(
      [sql`${statutesTable.embedding} IS NOT NULL`, ...filterConds],
      sql` AND `,
    );
    const knn = await db
      .select({ statute: statutesTable, dist: distance })
      .from(statutesTable)
      .where(vecWhere)
      .orderBy(distance)
      .limit(candidateLimit);
    const cutoff = maxVecDistance();
    vecRows = knn
      .filter((r) => Number(r.dist) <= cutoff)
      .map((r) => r.statute);
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "statutes vector search failed; falling back to FTS",
    );
  }

  const embeddingCoverage = await getStatuteEmbeddingCoverage();
  if (embeddingCoverage.unembedded > 0) {
    logger.warn(
      {
        unembedded: embeddingCoverage.unembedded,
        total: embeddingCoverage.total,
        coveragePct: embeddingCoverage.coveragePct,
      },
      "statute search: corpus has unembedded rows — vector leg is skipping them; run `pnpm --filter @workspace/api-server run embed:statutes`",
    );
  }

  if (vecRows.length === 0) {
    return {
      total: count,
      results: ftsRows.slice(0, limit).map(statuteToOut),
      method: "fts",
      embeddingCoverage,
    };
  }

  // Reciprocal Rank Fusion: score(d) = sum over lists of 1/(k + rank).
  const scores = new Map<number, { row: Statute; score: number }>();
  const fuse = (rows: Statute[]) => {
    rows.forEach((row, i) => {
      const entry = scores.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + i + 1);
      scores.set(row.id, entry);
    });
  };
  fuse(ftsRows);
  fuse(vecRows);

  const fused = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => statuteToOut(e.row));

  return {
    total: Math.max(count, fused.length),
    results: fused,
    method: "hybrid_rrf",
    embeddingCoverage,
  };
}

export type HybridStatuteHit = StatuteOut & {
  /** 1-based rank in the FTS result list, when matched by FTS. */
  ftsRank: number | null;
  /** 1-based rank in the vector KNN result list, when matched by vector. */
  vectorRank: number | null;
  /** Reciprocal Rank Fusion score (higher = better). */
  rrfScore: number;
};

export type HybridStatuteSearchResult = {
  /** hybrid = FTS ∪ vector fused with RRF; fts = vector leg unavailable. */
  method: "hybrid" | "fts";
  provider: string;
  total: number;
  results: HybridStatuteHit[];
  embeddingCoverage: StatuteEmbeddingCoverage;
};

/** Candidates fetched per leg before fusion. */
const HYBRID_CANDIDATES = 30;

function scopeConds(opts: {
  code?: string;
  jurisdiction?: string;
  practiceArea?: string;
}) {
  const conds = [];
  if (opts.code) conds.push(eq(statutesTable.code, opts.code));
  if (opts.jurisdiction)
    conds.push(eq(statutesTable.jurisdiction, opts.jurisdiction));
  if (opts.practiceArea)
    conds.push(eq(statutesTable.practiceArea, opts.practiceArea));
  return conds;
}

/**
 * Hybrid statute retrieval: Postgres FTS and pgvector cosine KNN run as
 * independent legs, then Reciprocal Rank Fusion merges them
 * (score = Σ 1/(k + rank)). If the vector leg is unavailable (no embeddings
 * yet, or the embed call fails), the result degrades to FTS-only and says so
 * via `method` — never a silent behavioural change.
 */
export async function hybridSearchStatutes(opts: {
  q: string;
  code?: string;
  jurisdiction?: string;
  practiceArea?: string;
  limit?: number;
}): Promise<HybridStatuteSearchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const scope = scopeConds(opts);

  // Leg 1: FTS.
  const tsQuery = sql`websearch_to_tsquery('english', ${opts.q})`;
  const ftsRows = await db
    .select()
    .from(statutesTable)
    .where(and(sql`${STATUTE_FTS} @@ ${tsQuery}`, ...scope))
    .orderBy(sql`ts_rank(${STATUTE_FTS}, ${tsQuery}) DESC`)
    .limit(HYBRID_CANDIDATES);

  // Leg 2: vector KNN (only over rows that have embeddings).
  let vecRows: Statute[] = [];
  try {
    const emb = await embedText(opts.q);
    const embLiteral = `[${emb.join(",")}]`;
    vecRows = await db
      .select()
      .from(statutesTable)
      .where(and(isNotNull(statutesTable.embedding), ...scope))
      .orderBy(sql`${statutesTable.embedding} <=> ${embLiteral}::vector`)
      .limit(HYBRID_CANDIDATES);
  } catch (err) {
    logger.warn(
      { err: String(err), q: opts.q },
      "hybrid statute search: vector leg failed; degrading to FTS-only",
    );
  }

  // Reciprocal Rank Fusion.
  const fused = new Map<
    number,
    { row: Statute; ftsRank: number | null; vectorRank: number | null; rrfScore: number }
  >();
  ftsRows.forEach((row, i) => {
    fused.set(row.id, {
      row,
      ftsRank: i + 1,
      vectorRank: null,
      rrfScore: 1 / (RRF_K + i + 1),
    });
  });
  vecRows.forEach((row, i) => {
    const existing = fused.get(row.id);
    if (existing) {
      existing.vectorRank = i + 1;
      existing.rrfScore += 1 / (RRF_K + i + 1);
    } else {
      fused.set(row.id, {
        row,
        ftsRank: null,
        vectorRank: i + 1,
        rrfScore: 1 / (RRF_K + i + 1),
      });
    }
  });

  const embeddingCoverage = await getStatuteEmbeddingCoverage();
  if (embeddingCoverage.unembedded > 0) {
    logger.warn(
      {
        unembedded: embeddingCoverage.unembedded,
        total: embeddingCoverage.total,
        coveragePct: embeddingCoverage.coveragePct,
      },
      "hybrid statute retrieval: corpus has unembedded rows — vector leg is skipping them; run `pnpm --filter @workspace/api-server run embed:statutes`",
    );
  }

  const ranked = [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  return {
    method: vecRows.length > 0 ? "hybrid" : "fts",
    provider: embeddingProvider(),
    total: ranked.length,
    embeddingCoverage,
    results: ranked.slice(0, limit).map((e) => ({
      ...statuteToOut(e.row),
      ftsRank: e.ftsRank,
      vectorRank: e.vectorRank,
      rrfScore: Number(e.rrfScore.toFixed(6)),
    })),
  };
}

export type SimilarStatutesResult = {
  statuteId: number;
  method: "vector" | "fts";
  provider: string;
  statute: StatuteOut;
  results: StatuteOut[];
};

/** Lazily embed a statute row (dev convenience; batch embedder covers bulk). */
async function ensureStatuteEmbedding(row: Statute): Promise<number[]> {
  if (row.embedding) return row.embedding;
  const emb = await embedText(statuteEmbeddingText(row));
  await db
    .update(statutesTable)
    .set({ embedding: emb })
    .where(eq(statutesTable.id, row.id));
  return emb;
}

/**
 * Similar-provision lookup: pgvector cosine KNN over statute embeddings
 * ("provisions similar to Section 138 NI Act"); explicit FTS fallback on
 * heading keywords when the vector leg fails — `method` reports which ran.
 */
export async function findSimilarStatutes(
  id: number,
  limit = 5,
): Promise<SimilarStatutesResult | null> {
  const provider = embeddingProvider();
  const [row] = await db
    .select()
    .from(statutesTable)
    .where(eq(statutesTable.id, id))
    .limit(1);
  if (!row) return null;

  try {
    const emb = await ensureStatuteEmbedding(row);
    const embLiteral = `[${emb.join(",")}]`;
    const neighbors = await db
      .select()
      .from(statutesTable)
      .where(and(isNotNull(statutesTable.embedding), ne(statutesTable.id, id)))
      .orderBy(sql`${statutesTable.embedding} <=> ${embLiteral}::vector`)
      .limit(limit);
    if (neighbors.length > 0) {
      return {
        statuteId: id,
        method: "vector",
        provider,
        statute: statuteToOut(row),
        results: neighbors.map(statuteToOut),
      };
    }
  } catch (err) {
    logger.warn(
      { err: String(err), id },
      "statute vector similarity failed; falling back to FTS",
    );
  }

  const q = row.heading
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join(" OR ");
  const fts = q
    ? (await searchStatutes({ q, limit: limit + 1 })).results.filter(
        (r) => r.id !== id,
      )
    : [];
  return {
    statuteId: id,
    method: "fts",
    provider,
    statute: statuteToOut(row),
    results: fts.slice(0, limit),
  };
}

export async function listStatutes(opts: {
  code?: string;
  jurisdiction?: string;
  limit?: number;
}): Promise<{ total: number; results: StatuteOut[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 600);
  const conds = [];
  if (opts.code) conds.push(eq(statutesTable.code, opts.code));
  if (opts.jurisdiction)
    conds.push(eq(statutesTable.jurisdiction, opts.jurisdiction));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(statutesTable)
    .where(where)
    .orderBy(statutesTable.code, statutesTable.section)
    .limit(limit);

  // True total for the filter (independent of the page limit) so the UI can
  // report the real corpus size rather than a count capped at the page size.
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statutesTable)
    .where(where)) as [{ count: number }];

  return { total: count, results: rows.map(statuteToOut) };
}

/** Exact section lookup within a code (e.g. IPC 420, BNS 318). */
export async function getStatuteBySection(
  code: string,
  section: string,
): Promise<StatuteOut | null> {
  const norm = section.trim().toUpperCase();
  const [exact] = await db
    .select()
    .from(statutesTable)
    .where(
      and(
        eq(statutesTable.code, code),
        sql`upper(${statutesTable.section}) = ${norm}`,
      ),
    )
    .limit(1);
  if (exact) return statuteToOut(exact);
  // Fall back to prefix match so "318" finds "318(4)" and vice versa.
  const base = norm.replace(/\(.*$/, "");
  const [prefix] = await db
    .select()
    .from(statutesTable)
    .where(
      and(
        eq(statutesTable.code, code),
        sql`upper(${statutesTable.section}) LIKE ${base + "%"}`,
      ),
    )
    .limit(1);
  return prefix ? statuteToOut(prefix) : null;
}

export type OldNewComparison = {
  oldCode: string;
  newCode: string;
  oldSection: string;
  found: boolean;
  matches: StatuteOut[];
};

const OLD_TO_NEW: Record<string, string> = {
  CrPC: "BNSS",
  IEA: "BSA",
};

/**
 * Reverse lookup for old-code sections whose text is not in the corpus:
 * finds new-code rows (BNSS/BSA) whose official mapping references the old
 * section (e.g. CrPC 438 → BNSS 482).
 */
export async function compareOldToNew(
  oldCode: string,
  oldSection: string,
): Promise<OldNewComparison> {
  const newCode = OLD_TO_NEW[oldCode];
  if (!newCode) {
    return { oldCode, newCode: "", oldSection, found: false, matches: [] };
  }
  const norm = oldSection.trim().toUpperCase();
  const base = norm.replace(/\(.*$/, "");
  const rows = await db
    .select()
    .from(statutesTable)
    .where(
      and(
        eq(statutesTable.code, newCode),
        eq(statutesTable.mappedCode, oldCode),
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${statutesTable.mappedSections}) AS m(sec)
          WHERE upper(m.sec) = ${norm}
             OR upper(m.sec) LIKE ${base + "(%"}
             OR ${norm} LIKE upper(m.sec) || '(%'
        )`,
      ),
    )
    .orderBy(
      sql`(regexp_match(${statutesTable.section}, '^\\d+'))[1]::int NULLS LAST`,
      statutesTable.section,
    );
  return {
    oldCode,
    newCode,
    oldSection: norm,
    found: rows.length > 0,
    matches: rows.map(statuteToOut),
  };
}

export type NewOldComparison = {
  newCode: string;
  oldCode: string;
  newSection: string;
  found: boolean;
  statute: StatuteOut | null;
  oldSections: string[];
  matches: StatuteOut[];
  /*
   * NV-CHANGE-NOTES-REVERSE-001 (2026-08-19) — the narrative, on the reverse direction too.
   *
   * `compare/ipc-bns` returned prose ("Recast as BNS Section 318(4)… no 'Section 420' in
   * BNS") while `compare/new-old` returned `changeNotes: null` for the same section pair.
   * The reverse direction is where an advocate needs it MOST: they are reading a pre-2023
   * brief, they hold the BNS section, and they want to know what changed.
   *
   * The prose was never missing from the data — it lives on the IPC rows, which are exactly
   * the rows already returned in `matches[]` via `statuteToOut`. It simply was not surfaced
   * at the top level where a caller looks for it. Joining the distinct notes across matches
   * (rather than picking the first) matters because BNS 318 maps back to IPC 415/417/418/420
   * and each may carry its own note.
   */
  changeNotes: string | null;
};

/**
 * NV-CHANGE-NOTES-REVERSE-001 — collect the change narrative from the old-code rows.
 *
 * De-duplicated and joined: a 1-to-many reverse mapping (BNS 318 → IPC 415/417/418/420) can
 * repeat the same consolidation note on every row, and showing it four times would read as
 * four distinct changes.
 */
function joinChangeNotes(rows: Array<{ changeNotes?: string | null }>): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const n = String(r?.changeNotes ?? "").trim();
    if (n) seen.add(n);
  }
  return seen.size > 0 ? Array.from(seen).join(" ") : null;
}

const NEW_TO_OLD: Record<string, string> = {
  BNSS: "CrPC",
  BSA: "IEA",
  BNS: "IPC",
};

/**
 * Reverse lookup: given a new-code section (BNSS/BSA/BNS), find which old-code
 * provision(s) it replaced (CrPC/IEA/IPC), using the corpus mapping columns.
 * - BNSS/BSA rows carry mappedCode/mappedSections directly (new→old).
 * - BNS: the mapping lives on IPC rows (old→new), so we reverse-query IPC rows
 *   whose mappedSections reference the BNS section.
 * No LLM involved.
 */
export async function compareNewToOld(
  newCode: string,
  newSection: string,
): Promise<NewOldComparison> {
  const oldCode = NEW_TO_OLD[newCode];
  if (!oldCode) {
    return {
      newCode,
      oldCode: "",
      newSection,
      found: false,
      statute: null,
      oldSections: [],
      matches: [],
      /* Always present, so a caller never has to distinguish "absent" from "null". */
      changeNotes: null,
    };
  }
  const norm = newSection.trim().toUpperCase();
  const statute = await getStatuteBySection(newCode, norm);

  let oldSections: string[] = [];
  if (statute && statute.mappedCode === oldCode && statute.mappedSections.length > 0) {
    // BNSS/BSA rows carry the old-code mapping directly.
    oldSections = statute.mappedSections;
  } else {
    // BNS→IPC: mapping is stored on the IPC rows; reverse-query them.
    const base = norm.replace(/\(.*$/, "");
    const rows = await db
      .select()
      .from(statutesTable)
      .where(
        and(
          eq(statutesTable.code, oldCode),
          eq(statutesTable.mappedCode, newCode),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${statutesTable.mappedSections}) AS m(sec)
            WHERE upper(m.sec) = ${norm}
               OR upper(m.sec) LIKE ${base + "(%"}
               OR ${norm} LIKE upper(m.sec) || '(%'
          )`,
        ),
      )
      .orderBy(
        sql`(regexp_match(${statutesTable.section}, '^\\d+'))[1]::int NULLS LAST`,
        statutesTable.section,
      );
    if (rows.length > 0) {
      const out = rows.map(statuteToOut);
      return {
        newCode,
        oldCode,
        newSection: norm,
        found: true,
        statute,
        oldSections: rows.map((r) => r.section),
        matches: out,
        changeNotes: joinChangeNotes(out),
      };
    }
  }

  // Resolve old-code rows in the corpus when present (e.g. IPC; CrPC/IEA text
  // is not seeded, so these lookups typically return nothing for them).
  const matches: StatuteOut[] = [];
  const seen = new Set<number>();
  for (const sec of oldSections) {
    const row = await getStatuteBySection(oldCode, sec);
    if (row && !seen.has(row.id)) {
      seen.add(row.id);
      matches.push(row);
    }
  }
  return {
    newCode,
    oldCode,
    newSection: norm,
    found: oldSections.length > 0,
    statute,
    oldSections,
    matches,
    /* `matches` may be empty for CrPC/IEA (their text is not seeded), in which case there is
     * no note to surface and `null` is the honest answer rather than an invented summary. */
    changeNotes: joinChangeNotes(matches),
  };
}

export type IpcBnsComparison = {
  ipcSection: string;
  found: boolean;
  ipc: StatuteOut | null;
  bnsMatches: StatuteOut[];
  changeNotes: string | null;
};

/** IPC → BNS comparator: side-by-side text plus change notes. */
export async function compareIpcToBns(
  ipcSection: string,
): Promise<IpcBnsComparison> {
  const ipc = await getStatuteBySection("IPC", ipcSection);
  if (!ipc) {
    return {
      ipcSection,
      found: false,
      ipc: null,
      bnsMatches: [],
      changeNotes: null,
    };
  }
  const bnsMatches: StatuteOut[] = [];
  const seen = new Set<number>();
  for (const target of ipc.mappedSections) {
    const bns = await getStatuteBySection("BNS", target);
    if (bns && !seen.has(bns.id)) {
      seen.add(bns.id);
      bnsMatches.push(bns);
    }
  }
  return {
    ipcSection: ipc.section,
    found: true,
    ipc,
    bnsMatches,
    changeNotes: ipc.changeNotes,
  };
}
