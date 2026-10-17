/**
 * NV-NYS-KNOWLEDGE-RETRIEVER-001 — Map NYS retrieval plane → Auto-RAG chunks.
 *
 * Channel A of the federated Knowledge Plane: call NYS POST /retrieve
 * (RetrievalPlan with steps[] per live OpenAPI) and emit AutoRagChunk[] for
 * RRF fusion inside nv-auto-rag-router. Fully fail-soft — empty array on any error.
 *
 * Supports both live OpenAPI shape (steps[]) and legacy flat envelopes.
 */
import { createLogger } from '../utils/logger.js';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';
import {
  isNysKnowledgeConfigured,
  nysKnowledgeRequest,
} from './jrx-nys-knowledge-client.js';
import {
  detectAuthorityTierRequest,
  type AuthorityTier,
  type AuthorityTierRequest,
} from './jrx-authority-salience.js';
import type { AutoRagChunk } from './jrx-auto-rag-router.js';
import { getPlatformReferenceYear } from '../utils/jrx-platform-temporal-context.js';

const logger = createLogger('./jrx-nys-knowledge-retriever');

/** NV-NYS-CASELAW-MODE-001 — numeric section queries use FTS (hybrid 503/latency risk). */
export function resolveCaselawSearchMode(query: string): 'fts' | 'hybrid' {
  const q = String(query || '');
  if (/\b(section|s\.|u\/s|u\.s\.|bns|bnss|ipc|crpc|bsa|iea)\s*\d{1,4}\b/i.test(q)) {
    return 'fts';
  }
  if (/\b(?:ipc|crpc|iea|bns|bnss|bsa)\s*\d{1,4}\b/i.test(q)) {
    return 'fts';
  }
  // HC embedding coverage is partial — FTS on metadata/terms is more reliable for recent HC rows.
  if (/\b(high court|\bhc\b|telangana|andhra|delhi|madras|bombay|calcutta|recent|latest|2024|2025|2026)\b/i.test(q)) {
    return 'fts';
  }
  return 'hybrid';
}

/** Court tier filter when the query names a tier explicitly. */
export function resolveCaselawCourtType(query: string): 'sc' | 'hc' | undefined {
  const q = String(query || '');
  if (/\bhigh court\b/i.test(q) || /\bhc\b/i.test(q)) return 'hc';
  if (/\b(supreme court|\bsc\b|apex court)\b/i.test(q) && !/\bhigh court\b/i.test(q)) return 'sc';
  return undefined;
}

