/**
 * NV-JRX-FULLTEXT-001 — on-demand full judgment text via the NYS Athena
 * archive path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Judgment bodies are deliberately NOT in the hot RDS metadata path: the
 * `judgments` table serves metadata + headnote (`description`) only, and
 * `full_text` is excluded from NYS `SELECT_COLS`. The real body lives as a PDF
 * in the owned S3 estate and is fetched on demand:
 *
 *   1. POST /athena/search  → Athena SQL over the Glue metadata tables
 *                             (nyv_docs.judgments_meta / judgments_meta_hc)
 *                             returns the row's `s3_path`.
 *   2. POST /athena/extract → NYS downloads that PDF, extracts text (OCR
 *                             fallback), caches it in `archive_extracts`, and
 *                             returns the body.
 *
 * Before this module JRX exposed both hops as bare proxies but nothing joined
 * them, and the only NYS archive MCP tool (`nys_athena_search`) returned
 * metadata. An agent could therefore discover an `s3_path` and had no way to
 * read the judgment — which is precisely how "full judgment text is not
 * available" became the received wisdom on the JRX side.
 *
 * COST / LATENCY CONTRACT (measured 2026-08-19 against the live NYS host)
 * ----------------------------------------------------------------------
 *  - Athena SC scope scans ~1.6 MB per query (~$0.000008).
 *  - Athena HC scope scans ~1.3-1.6 GB per query (~$0.006-0.007) because the
 *    server-side predicate is `lower(title) LIKE %q%` over an UNPARTITIONED
 *    table, so a year filter barely prunes. HC lookups are therefore ~800x the
 *    cost of SC ones and must stay explicitly requested, never implicit.
 *  - Cold extract of a 0.5 MB SC PDF: ~2.7 s. Warm (cached): ~13 ms.
 *
 * Consequence: this is an EXPLICIT, on-demand call only. It must never be
 * wired into the default RAG/orchestrate grounding path — see
 * `jrx-auto-rag-router` / `jrx-nys-knowledge-retriever`, which intentionally
 * ground on the headnote and say "Do not invent passages" instead.
 */
import { nysKnowledgeRequest } from './jrx-nys-knowledge-client.js';
import { normalizeNysAthenaSearchBody } from './jrx-nys-athena-normalize.js';
import { NV_TIMEOUTS } from '../config/jrx-timeout-policy.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-nys-judgment-fulltext');

/**
 * NYS on-demand extraction cap, mirrored here for callers that want to explain
 * a `TOO_LARGE` refusal without a round-trip.
 *
 * DOCUMENTATION ONLY — nothing in this module branches on it, and that is
 * verified by execution rather than asserted: `tests/unit/jrx-nys-judgment-fulltext.test.ts`
 * drives a 63,851,267-byte extract (Maneka Gandhi, well over the old 20 MB) all
 * the way to `ok: true`, which is only possible because no local gate reads this
 * value. The authoritative cap is `MAX_ARCHIVE_PDF_BYTES` in
 * `jrx-search/artifacts/api-server/src/lib/archiveDocs.ts`; NYS enforces it
 * and returns 413, which arrives here as `code: 'TOO_LARGE'`.
 *
 * Raised 20 → 96 MB with NYS (JRX-ARCHIVE-LARGE-PDF-001). 96 MB was chosen from
 * the corpus, not guessed: across all 176,997 SC PDFs the maximum object is
 * 68.79 MB, 43 exceed 20 MB, and none exceed 80 MB. Bytes are also the wrong
 * instrument for cost — extraction time tracks PAGE COUNT (Kesavananda 37.5 MB /
 * 1,006 pp took 4.8x longer than Maneka 63.9 MB / 156 pp) — so NYS additionally
 * enforces a page/time budget, which is what `truncated` below reports.
 */
export const JRX_ECOSYSTEM_EXTRACT_MAX_PDF_BYTES = 96 * 1024 * 1024;

/** Extract can require a cold S3 download + OCR; the default client timeout is too short. */
const EXTRACT_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = NV_TIMEOUTS.athenaQueryBudgetMs;

export type JudgmentArchiveScope = 'sc' | 'hc';

export interface JudgmentFullTextRequest {
  /** Direct owned-bucket path (skips the Athena resolve hop entirely — cheapest). */
  s3Path?: string;
  /** Case name / party / title fragment, when the s3Path is not known yet. */
  query?: string;
  /**
   * Archive scope for the resolve hop. Defaults to 'sc' (~1.6 MB scan).
   * 'hc' scans ~1.3 GB — only pass it when the caller really wants High Courts.
   */
  archive?: JudgmentArchiveScope;
  year?: number;
  court?: string;
  /** Stored alongside the cached extract for provenance. */
  title?: string;
  /**
   * Ask NYS to parse `paras[]` and the extractable structured fields from the
   * judgment text (JRX-JUDGMENT-STRUCTURE-001).
   *
   * Off by default so the existing payload shape is unchanged for current
   * callers. Parsing happens on the NYS side, over the text it already has in
   * hand, rather than shipping the body here and parsing twice.
   */
  structure?: boolean;
}

