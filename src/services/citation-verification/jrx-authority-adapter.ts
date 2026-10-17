/**
 * Jurexio — Jurisdiction-Pluggable Citation/Statute Authority Adapter
 * NV-SVC-AUTHORITY-ADAPTER-001
 *
 * Anti-hallucination is no longer India-only. This module defines a clean,
 * per-jurisdiction "authority adapter" contract that the safety ring and the
 * hallucination checker use to verify that legal citations in an AI response
 * actually correspond to a real statute / case / instrument in the *correct*
 * jurisdiction.
 *
 * Design rules (per guardrails.md §5.5 — NO silent fallbacks):
 *  - A citation is only ever reported `verified` when an adapter positively
 *    matched it (known corpus or a live authority API confirmed it).
 *  - When an adapter cannot confirm a citation it returns an explicit
 *    `unverified` verdict (NOT `verified`). The safety ring surfaces this as a
 *    warning / HITL trigger rather than silently passing.
 *  - A citation whose *format* is structurally impossible for the jurisdiction
 *    (e.g. a future-year case, an out-of-range section) returns `invalid` —
 *    the strongest hallucination signal.
 *  - Live-API adapters are behind feature flags / env keys and degrade to the
 *    deterministic corpus+format verifier with an explicit `unverified` status
 *    when the API is disabled or unreachable.
 *
 * This file is the interface + a config-driven `BaseAuthorityAdapter`.
 * Per-jurisdiction adapters live in `jrx-<code>-authority-adapter.ts` and are
 * registered in `jrx-authority-registry.ts`.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-authority-adapter');

/* ── Public jurisdiction codes ─────────────────────────────────────────────
 * Note: the agent-registry uses `GC` for the Gulf overlay while the
 * jurisdiction-binding profile uses `GCC`. The registry (see
 * jrx-authority-registry.ts) accepts both and normalizes to `GC`.
 */
export type JurisdictionCode = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';

export type AuthorityVerificationStatus =
  /** Positively matched a known instrument or a live authority confirmed it. */
  | 'verified'
  /** Could not be confirmed — explicit, never a silent pass. */
  | 'unverified'
  /** Structurally impossible for this jurisdiction — strong hallucination signal. */
  | 'invalid'
  /** This citation kind is out of scope for the adapter (e.g. case-law w/o live API). */
  | 'unsupported';

export type AuthoritySource =
  | 'known_corpus'
  | 'format_validation'
  | 'live_api'
  | 'local_cache'
  | 'unsupported';

export type CitationKind =
  | 'statute'
  | 'section'
  | 'case'
  | 'article'
  | 'rule'
  | 'regulation';

export interface AuthorityCitationCandidate {
  /** Verbatim matched text. */
  raw: string;
  kind: CitationKind;
  /** Act / code / regulation title or abbreviation, when parseable. */
  instrument?: string;
  section?: string;
  year?: number;
}

export interface AuthorityVerdict {
  citation: AuthorityCitationCandidate;
  status: AuthorityVerificationStatus;
  /** Convenience flag: `status === 'verified'`. */
  verified: boolean;
  source: AuthoritySource;
  /** 0.0 – 1.0. */
  confidence: number;
  note?: string;
}

export interface AuthorityVerifyReport {
  jurisdiction: JurisdictionCode;
  adapter: string;
  /** Whether a live authority API was actually consulted for this run. */
  liveApiConsulted: boolean;
  citationsFound: number;
  citationsVerified: number;
  citationsUnverified: number;
  citationsInvalid: number;
  citationsUnsupported: number;
  /** Mean verdict confidence (1.0 when no citations were found). */
  overallConfidence: number;
  /** verified / (verified + unverified + invalid), 1.0 when none applicable. */
  verifiedRatio: number;
  verdicts: AuthorityVerdict[];
  checkedAt: string;
}

/**
 * A live authority lookup. Returns:
 *   true  → confirmed real
 *   false → confirmed NOT real (invalid)
 *   null  → inconclusive / API disabled / unreachable (→ unverified)
 */
export type LiveAuthorityLookup = (
  citation: AuthorityCitationCandidate,
) => Promise<boolean | null>;

