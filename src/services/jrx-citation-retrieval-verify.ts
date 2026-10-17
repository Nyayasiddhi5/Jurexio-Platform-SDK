/**
 * NV-CITATION-RETRIEVAL-VERIFY-001 — retrieval-backed proposition verification.
 *
 * When draft/chat cites INSC/SCC case names, query NYS caselaw plane and compare
 * the cited proposition against retrieved snippet/metadata. Fail-soft with 2s batch
 * timeout; mismatches (Hanuman Ajay Malik pattern) → [CITATION REQUIRED — verify holding].
 */

import { createLogger } from '../utils/logger.js';
import { analyzeCitationPropositionIssues } from './jrx-citation-proposition-gate.js';

const logger = createLogger('./jrx-citation-retrieval-verify');

export const CITATION_VERIFY_HOLDING_MARKER = '[CITATION REQUIRED — verify holding]';

const DEFAULT_BATCH_TIMEOUT_MS = 5_000;

/** Party-name case citation — e.g. "Sushila Aggarwal v. State of Delhi". */
const CASE_V_RE =
  /\b([A-Z][A-Za-z'.()&\s]{2,60})\s+v\.?\s+(?:State of\s+)?([A-Z][A-Za-z'.()&\s]{2,60})(?=[,\s.;:\]]|$)/g;

const REPORTER_CITE_RE = /\(\d{4}\)\s+\d+\s+SCC\s+\d+/gi;

export interface CaseCitationCandidate {
  raw: string;
  caseQuery: string;
  sentence: string;
  position: number;
}

export interface CaseRetrievalHit {
  title: string;
  citation?: string;
  snippet?: string;
  score?: number;
}

export type CaselawSearchFn = (query: string, timeoutMs: number) => Promise<CaseRetrievalHit[]>;

export interface CitationRetrievalVerifyResult {
  content: string;
  citationVerified: boolean;
  checked: number;
  mismatches: number;
  timedOut: boolean;
  replaced: number;
}

function normalizeForMatch(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  const stop = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'was', 'are',
    'court', 'held', 'that', 'this', 'case', 'state', 'petitioner', 'respondent', 'appellant',
  ]);
  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}

/** Lexical overlap between proposition sentence and retrieved holding snippet. */
export function propositionMatchesRetrieval(sentence: string, snippet: string): boolean {
  const a = tokenSet(sentence);
  const b = tokenSet(snippet);
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap += 1;
  }
  const ratio = overlap / Math.min(a.size, 12);
  return ratio >= 0.18 || overlap >= 3;
}

function sentenceForPosition(text: string, position: number): string {
  const before = text.slice(0, position);
  const start = Math.max(0, before.lastIndexOf('.') + 1, before.lastIndexOf('\n') + 1);
  const after = text.slice(position);
  const endRel = after.search(/[.!?]\s|\n\n/);
  const end = endRel >= 0 ? position + endRel + 1 : text.length;
  return text.slice(start, end).trim();
}

export function extractCaseCitationCandidates(content: string): CaseCitationCandidate[] {
  const text = String(content || '');
  if (!text.trim()) return [];

  const out: CaseCitationCandidate[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const re = new RegExp(CASE_V_RE.source, CASE_V_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const partyA = match[1].trim();
    const partyB = match[2].trim();
    if (partyA.length < 3 || partyB.length < 3) continue;
    const raw = match[0].trim();
    const caseQuery = `${partyA} v ${partyB}`;
    const key = caseQuery.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      raw,
      caseQuery,
      sentence: sentenceForPosition(text, match.index),
      position: match.index,
    });
  }

  const reporterRe = new RegExp(REPORTER_CITE_RE.source, REPORTER_CITE_RE.flags);
  while ((match = reporterRe.exec(text)) !== null) {
    const raw = match[0];
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      raw,
      caseQuery: raw,
      sentence: sentenceForPosition(text, match.index),
      position: match.index,
    });
  }

  return out.slice(0, 8);
}

function titleMatchesQuery(hitTitle: string, query: string): boolean {
  const ht = normalizeForMatch(hitTitle);
  const parts = normalizeForMatch(query.replace(/\(\d{4}\)\s+\d+\s+SCC\s+\d+/gi, '')).split(' v ');
  if (parts.length >= 2) {
    const [a, b] = parts;
    return ht.includes(a.slice(0, 12)) && ht.includes(b.slice(0, 12));
  }
  return ht.includes(normalizeForMatch(query).slice(0, 14));
}