export interface JudgmentFullTextCandidate {
  title: string | null;
  court: string | null;
  year: string | null;
  citation: string | null;
  decisionDate: string | null;
  s3Path: string | null;
  archive: string | null;
}

/**
 * Structured judgment fields, as extracted by NYS from the judgment text.
 *
 * Every field is optional and the absence of one is meaningful: it means the
 * source did not carry it. `paras` is empty with `numbering: 'absent'` for the
 * (large) class of older Supreme Court Reports volumes that print unnumbered
 * prose — that is the honest answer, not a parser shortfall, and it must not be
 * papered over with inferred numbers.
 */
export interface JudgmentStructurePayload {
  paras: Array<{
    n: number;
    text: string;
    opinionIndex: number;
    opinionAuthor: string | null;
  }>;
  numbering: 'preserved' | 'absent' | 'ambiguous';
  numberingNote: string | null;
  opinions: Array<{
    index: number;
    author: string | null;
    paragraphCount: number;
    firstParagraph: number | null;
    lastParagraph: number | null;
  }>;
  extractedFields: string[];
  unavailableFields: string[];
  headnote: string | null;
  held: string | null;
  facts: string | null;
  issues: string | null;
  disposition: string | null;
  coram: string[];
  parallelCitations: string[];
  appealedFrom: string | null;
}

export interface JudgmentFullTextResult {
  ok: true;
  /** 'direct' when the caller supplied s3Path; 'athena-search' when resolved. */
  resolvedVia: 'direct' | 'athena-search';
  s3Path: string;
  requestedPath: string | null;
  title: string | null;
  citation: string | null;
  byteSize: number | null;
  textLength: number;
  text: string;
  ocrUsed: boolean | null;
  /** True when NYS served this from its archive_extracts cache (no S3 round-trip). */
  cached: boolean | null;
  /**
   * NYS stopped extracting before the end of the document — page budget, time
   * budget, OCR budget, or the 4 M-character ceiling.
   *
   * Surfaced because silent truncation of a legal authority is worse than a
   * refusal: Kesavananda Bharati is 2,878,447 characters over 1,006 pages, and a
   * caller that receives a partial body it cannot distinguish from a complete
   * one would quote a judgment it only partly read. `null` means the upstream
   * did not report the flag — which is NOT the same as "complete", so callers
   * must not coerce it to false.
   */
  truncated: boolean | null;
  /** Athena bytes scanned by the resolve hop; 0 when resolvedVia === 'direct'. */
  bytesScanned: number;
  estimatedCostUsd: number;
  /** Other Athena matches, so a caller can disambiguate without re-querying. */
  alternates: JudgmentFullTextCandidate[];
  latencyMs: { resolve: number; extract: number; total: number };
  /** Present only when `structure: true` was requested and NYS returned it. */
  structure?: JudgmentStructurePayload;
}