export interface AuthorityAdapterConfig {
  jurisdiction: JurisdictionCode;
  name: string;
  /** Human-readable list of the primary authority sources this adapter targets. */
  authoritySources: string[];
  /** Statute/section/article/regulation extraction patterns (named groups optional). */
  citationPatterns: RegExp[];
  /** Case-law extraction patterns. Case-law is format-validated, not corpus-checked. */
  casePatterns?: RegExp[];
  /**
   * Known-good instruments for this jurisdiction (normalized lower-case keys —
   * titles and abbreviations). Used for the deterministic corpus check.
   */
  knownInstruments: string[];
  /** Returns true when a live authority API is configured + enabled. */
  liveApiEnabled: () => boolean;
  /** Optional live lookup; only invoked when `liveApiEnabled()` is true. */
  liveLookup?: LiveAuthorityLookup;
  /**
   * Optional jurisdiction-specific structural validator. Return `false` to mark
   * a candidate `invalid` (e.g. future-dated case, impossible section number).
   */
  structuralValidator?: (citation: AuthorityCitationCandidate) => boolean;
}

export interface JurisdictionAuthorityAdapter {
  readonly jurisdiction: JurisdictionCode;
  readonly name: string;
  readonly authoritySources: string[];
  liveApiEnabled(): boolean;
  extract(text: string): AuthorityCitationCandidate[];
  verify(citations: AuthorityCitationCandidate[]): Promise<AuthorityVerdict[]>;
  verifyText(text: string): Promise<AuthorityVerifyReport>;
}

const CURRENT_YEAR = new Date().getFullYear();

/* ── Shared live-lookup infrastructure ─────────────────────────────────────
 * A slow or flaky authority API must NEVER stall the safety ring. Every live
 * lookup goes through `authorityFetch` (hard AbortController timeout, browser
 * User-Agent so gov sites that 403 a bare client are reachable) and its result
 * is memoized in `LIVE_CACHE` so repeated citations in a response — and
 * repeated requests — never re-hit the network. Confirmed verdicts (true /
 * false) are cached longer than inconclusive ones (null) so a transient outage
 * self-heals within minutes instead of being pinned to `unverified`.
 */
const DEFAULT_LOOKUP_TIMEOUT_MS = 4000;
// Government legislation portals (legislation.gov.uk, indiacode.nic.in, SSO)
// return 202/403 to non-browser User-Agents, so we present a standard browser
// UA. These are public, read-only GET lookups of published statute metadata.
const AUTHORITY_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LIVE_CACHE = new Map<string, { value: boolean | null; expires: number }>();
const LIVE_CACHE_TTL_CONFIRMED_MS = 6 * 60 * 60 * 1000; // 6h for true/false
const LIVE_CACHE_TTL_INCONCLUSIVE_MS = 5 * 60 * 1000; //   5m for null
const LIVE_CACHE_MAX = 5000;

/** Test/ops helper — drop all memoized live verdicts. */
export function clearAuthorityLiveCache(): void {
  LIVE_CACHE.clear();
}

/**
 * Timeout- and error-guarded fetch for authority lookups. Returns `null`
 * (never throws) on timeout/network error so callers degrade to an explicit
 * `unverified` verdict rather than hanging or surfacing a false negative.
 */