export async function defaultCaselawSearch(query: string, timeoutMs: number): Promise<CaseRetrievalHit[]> {
  try {
    const { nysKnowledgeRequest } = await import('./jrx-nys-knowledge-client.js');
    const resp = await nysKnowledgeRequest({
      path: '/caselaw/search',
      method: 'GET',
      query: { q: query, mode: 'fts', limit: 3 },
      timeoutMs,
    });
    if (!resp.ok) return [];
    const payload = resp.data as Record<string, unknown>;
    const rows = payload?.results
      ?? payload?.matches
      ?? (payload?.data as Record<string, unknown> | undefined)?.results
      ?? [];
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 3).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        title: String(r.title || r.caseTitle || '').trim(),
        citation: r.citation != null ? String(r.citation) : undefined,
        snippet: String(r.description || r.snippet || r.summary || '').trim(),
        score: typeof r.score === 'number' ? r.score : undefined,
      };
    }).filter((h) => h.title.length > 0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[NV-CITATION-RETRIEVAL-VERIFY-001] caselaw search fail-soft', { query: query.slice(0, 80), msg });
    return [];
  }
}

function replaceCitationInSentence(sentence: string, rawCite: string): string {
  if (sentence.includes(rawCite)) {
    return sentence.replace(rawCite, CITATION_VERIFY_HOLDING_MARKER);
  }
  if (/\bv\.?\s/i.test(sentence) || REPORTER_CITE_RE.test(sentence)) {
    return CITATION_VERIFY_HOLDING_MARKER;
  }
  return sentence;
}

export async function applyRetrievalCitationVerify(
  content: string,
  opts: {
    searchFn?: CaselawSearchFn;
    timeoutMs?: number;
    hasAuthorities?: boolean;
  } = {},
): Promise<CitationRetrievalVerifyResult> {
  const text = String(content || '');
  const empty: CitationRetrievalVerifyResult = {
    content: text,
    citationVerified: true,
    checked: 0,
    mismatches: 0,
    timedOut: false,
    replaced: 0,
  };
  if (!text.trim()) return empty;

  const stretchIssues = analyzeCitationPropositionIssues(text).filter((i) => i.kind === 'stretch_risk');
  const candidates = extractCaseCitationCandidates(text);
  if (candidates.length === 0 && stretchIssues.length === 0) return empty;
  if (opts.hasAuthorities === false && candidates.length === 0 && stretchIssues.length === 0) return empty;

  const searchFn = opts.searchFn ?? defaultCaselawSearch;
  const batchTimeoutMs = opts.timeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  const batchStarted = Date.now();
  let timedOut = false;
  let mismatches = 0;
  let replaced = 0;
  let checked = 0;

  let out = text;

  for (const candidate of candidates) {
    if (Date.now() - batchStarted >= batchTimeoutMs) {
      timedOut = true;
      break;
    }
    const remaining = Math.max(200, batchTimeoutMs - (Date.now() - batchStarted));
    checked += 1;
    const hits = await searchFn(candidate.caseQuery, remaining);
    const best = hits.find((h) => titleMatchesQuery(h.title, candidate.caseQuery)) ?? hits[0];
    const exists = !!best?.title;
    const snippet = best?.snippet || best?.title || '';
    const titleAligned = exists && titleMatchesQuery(best!.title, candidate.caseQuery);
    const matches = exists && (
      propositionMatchesRetrieval(candidate.sentence, snippet)
      || (titleAligned && snippet.length > 24)
    );

    if (!exists || !matches) {
      mismatches += 1;
      const before = out;
      if (out.includes(candidate.raw)) {
        out = out.replace(candidate.raw, CITATION_VERIFY_HOLDING_MARKER);
      } else {
        out = replaceCitationInSentence(out, candidate.raw);
      }
      if (out !== before) replaced += 1;
    }
  }

  if (stretchIssues.length > 0) {
    mismatches += stretchIssues.length;
    const stretchPatterns = [
      /\b(?:In\s+)?(?:Ajay Malik|Anand Rai|Dr\.\s*Anand)[^.\n]{0,160}\bBhajan Lal\b[^.\n]*/gi,
      /\bBhajan Lal\b[^.\n]{0,160}\b(?:Ajay Malik|Anand Rai|Dr\.\s*Anand)\b[^.\n]*/gi,
    ];
    for (const pattern of stretchPatterns) {
      const next = out.replace(pattern, CITATION_VERIFY_HOLDING_MARKER);
      if (next !== out) {
        out = next;
        replaced += 1;
      }
    }
  }

  const citationVerified = mismatches === 0 && !timedOut;

  logger.info('[NV-CITATION-RETRIEVAL-VERIFY-001] batch complete', {
    checked,
    mismatches,
    replaced,
    timedOut,
    citationVerified,
    durationMs: Date.now() - batchStarted,
  });

  return {
    content: out,
    citationVerified,
    checked,
    mismatches,
    timedOut,
    replaced,
  };
}