export interface JudgmentFullTextFailure {
  ok: false;
  status: number;
  code:
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'TOO_LARGE'
    | 'NO_TEXT'
    | 'UPSTREAM'
    | 'AMBIGUOUS';
  error: string;
  /** Populated on AMBIGUOUS/NOT_FOUND so the caller can pick and retry. */
  candidates?: JudgmentFullTextCandidate[];
  bytesScanned?: number;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function toCandidate(row: Record<string, unknown>): JudgmentFullTextCandidate {
  return {
    title: asString(row.title),
    court: asString(row.court),
    year: asString(row.year),
    citation: asString(row.citation),
    decisionDate: asString(row.decision_date),
    s3Path: asString(row.s3_path),
    archive: asString(row.archive),
  };
}

/**
 * Athena `s3_path` is already the allowlist-shaped `s3://bucket/key.pdf` that
 * NYS `parseAllowedS3Path` accepts. DC rows carry a *directory prefix*
 * (`.../complex=<code>/`) in `pdf_link` and their bucket is not in the NYS
 * allowlist at all, so a DC path can never extract — reject it here with a
 * useful message rather than letting NYS return a bare 400.
 */
function classifyS3Path(s3Path: string): { ok: true } | { ok: false; error: string } {
  if (!s3Path.startsWith('s3://')) {
    return { ok: false, error: 's3Path must start with s3://' };
  }
  if (s3Path.endsWith('/')) {
    return {
      ok: false,
      error:
        'This is an archive directory prefix, not a judgment PDF. District Court rows carry a tar-directory prefix and have no per-judgment PDF in the extractable estate.',
    };
  }
  if (!s3Path.toLowerCase().endsWith('.pdf')) {
    return { ok: false, error: 'Only .pdf object keys can be extracted.' };
  }
  return { ok: true };
}

/**
 * Resolve a judgment to its owned-bucket PDF and return the extracted body.
 *
 * Two-hop when only a `query` is known (Athena metadata search → extract),
 * single-hop when the caller already has an `s3Path` (e.g. from a prior
 * `/documents/search`, or from a caselaw row's `s3Path` field).
 */
export async function fetchJudgmentFullText(
  req: JudgmentFullTextRequest,
): Promise<JudgmentFullTextResult | JudgmentFullTextFailure> {
  const startedAt = Date.now();
  const directPath = asString(req.s3Path);
  const query = asString(req.query);

  if (!directPath && !query) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REQUEST',
      error: 'Provide either s3Path (direct) or query (resolved via the Athena archive).',
    };
  }

  let s3Path = directPath;
  let title = asString(req.title);
  let citation: string | null = null;
  let bytesScanned = 0;
  let estimatedCostUsd = 0;
  let alternates: JudgmentFullTextCandidate[] = [];
  let resolveMs = 0;

  if (!s3Path) {
    const resolveStart = Date.now();
    const searchBody = normalizeNysAthenaSearchBody({
      query,
      archive: req.archive ?? 'sc',
      year: req.year,
      court: req.court,
      limit: 5,
    });
    // normalize drops archive for anything other than sc|hc; force the cheap
    // SC default back in rather than letting NYS union SC ∪ HC (~1.6 GB scan).
    if (!searchBody.archive) searchBody.archive = req.archive === 'hc' ? 'hc' : 'sc';

    const search = await nysKnowledgeRequest<{
      results?: Array<Record<string, unknown>>;
      bytesScanned?: number;
      estimatedCostUsd?: number;
    }>({
      method: 'POST',
      path: '/athena/search',
      body: searchBody,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    resolveMs = Date.now() - resolveStart;

    if (search.ok === false) {
      return {
        ok: false,
        status: search.status || 502,
        code: 'UPSTREAM',
        error: search.error || 'NYS Athena archive search failed.',
      };
    }
    bytesScanned = Number(search.data?.bytesScanned ?? 0) || 0;
    estimatedCostUsd = Number(search.data?.estimatedCostUsd ?? 0) || 0;
    const rows = Array.isArray(search.data?.results) ? search.data!.results! : [];
    const candidates = rows.map(toCandidate).filter((c) => c.s3Path);
    if (candidates.length === 0) {
      return {
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
        error:
          'No judgment in the Athena archive matched that query. Note the archive covers Supreme Court and High Court PDFs; District Court rows have no per-judgment PDF.',
        candidates: rows.map(toCandidate),
        bytesScanned,
      };
    }
    const best = candidates[0]!;
    s3Path = best.s3Path;
    title = title ?? best.title;
    citation = best.citation;
    alternates = candidates.slice(1);
  }

  if (!s3Path) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Could not resolve an archive path.' };
  }
  const shape = classifyS3Path(s3Path);
  if (shape.ok === false) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: shape.error };
  }

  const extractStart = Date.now();
  const extract = await nysKnowledgeRequest<{
    s3Path?: string;
    requestedPath?: string;
    title?: string | null;
    byteSize?: number;
    textLength?: number;
    text?: string;
    ocrUsed?: boolean;
    cached?: boolean;
    truncated?: boolean;
    structure?: JudgmentStructurePayload;
    error?: string;
  }>({
    method: 'POST',
    path: '/athena/extract',
    body: {
      s3Path,
      ...(title ? { title } : {}),
      ...(req.structure ? { structure: true } : {}),
    },
    timeoutMs: EXTRACT_TIMEOUT_MS,
  });
  const extractMs = Date.now() - extractStart;

  if (extract.ok === false) {
    // NYS maps its own failure modes onto status codes; preserve them so a
    // caller can tell "too big to extract" from "not in the archive".
    const code: JudgmentFullTextFailure['code'] =
      extract.status === 413
        ? 'TOO_LARGE'
        : extract.status === 404
          ? 'NOT_FOUND'
          : extract.status === 422
            ? 'NO_TEXT'
            : extract.status === 400
              ? 'BAD_REQUEST'
              : 'UPSTREAM';
    logger.warn('NYS judgment full-text extract failed', {
      status: extract.status,
      code,
      s3Path,
      resolvedVia: directPath ? 'direct' : 'athena-search',
    });
    return {
      ok: false,
      status: extract.status || 502,
      code,
      error: extract.error || 'NYS archive extraction failed.',
      ...(alternates.length ? { candidates: alternates } : {}),
      bytesScanned,
    };
  }

  const text = typeof extract.data?.text === 'string' ? extract.data.text : '';
  const upstreamTruncated =
    typeof extract.data?.truncated === 'boolean' ? extract.data.truncated : null;
  const total = Date.now() - startedAt;
  logger.info('NYS judgment full text served', {
    resolvedVia: directPath ? 'direct' : 'athena-search',
    textLength: text.length,
    cached: extract.data?.cached ?? null,
    truncated: upstreamTruncated,
    bytesScanned,
    latencyMs: total,
  });

  return {
    ok: true,
    resolvedVia: directPath ? 'direct' : 'athena-search',
    s3Path: asString(extract.data?.s3Path) ?? s3Path,
    requestedPath: asString(extract.data?.requestedPath),
    title: title ?? asString(extract.data?.title),
    citation,
    byteSize: typeof extract.data?.byteSize === 'number' ? extract.data.byteSize : null,
    textLength: text.length,
    text,
    ocrUsed: typeof extract.data?.ocrUsed === 'boolean' ? extract.data.ocrUsed : null,
    cached: typeof extract.data?.cached === 'boolean' ? extract.data.cached : null,
    truncated: upstreamTruncated,
    bytesScanned,
    estimatedCostUsd,
    alternates,
    latencyMs: { resolve: resolveMs, extract: extractMs, total },
    ...(extract.data?.structure ? { structure: extract.data.structure } : {}),
  };
}