export async function authorityFetch(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; method?: string } = {},
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': AUTHORITY_USER_AGENT, ...(opts.headers || {}) },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize an instrument string for corpus comparison. */
export function normalizeInstrument(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The shared greedy extraction regexes can capture leading sentence filler
 * (e.g. "See the Senior Courts Act" when a sentence opens with a capital
 * word). Strip those leading stop-words BEFORE issuing a live authority query
 * so a real instrument is not mis-queried into a false "no results" — which
 * would wrongly flag a genuine citation. Stop-words are dropped only from the
 * START of the string; legitimate title words are untouched.
 */
const LEADING_QUERY_STOPWORDS = new Set([
  'see', 'the', 'a', 'an', 'under', 'per', 'as', 'in', 'of', 'this', 'that',
  'these', 'those', 'refer', 'pursuant', 'to', 'and', 'or', 'by', 'via',
  'cf', 'eg', 'ie', 'namely', 'viz', 'said', 'such',
]);
export function cleanInstrumentForQuery(value: string | undefined): string {
  let tokens = (value || '').replace(/\s+/g, ' ').trim().split(' ');
  while (tokens.length > 1 && LEADING_QUERY_STOPWORDS.has(tokens[0].toLowerCase().replace(/[.,]/g, ''))) {
    tokens = tokens.slice(1);
  }
  return tokens.join(' ').trim();
}

/**
 * Config-driven base adapter. Most jurisdictions only differ in their
 * patterns + known corpus + (optional) live lookup, so they can be expressed
 * declaratively rather than re-implementing the verification loop.
 */
export class BaseAuthorityAdapter implements JurisdictionAuthorityAdapter {
  readonly jurisdiction: JurisdictionCode;
  readonly name: string;
  readonly authoritySources: string[];
  protected readonly cfg: AuthorityAdapterConfig;
  private readonly normalizedCorpus: string[];

  constructor(cfg: AuthorityAdapterConfig) {
    this.cfg = cfg;
    this.jurisdiction = cfg.jurisdiction;
    this.name = cfg.name;
    this.authoritySources = cfg.authoritySources;
    this.normalizedCorpus = cfg.knownInstruments.map(normalizeInstrument);
  }

  liveApiEnabled(): boolean {
    try {
      return this.cfg.liveApiEnabled();
    } catch {
      return false;
    }
  }

  extract(text: string): AuthorityCitationCandidate[] {
    const out: AuthorityCitationCandidate[] = [];
    const seen = new Set<string>();

    const pushUnique = (c: AuthorityCitationCandidate) => {
      const key = `${c.kind}::${c.raw}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(c);
    };

    for (const pattern of this.cfg.citationPatterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const g = m.groups || {};
        const raw = m[0].trim();
        if (g.art) {
          pushUnique({ raw, kind: 'article', instrument: g.art_instrument?.trim(), section: g.art });
        } else if (g.art_instrument) {
          pushUnique({ raw, kind: 'article', instrument: g.art_instrument.trim() });
        } else if (g.reg) {
          pushUnique({
            raw,
            kind: 'regulation',
            instrument: (g.instrument || g.reg)?.trim(),
            year: g.year ? parseInt(g.year, 10) : undefined,
          });
        } else if (g.instrument || g.act) {
          pushUnique({
            raw,
            kind: g.sec ? 'section' : 'statute',
            instrument: (g.instrument || g.act)?.trim(),
            section: g.sec,
            year: g.year ? parseInt(g.year, 10) : undefined,
          });
        } else if (g.abbr) {
          pushUnique({ raw, kind: 'section', instrument: g.abbr.trim(), section: g.sec });
        } else {
          pushUnique({ raw, kind: 'statute', instrument: raw });
        }
        if (!pattern.global) break;
      }
    }

    for (const pattern of this.cfg.casePatterns || []) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const raw = m[0].trim();
        const g = m.groups || {};
        pushUnique({ raw, kind: 'case', year: g.year ? parseInt(g.year, 10) : undefined });
        if (!pattern.global) break;
      }
    }

    return out;
  }

  protected inCorpus(citation: AuthorityCitationCandidate): boolean {
    const norm = normalizeInstrument(citation.instrument);
    if (!norm) return false;
    return this.normalizedCorpus.some(known => norm === known || norm.includes(known) || known.includes(norm));
  }

  protected structurallyValid(citation: AuthorityCitationCandidate): boolean {
    if (citation.year && citation.year > CURRENT_YEAR + 1) return false;
    if (this.cfg.structuralValidator) {
      try {
        return this.cfg.structuralValidator(citation);
      } catch {
        return true;
      }
    }
    return true;
  }

  async verify(citations: AuthorityCitationCandidate[]): Promise<AuthorityVerdict[]> {
    const verdicts: AuthorityVerdict[] = [];
    const liveOn = this.liveApiEnabled();

    for (const citation of citations) {
      // 1. Structural impossibility → invalid (strongest hallucination signal).
      if (!this.structurallyValid(citation)) {
        verdicts.push({
          citation,
          status: 'invalid',
          verified: false,
          source: 'format_validation',
          confidence: 0.05,
          note: `Citation is structurally impossible for ${this.jurisdiction}`,
        });
        continue;
      }

      // 2. Known-corpus deterministic check.
      if (this.inCorpus(citation)) {
        verdicts.push({
          citation,
          status: 'verified',
          verified: true,
          source: 'known_corpus',
          confidence: 0.9,
        });
        continue;
      }

      // 3. Live authority API (only if enabled). Inconclusive → unverified.
      if (liveOn && this.cfg.liveLookup) {
        const live = await this.cachedLiveLookup(citation);
        if (live === true) {
          verdicts.push({ citation, status: 'verified', verified: true, source: 'live_api', confidence: 0.97 });
          continue;
        }
        if (live === false) {
          verdicts.push({
            citation,
            status: 'invalid',
            verified: false,
            source: 'live_api',
            confidence: 0.1,
            note: `Live authority (${this.name}) did not match "${citation.raw}"`,
          });
          continue;
        }
        // null → fall through to explicit unverified.
      }

      // 4. Case-law without a live source is unsupported (format-valid but not corpus-checkable).
      if (citation.kind === 'case') {
        verdicts.push({
          citation,
          status: 'unsupported',
          verified: false,
          source: 'unsupported',
          confidence: 0.5,
          note: liveOn
            ? 'Case-law not confirmable by configured authority'
            : 'Case-law verification requires a live reporter API (disabled)',
        });
        continue;
      }

      // 5. Explicit unverified — NO silent pass.
      verdicts.push({
        citation,
        status: 'unverified',
        verified: false,
        source: liveOn ? 'live_api' : 'format_validation',
        confidence: 0.3,
        note: liveOn
          ? `Not in ${this.jurisdiction} known corpus and live API inconclusive`
          : `Not in ${this.jurisdiction} known corpus; live API disabled (set the jurisdiction citation flag to enable)`,
      });
    }

    return verdicts;
  }

  /**
   * Memoized + error-guarded wrapper around the configured live lookup. Caches
   * confirmed verdicts for 6h and inconclusive (null) ones for 5m so a slow or
   * flaky authority API cannot be hammered or stall the safety ring.
   */
  private async cachedLiveLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
    if (!this.cfg.liveLookup) return null;
    const key = `${this.jurisdiction}::${citation.kind}::${(citation.raw || '').toLowerCase()}`;
    const now = Date.now();
    const hit = LIVE_CACHE.get(key);
    if (hit && hit.expires > now) return hit.value;

    let value: boolean | null = null;
    try {
      value = await this.cfg.liveLookup(citation);
    } catch (err: any) {
      logger.warn('live_lookup_failed', { jurisdiction: this.jurisdiction, raw: citation.raw, err: err?.message });
      value = null;
    }

    if (LIVE_CACHE.size >= LIVE_CACHE_MAX) LIVE_CACHE.clear();
    LIVE_CACHE.set(key, {
      value,
      expires: now + (value === null ? LIVE_CACHE_TTL_INCONCLUSIVE_MS : LIVE_CACHE_TTL_CONFIRMED_MS),
    });
    return value;
  }

  async verifyText(text: string): Promise<AuthorityVerifyReport> {
    const citations = this.extract(text);
    const verdicts = await this.verify(citations);
    return buildReport(this.jurisdiction, this.name, this.liveApiEnabled(), verdicts);
  }
}

/** Assemble a report from a verdict list. Shared by adapters + registry. */
export function buildReport(
  jurisdiction: JurisdictionCode,
  adapter: string,
  liveApiConsulted: boolean,
  verdicts: AuthorityVerdict[],
): AuthorityVerifyReport {
  const verified = verdicts.filter(v => v.status === 'verified').length;
  const unverified = verdicts.filter(v => v.status === 'unverified').length;
  const invalid = verdicts.filter(v => v.status === 'invalid').length;
  const unsupported = verdicts.filter(v => v.status === 'unsupported').length;

  const overallConfidence = verdicts.length
    ? verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length
    : 1.0;

  const applicable = verified + unverified + invalid;
  const verifiedRatio = applicable ? verified / applicable : 1.0;

  return {
    jurisdiction,
    adapter,
    liveApiConsulted,
    citationsFound: verdicts.length,
    citationsVerified: verified,
    citationsUnverified: unverified,
    citationsInvalid: invalid,
    citationsUnsupported: unsupported,
    overallConfidence: parseFloat(overallConfidence.toFixed(3)),
    verifiedRatio: parseFloat(verifiedRatio.toFixed(3)),
    verdicts,
    checkedAt: new Date().toISOString(),
  };
}