/** Default year floor for leading-authority / historical counsel queries. */
export function resolveCaselawYearFrom(query: string, refYear = getPlatformReferenceYear()): number | undefined {
  const q = String(query || '');
  if (/\b(recent|latest|this year|current year|2024|2025|2026)\b/i.test(q)) {
    return Math.max(2020, refYear - 3);
  }
  if (/\b(leading|landmark|authorities|precedent|since\s+independence|1950|historical|evolution\s+of)\b/i.test(q)) {
    return 1950;
  }
  if (/\b(since\s+19[5-9]\d|from\s+19[5-9]\d)\b/i.test(q)) {
    const m = q.match(/\b(?:since|from)\s+(19[5-9]\d)\b/i);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** Upper year bound for recent-period queries. */
export function resolveCaselawYearTo(query: string, refYear = getPlatformReferenceYear()): number | undefined {
  const q = String(query || '');
  if (/\b(recent|latest|this year|current year|2024|2025|2026|till date|ytd)\b/i.test(q)) {
    return refYear;
  }
  const explicit = q.match(/\b(20[2-3]\d)\b/g);
  if (explicit?.length) {
    const nums = explicit.map(Number).filter((y) => y >= 2020 && y <= refYear);
    if (nums.length) return Math.max(...nums);
  }
  return undefined;
}

export const NYS_GLOBAL_NAMESPACES = {
  statutesIN: 'global:statutes:IN',
  caselawIN: 'global:caselaw:IN',
  caselawUS: 'global:caselaw:US',
  templatesIN: 'global:templates:IN',
  templatesUS: 'global:templates:US',
} as const;

/** NV-NI-ACT-SC-PREFETCH-001 — NI Act §138/139 authority-seeking research. */
export function isNiActAuthorityQuery(query: string): boolean {
  const q = String(query || '');
  return /\b(section\s*(?:138|139)|negotiable instruments act|ni\s*act|cheque dishonou?r)\b/i.test(q)
    && /\b(authorit(?:y|ies)|leading|landmark|presumption|rebuttal|burden|cite)\b/i.test(q);
}

/** Content-only FTS query — tier/request words poison metadata AND semantics. */
export function buildNiActAuthorityFtsQuery(): string {
  return 'Negotiable Instruments Act presumption Section 139 holder cheque dishonour rebuttal';
}

type NysStatute = {
  id?: string | number;
  code?: string;
  section?: string;
  title?: string;
  text?: string;
  content?: string;
  heading?: string;
  score?: number;
};

type NysCase = {
  id?: string | number;
  title?: string;
  citation?: string;
  court?: string;
  year?: number;
  snippet?: string;
  summary?: string;
  score?: number;
  /**
   * NV-CITE-GROUND-001 (2026-08-19) — the rest of `CaselawDocOut`.
   *
   * NYS returns these on every judgment row (`rdsCaselaw.ts` `rowToDoc` →
   * `/caselaw/search`, `/retrieve` `matches[]`/`results[]`), and they were simply
   * not in this type, so they were dropped on the floor. Two consequences,
   * both measured:
   *
   *   • `citation` is populated only for `court_type='sc'` (the HC and DC ingest
   *     mappers in `ingest-rds.ts` hardcode `citation: null`), so a reference
   *     built from `citation` alone is blank on the overwhelming majority of the
   *     corpus. `cnr` / `caseNo` / `court` / `year` are what remain.
   *   • Neither `snippet` nor `summary` is ever returned by the RDS-backed
   *     caselaw path — the headnote lives in `description`. Without it,
   *     `caseToChunk` fell through to `citation || title` and the model received
   *     an authority with no substance at all.
   */
  cnr?: string | null;
  caseNo?: string | null;
  caseType?: string | null;
  courtType?: string | null;
  decisionDate?: string | null;
  description?: string | null;
  disposalNature?: string | null;
};

type NysComparison = {
  summary?: string;
  title?: string;
  text?: string;
  ipcSection?: string;
  bnsSection?: string;
  oldSection?: string;
  newSection?: string;
  oldCode?: string;
  newCode?: string;
};

/** Live OpenAPI RetrievalStep (nested under RetrievalPlan.steps). */
interface NysRetrievalStep {
  tool?: string;
  statutes?: NysStatute[];
  matches?: NysCase[];
  results?: NysCase[];
  comparison?: NysComparison;
  oldNew?: NysComparison;
  newOld?: NysComparison;
  citations?: Array<{ raw?: string; matched?: boolean }>;
  jurisdiction?: string;
}

/**
 * Live OpenAPI RetrievalPlan + legacy flat fields for backward compat.
 */
export interface NysRetrievePlan {
  query?: string;
  intent?: string;
  steps?: NysRetrievalStep[];
  llmRequired?: boolean;
  reason?: string;
  /** Legacy flat envelope (pre-OpenAPI-aligned). */
  statutes?: NysStatute[];
  cases?: NysCase[];
  comparisons?: NysComparison[];
  citations?: Array<{ raw?: string; matched?: boolean }>;
  method?: string;
}

function statuteToChunk(s: NysStatute, jurisdiction: string): AutoRagChunk {
  const title = s.title || s.heading || `${s.code ?? 'STATUTE'} §${s.section ?? ''}`.trim();
  const content = (s.text || s.content || '').slice(0, 4000);
  const ref = s.code && s.section ? `${s.code} §${s.section}` : title;
  return {
    id: `nys:statute:${s.id ?? `${s.code}:${s.section}`}`,
    source: NYS_GLOBAL_NAMESPACES.statutesIN.replace(':IN', `:${jurisdiction}`),
    title,
    content: content || title,
    jurisdiction,
    score: typeof s.score === 'number' ? s.score : 0.7,
    layer: 'nys_global',
    citationRef: ref,
    authorityRef: ref,
  };
}

const cleanField = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * NV-AUTHORITY-SALIENCE-001 — which court tier decided this judgment.
 *
 * `courtType` is authoritative when NYS sends it (`rowToDoc` maps `court_type`
 * straight through, values `'sc' | 'hc' | 'dc'`). The `court` free-text fallback
 * exists for the legacy flat envelope and the non-RDS `searchIndianCaselaw`
 * backend, neither of which carries `courtType`. Returns `undefined` rather than
 * guessing a tier: an unknown tier must add no ranking signal, because a wrong
 * tier label would silently demote a correct authority.
 */
export function resolveCourtTier(c: NysCase): AuthorityTier | undefined {
  const explicit = cleanField(c.courtType).toLowerCase();
  if (explicit === 'sc' || explicit === 'hc' || explicit === 'dc') return explicit;
  const court = cleanField(c.court).toLowerCase();
  if (!court) return undefined;
  if (/\bsupreme\s+court\b/.test(court)) return 'sc';
  if (/\bhigh\s+court\b/.test(court)) return 'hc';
  if (/\b(district|sessions|magistrate|trial)\b/.test(court)) return 'dc';
  return undefined;
}

/**
 * A real reporter citation, as opposed to the corpus habit of mirroring the
 * title into `citation`. Shares the exact test `buildCaseAuthorityRef` uses so
 * the two cannot drift: if this says a row is citable, that function will render
 * a reporter citation for it.
 */
export function hasReporterCitation(c: NysCase): boolean {
  const citation = cleanField(c.citation);
  if (!citation) return false;
  return citation.toLowerCase() !== cleanField(c.title).toLowerCase();
}

/**
 * NV-CITE-GROUND-001 (2026-08-19) — build a reference a practitioner could
 * actually use to find the judgment, from whatever metadata this row has.
 *
 * A reporter citation is preferred and is self-sufficient when present, but it
 * exists for only `court_type='sc'` rows (43,505 of 26,259,225 ≈ 0.17%) because
 * `ingest-rds.ts` `mapHcRow` and `mapDcRow` both hardcode `citation: null`.
 * Rendering only `citation` would therefore leave ~99.8% of retrieved
 * authorities with no reference at all, so the fallback ladder is:
 *
 *   court + year   → which bench and when (always available; `title` is NOT NULL
 *                    and `year` is populated for every ingest path)
 *   CNR            → the unique national case identifier, populated by all three
 *                    mappers where the source record carries one
 *   caseType/caseNo→ the filing number, when CNR is absent
 *   decision date   → last resort discriminator
 *
 * Returns `undefined` rather than an empty string when nothing is available, so
 * the renderer can suppress the ` — ` separator instead of emitting a dangling
 * one. Exported for unit tests: the SC-with-citation, HC-with-null-citation and
 * DC-synthesised-title cases are the three that must each behave differently.
 */
export function buildCaseAuthorityRef(c: NysCase): string | undefined {
  const title = cleanField(c.title);
  const citation = cleanField(c.citation);
  const parts: string[] = [];

  // A real reporter citation is the reference. Guard against the corpus habit of
  // mirroring the title into `citation`, which would make the render "X — X".
  const hasRealCitation = citation.length > 0 && citation.toLowerCase() !== title.toLowerCase();
  if (hasRealCitation) {
    parts.push(citation);
  } else {
    const court = cleanField(c.court);
    const year = c.year
      ? String(c.year)
      : (cleanField(c.decisionDate).match(/^(\d{4})/)?.[1] ?? '');
    const where = [court, year].filter(Boolean).join(', ');
    if (where) parts.push(where);
  }

  // A locator, only when there is no reporter citation to look the case up by.
  if (!hasRealCitation) {
    const cnr = cleanField(c.cnr);
    const caseNo = [cleanField(c.caseType), cleanField(c.caseNo)].filter(Boolean).join(' ');
    if (cnr) parts.push(`CNR ${cnr}`);
    else if (caseNo) parts.push(`Case No ${caseNo}`);
    else {
      const decided = cleanField(c.decisionDate);
      if (decided && !parts.length) parts.push(`decided ${decided}`);
    }
  }

  const ref = parts.join(' · ');
  return ref ? ref.slice(0, 200) : undefined;
}

function caseToChunk(c: NysCase, jurisdiction: string): AutoRagChunk {
  const title = c.title || c.citation || `Case ${c.id ?? ''}`;
  /* `description` is the corpus headnote and is the ONLY substantive text NYS
   * returns — judgment `full_text` is excluded from `SELECT_COLS` and never
   * served (there is an `archive-fulltext-hint` step whose guidance says "Do not
   * invent passages"). `snippet`/`summary` are kept first for the legacy flat
   * envelope, but neither appears in `CaselawDocOut`, so before `description`
   * was read this fell through to `citation || title` — i.e. the model was
   * handed an authority whose entire "content" was its own name. */
  const body = c.snippet || c.summary || c.description || '';
  const authorityRef = buildCaseAuthorityRef(c);
  const tier = resolveCourtTier(c);
  const disposal = cleanField(c.disposalNature);
  const content = (
    body
      ? (disposal ? `${body}\n(Disposal: ${disposal})` : body)
      : `${title}${authorityRef ? ` — ${authorityRef}` : ''}`
        + '\n(Metadata-only corpus record: no headnote text available. Do not invent passages.)'
  ).slice(0, 4000);
  const ns = jurisdiction === 'US' ? NYS_GLOBAL_NAMESPACES.caselawUS : NYS_GLOBAL_NAMESPACES.caselawIN;
  return {
    id: `nys:case:${c.id ?? c.citation ?? title}`,
    source: ns,
    title,
    content,
    jurisdiction,
    score: typeof c.score === 'number' ? c.score : 0.65,
    layer: 'nys_global',
    /* Unchanged on purpose: `citationRef` is the RRF dedup identity via
     * `chunkKey()`. Two 1980 Supreme Court judgments with no reporter citation
     * would collide on a synthesised "Supreme Court, 1980" key and one would be
     * silently fused away, so the display reference goes in `authorityRef`. */
    citationRef: c.citation || title,
    ...(authorityRef ? { authorityRef } : {}),
    ...(tier ? { courtTier: tier } : {}),
    hasReporterCitation: hasReporterCitation(c),
  };
}

function comparisonToChunk(cmp: NysComparison, index: number, jurisdiction: string): AutoRagChunk | null {
  const text =
    cmp.text ||
    cmp.summary ||
    [
      cmp.oldCode && cmp.oldSection ? `${cmp.oldCode} §${cmp.oldSection}` : null,
      cmp.ipcSection ? `IPC §${cmp.ipcSection}` : null,
      cmp.newCode && cmp.newSection ? `${cmp.newCode} §${cmp.newSection}` : null,
      cmp.bnsSection ? `BNS §${cmp.bnsSection}` : null,
    ]
      .filter(Boolean)
      .join(' → ');
  if (!text) return null;
  return {
    id: `nys:cmp:${index}`,
    source: NYS_GLOBAL_NAMESPACES.statutesIN.replace(':IN', `:${jurisdiction}`),
    title: cmp.title || 'Code comparison',
    content: text.slice(0, 4000),
    jurisdiction,
    score: 0.6,
    layer: 'nys_global',
  };
}

/**
 * Flatten live RetrievalPlan.steps[] (and legacy flat fields) → AutoRagChunk[].
 * Exported for unit tests.
 */
export function flattenRetrievalPlanToChunks(
  plan: NysRetrievePlan,
  jurisdiction: string,
  topK: number,
): AutoRagChunk[] {
  const chunks: AutoRagChunk[] = [];
  const push = (c: AutoRagChunk | null | undefined) => {
    if (!c || chunks.length >= topK) return;
    chunks.push(c);
  };

  // Live OpenAPI: steps[] with nested payloads
  for (const step of plan.steps ?? []) {
    if (chunks.length >= topK) break;
    const stepJcn = (step.jurisdiction || jurisdiction).toUpperCase();
    for (const s of step.statutes ?? []) push(statuteToChunk(s, stepJcn));
    for (const c of step.matches ?? []) push(caseToChunk(c, stepJcn));
    for (const c of step.results ?? []) push(caseToChunk(c, stepJcn));
    if (step.comparison) push(comparisonToChunk(step.comparison, chunks.length, stepJcn));
    if (step.oldNew) push(comparisonToChunk(step.oldNew, chunks.length, stepJcn));
    if (step.newOld) push(comparisonToChunk(step.newOld, chunks.length, stepJcn));
  }

  // Legacy flat envelope
  for (const s of plan.statutes ?? []) push(statuteToChunk(s, jurisdiction));
  for (const c of plan.cases ?? []) push(caseToChunk(c, jurisdiction));
  for (const cmp of plan.comparisons ?? []) {
    push(comparisonToChunk(cmp, chunks.length, jurisdiction));
  }

  return chunks.slice(0, topK);
}

/**
 * Drop repeats by chunk id. The tier leg and the plan's `case-search` step query
 * the same table, so the same judgment can arrive twice; the router's RRF would
 * treat the duplicate as independent corroboration and inflate its rank.
 */
function dedupeChunksById(chunks: AutoRagChunk[]): AutoRagChunk[] {
  const seen = new Set<string>();
  const out: AutoRagChunk[] = [];
  for (const c of chunks) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * NV-AUTHORITY-SALIENCE-001 — the tier-scoped authority leg.
 *
 * Runs ONLY when the query named a court tier (or asked for leading authority).
 * It exists because of two measured facts about the corpus, not as a general
 * "more retrieval is better" hop:
 *
 *  1. `websearch_to_tsquery` ANDs every lexeme, and the tier-request words
 *     ("leading", "Supreme Court", "authorities") can never appear in the
 *     metadata-only `search_tsv`. Searching the *content* terms alone is what
 *     makes the FTS leg non-empty at all: the reference query matched 0 of
 *     26,259,225 rows; its content-only form
 *     ("anticipatory bail economic offences") matches 30.
 *  2. `mode=fts` + `courtType` is the only way to reach the requested tier.
 *     The hybrid vector leg cannot: SC `description` is NULL for 42,377 of
 *     43,505 rows, so an SC landmark's embedding encodes little more than its
 *     party names and its 30-nearest set contains zero SC rows.
 *
 * Fail-soft and additive: on any failure the caller keeps the chunks it already
 * has, so a bad hop degrades to today's behaviour rather than losing grounding.
 */
/**
 * NV-NI-ACT-SC-PREFETCH-001 — targeted SC caselaw leg for NI Act presumption
 * research when the general retrieve plan returns statutes/smoke rows only.
 */
async function retrieveNiActScAuthorities(opts: {
  topK: number;
  timeoutMs?: number;
}): Promise<{ chunks: AutoRagChunk[]; method: string }> {
  const res = await nysKnowledgeRequest<{ results?: NysCase[]; method?: string }>({
    method: 'GET',
    path: '/caselaw/search',
    query: {
      q: buildNiActAuthorityFtsQuery(),
      jurisdiction: 'IN',
      courtType: 'sc',
      mode: 'fts',
      limit: Math.min(Math.max(opts.topK, 5), 10),
    },
    timeoutMs: opts.timeoutMs,
  });
  if (!res.ok || !Array.isArray(res.data?.results) || res.data.results.length === 0) {
    return { chunks: [], method: 'nys:ni-act-sc:empty' };
  }
  return {
    chunks: res.data.results.slice(0, opts.topK).map((c) => caseToChunk(c, 'IN')),
    method: `nys:ni-act-sc:${res.data.method || 'fts'}`,
  };
}

async function retrieveTierScopedAuthorities(opts: {
  request: AuthorityTierRequest;
  jurisdiction: 'IN' | 'US';
  topK: number;
  timeoutMs?: number;
}): Promise<{ chunks: AutoRagChunk[]; method: string }> {
  // `courtType` is only meaningful for the RDS-backed Indian corpus, and the
  // NYS route schema accepts `'sc' | 'hc'` only — a `dc` request must not be
  // sent as a filter the API will reject with a 400.
  if (opts.jurisdiction !== 'IN' || opts.request.tier === 'dc') {
    return { chunks: [], method: 'nys:tier:not_applicable' };
  }
  const res = await nysKnowledgeRequest<{ results?: NysCase[]; method?: string }>({
    method: 'GET',
    path: '/caselaw/search',
    query: {
      q: opts.request.contentQuery,
      jurisdiction: 'IN',
      courtType: opts.request.tier,
      mode: 'fts',
      limit: Math.min(Math.max(opts.topK, 3), 10),
    },
    timeoutMs: opts.timeoutMs,
  });
  if (!res.ok || !Array.isArray(res.data?.results) || res.data.results.length === 0) {
    return { chunks: [], method: `nys:tier:${opts.request.tier}:empty` };
  }
  return {
    chunks: res.data.results.slice(0, opts.topK).map((c) => caseToChunk(c, 'IN')),
    method: `nys:tier:${opts.request.tier}:fts`,
  };
}

/**
 * Retrieve global public-law context from NYS for Auto-RAG fusion.
 * Returns [] when flag off, unconfigured, or any failure.
 */
export async function retrieveNysGlobalKnowledge(opts: {
  query: string;
  jurisdiction?: string;
  topK?: number;
  /** Optional override for sync UX — caps this hop under Auto-RAG deadline. */
  timeoutMs?: number;
}): Promise<{
  chunks: AutoRagChunk[];
  method: string;
  llmRequired?: boolean;
  intent?: string;
  /** NV-AUTHORITY-SALIENCE-001 — the tier the query asked for, if any. */
  tierRequest?: AuthorityTierRequest;
}> {
  if (!isNyvFeatureOn('nysKnowledgePlane')) {
    return { chunks: [], method: 'nys:flag_off' };
  }
  if (!isNysKnowledgeConfigured()) {
    return { chunks: [], method: 'nys:unconfigured' };
  }

  const jurisdiction = (opts.jurisdiction || 'IN').toUpperCase();
  const jcn = jurisdiction === 'US' ? 'US' : 'IN';
  const topK = opts.topK ?? 8;
  const hopTimeout = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
    ? opts.timeoutMs
    : undefined;

  /* NV-AUTHORITY-SALIENCE-001 — pure regex over the prompt, no I/O, so it is
   * safe to compute before deciding which hops to run. `undefined` for the
   * overwhelming majority of queries, which then behave exactly as before. */
  const tierRequest = detectAuthorityTierRequest(opts.query) ?? undefined;
  const niActAuthorityQuery = isNiActAuthorityQuery(opts.query);

  try {
    /* The tier leg runs in PARALLEL with the plan, not as a fallback after it.
     * The plan hop succeeds on this query (intent=case-search, 5 results — it
     * is not failing), so anything gated behind "the plan returned nothing"
     * would never execute. Both lists are then handed to the caller for RRF,
     * which is the existing fusion point; no second ranker is introduced. */
    const [planRes, tierHit, niActHit] = await Promise.all([
      nysKnowledgeRequest<NysRetrievePlan>({
        method: 'POST',
        path: '/retrieve',
        body: { query: opts.query, jurisdiction: jcn },
        timeoutMs: hopTimeout,
      }),
      tierRequest
        ? retrieveTierScopedAuthorities({
          request: tierRequest,
          jurisdiction: jcn,
          topK,
          timeoutMs: hopTimeout,
        }).catch((e) => {
          logger.warn('NYS tier-scoped authority leg failed (non-fatal)', {
            error: (e as Error).message,
          });
          return { chunks: [] as AutoRagChunk[], method: 'nys:tier:error' };
        })
        : Promise.resolve({ chunks: [] as AutoRagChunk[], method: 'nys:tier:none' }),
      niActAuthorityQuery
        ? retrieveNiActScAuthorities({ topK, timeoutMs: hopTimeout }).catch((e) => {
          logger.warn('NYS NI Act SC authority leg failed (non-fatal)', {
            error: (e as Error).message,
          });
          return { chunks: [] as AutoRagChunk[], method: 'nys:ni-act-sc:error' };
        })
        : Promise.resolve({ chunks: [] as AutoRagChunk[], method: 'nys:ni-act-sc:none' }),
    ]);

    const authorityPrefix = [
      ...(niActHit.chunks.length > 0 ? [niActHit.method] : []),
      ...(tierHit.chunks.length > 0 ? [tierHit.method] : []),
    ].join('+');

    if (planRes.ok) {
      const plan = planRes.data || {};
      /* Tier-scoped hits are placed FIRST, and the plan's own results fill the
       * remaining budget. This is not a thumb on the scale: on `topK` as low as
       * 6 the tier hits would otherwise be truncated away before the router
       * ever sees them, so ordering here is what makes them eligible for
       * fusion at all. RRF and the cross-encoder still decide the final order. */
      const planChunks = flattenRetrievalPlanToChunks(plan, jcn, topK);
      const merged = dedupeChunksById([
        ...niActHit.chunks,
        ...tierHit.chunks,
        ...planChunks,
      ]).slice(0, topK);
      if (merged.length > 0) {
        return {
          chunks: merged,
          method: authorityPrefix
            ? `nys:retrieve:${plan.intent || plan.method || 'plan'}+${authorityPrefix}`
            : `nys:retrieve:${plan.intent || plan.method || 'plan'}`,
          llmRequired: plan.llmRequired,
          intent: plan.intent,
          ...(tierRequest ? { tierRequest } : {}),
        };
      }
    }

    const fallbackAuthority = dedupeChunksById([...niActHit.chunks, ...tierHit.chunks]).slice(0, topK);
    if (fallbackAuthority.length > 0) {
      return {
        chunks: fallbackAuthority,
        method: authorityPrefix || niActHit.method || tierHit.method,
        ...(tierRequest ? { tierRequest } : {}),
      };
    }

    // Fallback: hybrid statute search when retrieve returned nothing
    const statuteRes = await nysKnowledgeRequest<{
      results?: NysStatute[];
      method?: string;
    }>({
      method: 'GET',
      path: '/statutes/search',
      query: { q: opts.query, jurisdiction: jcn, limit: topK },
    });
    if (statuteRes.ok && Array.isArray(statuteRes.data?.results) && statuteRes.data.results.length > 0) {
      return {
        chunks: statuteRes.data.results.slice(0, topK).map((s) => statuteToChunk(s, jcn)),
        method: `nys:statutes:${statuteRes.data.method || 'search'}`,
        /* The tier request survives a fall through to statutes. This is the path
         * that matters most for the disclosure: the lawyer asked for Supreme
         * Court authority and we are about to hand back statute text, so the
         * gap note is the only thing that stops those statutes reading as if
         * they were the requested authorities. */
        ...(tierRequest ? { tierRequest } : {}),
      };
    }

    // Fallback: caselaw hybrid FTS+vector RRF (mode=hybrid default on NYS)
    const caselawMode = resolveCaselawSearchMode(opts.query);
    const yearFrom = resolveCaselawYearFrom(opts.query);
    const yearTo = resolveCaselawYearTo(opts.query);
    const courtType = resolveCaselawCourtType(opts.query);
    const caseQuery: Record<string, string | number> = {
      q: opts.query,
      jurisdiction: jcn,
      limit: Math.min(topK, 10),
      mode: caselawMode,
    };
    if (yearFrom != null) caseQuery.yearFrom = yearFrom;
    if (yearTo != null) caseQuery.yearTo = yearTo;
    if (courtType) caseQuery.courtType = courtType;
    const caseRes = await nysKnowledgeRequest<{
      results?: NysCase[];
      method?: string;
    }>({
      method: 'GET',
      path: '/caselaw/search',
      query: caseQuery,
    });
    if (caseRes.ok && Array.isArray(caseRes.data?.results) && caseRes.data.results.length > 0) {
      return {
        chunks: caseRes.data.results.slice(0, topK).map((c) => caseToChunk(c, jcn)),
        method: `nys:caselaw:${caseRes.data.method || 'search'}`,
        ...(tierRequest ? { tierRequest } : {}),
      };
    }

    return { chunks: [], method: 'nys:empty', ...(tierRequest ? { tierRequest } : {}) };
  } catch (e) {
    logger.warn('NYS global retrieve failed (non-fatal)', { error: (e as Error).message });
    return { chunks: [], method: 'nys:error', ...(tierRequest ? { tierRequest } : {}) };
  }
}

export type NysCitationStatus = 'verified' | 'not_found' | 'uncertain';

/** Citation verify oracle — POST /caselaw/verify-citation */
export async function nysVerifyCitation(citation: string, jurisdiction = 'IN'): Promise<{
  verified: boolean;
  status: NysCitationStatus;
  source: string;
  detail?: unknown;
} | null> {
  if (!isNyvFeatureOn('nysKnowledgePlane') || !isNysKnowledgeConfigured()) return null;
  const res = await nysKnowledgeRequest({
    method: 'POST',
    path: '/caselaw/verify-citation',
    body: { citation, jurisdiction },
  });
  if (!res.ok) return null;
  const data = res.data as Record<string, unknown>;
  const rawStatus = String(data?.status ?? '').toLowerCase();
  let status: NysCitationStatus = 'uncertain';
  if (rawStatus === 'verified' || data?.verified === true || data?.match === true || data?.found === true) {
    status = 'verified';
  } else if (rawStatus === 'not_found' || data?.verified === false || data?.found === false) {
    status = 'not_found';
  } else if (rawStatus === 'uncertain') {
    status = 'uncertain';
  }
  return {
    verified: status === 'verified',
    status,
    source: 'nys-caselaw',
    detail: data,
  };
}

/** Extract citations via NYS regex extractor (LLM-free). */
export async function nysExtractCitations(text: string, link = true): Promise<unknown | null> {
  if (!isNyvFeatureOn('nysKnowledgePlane') || !isNysKnowledgeConfigured()) return null;
  const res = await nysKnowledgeRequest({
    method: 'POST',
    path: '/citations/extract',
    body: { text, link },
  });
  return res.ok ? res.data : null;
}

/**
 * Gate 8 remediation: old→new code comparator via NYS.
 * Live OpenAPI: GET /statutes/compare/ipc-bns?section=
 *               GET /statutes/compare/old-new?from=CrPC|IEA&section=
 */
export async function nysCompareOldNew(opts: {
  fromCode: 'IPC' | 'CrPC' | 'IEA';
  section: string;
}): Promise<unknown | null> {
  if (!isNyvFeatureOn('nysKnowledgePlane') || !isNysKnowledgeConfigured()) return null;

  if (opts.fromCode === 'IPC') {
    const getRes = await nysKnowledgeRequest({
      method: 'GET',
      path: '/statutes/compare/ipc-bns',
      query: { section: opts.section },
    });
    if (getRes.ok) return getRes.data;
    const postRes = await nysKnowledgeRequest({
      method: 'POST',
      path: '/statutes/compare/ipc-bns',
      body: { ipcSection: opts.section, section: opts.section },
    });
    return postRes.ok ? postRes.data : null;
  }

  // CrPC → BNSS, IEA → BSA via unified old-new comparator
  const from = opts.fromCode; // CrPC | IEA
  const getRes = await nysKnowledgeRequest({
    method: 'GET',
    path: '/statutes/compare/old-new',
    query: { from, section: opts.section },
  });
  if (getRes.ok) return getRes.data;

  // Legacy path fallback (older NYS builds)
  const legacyPath =
    opts.fromCode === 'CrPC' ? '/statutes/compare/crpc-bnss' : '/statutes/compare/iea-bsa';
  const legacy = await nysKnowledgeRequest({
    method: 'GET',
    path: legacyPath,
    query: { section: opts.section },
  });
  return legacy.ok ? legacy.data : null;
}