/**
 * Merge the two independent causes of a partial judgment body.
 *
 * Exported so it can be tested directly: the hazard here is not arithmetic, it
 * is a precedence bug that would report `truncated: false` about a body NYS had
 * already cut short. Silent truncation of a legal authority is worse than a
 * refusal — Kesavananda Bharati is 2,878,447 characters over 1,006 pages, and a
 * caller that cannot tell a partial extraction from a complete one would quote a
 * judgment it only partly read, with no signal to go back for the rest.
 *
 * `upstreamTruncated` is NYS stopping at its page / time / character budget.
 * `clippedHere` is this route honouring the caller's own `maxChars`. Either one
 * alone means partial, so they are OR-ed, and the reason is reported separately
 * so a caller can tell "raise your maxChars" from "the extractor gave up".
 */
/**
 * Structured paragraph availability envelope for partner UIs (JRX-JUDGMENT-STRUCTURE-001).
 * Surfaces WHY `paras[]` is empty rather than leaving callers guessing.
 */
export function buildParasMeta(
  structure: JudgmentStructurePayload | undefined,
): {
  numbering: JudgmentStructurePayload['numbering'] | 'unknown';
  paragraphCount: number;
  parasUnavailableReason: string | null;
} | undefined {
  if (!structure) return undefined;
  return {
    numbering: structure.numbering,
    paragraphCount: structure.paras.length,
    parasUnavailableReason:
      structure.numbering === 'preserved'
        ? null
        : structure.numberingNote,
  };
}

export function mergeTruncation(input: {
  /** `null` when the upstream did not report the flag — NOT the same as false. */
  upstreamTruncated: boolean | null;
  clippedHere: boolean;
}): {
  truncated: boolean;
  truncationReason:
    | 'upstream-extraction-budget'
    | 'maxChars'
    | 'upstream-extraction-budget+maxChars'
    | null;
  upstreamTruncated: boolean | null;
} {
  const up = input.upstreamTruncated === true;
  const local = input.clippedHere === true;
  return {
    truncated: up || local,
    truncationReason: up
      ? local
        ? 'upstream-extraction-budget+maxChars'
        : 'upstream-extraction-budget'
      : local
        ? 'maxChars'
        : null,
    upstreamTruncated: input.upstreamTruncated,
  };
}

/**
 * Conservative detector for "give me the actual judgment text" asks.
 *
 * Deliberately narrow. A false positive triggers a multi-second S3 download
 * (and, in HC scope, a ~$0.007 Athena scan) on a turn that only needed the
 * headnote, so bare words like "judgment" or "order" — which appear in almost
 * every legal prompt — are NOT sufficient on their own.
 */
export function isFullJudgmentTextRequest(text: string): boolean {
  if (typeof text !== 'string' || text.length < 4) return false;
  const t = text.toLowerCase();
  return (
    /\b(full|complete|entire|whole|verbatim|actual|original)\s+(?:text\s+of\s+(?:the\s+)?)?(judgment|judgement|order|ruling|decision|opinion)\b/.test(
      t,
    ) ||
    /\b(judgment|judgement|order|ruling)\s+(?:full\s*)?text\b/.test(t) ||
    /\bfull[-\s]?text\s+of\s+(?:the\s+)?(judgment|judgement|order|case|ruling|decision)\b/.test(t) ||
    /\b(read|give|show|fetch|get|pull|retrieve|send)\s+me\s+the\s+(full|complete|entire|whole)\b/.test(t)
  );
}
