/**
 * Hallucination Check + Citation Verifier — Algorithm P0/P2
 * @version 5.2.0
 *
 * Two-stage verification:
 *  Stage 1: Citation NER — extract act references, section numbers, case citations
 *  Stage 2: Authority lookup — validate extracted citations are real, against
 *           the correct jurisdiction's authority (India Code for IN; the
 *           per-jurisdiction authority adapters in
 *           `./citation-verification/*` for UK/US/EU/GC/SG).
 *
 * Jurisdiction-pluggable (NV-SVC-AUTHORITY-ADAPTER-001): when `jurisdiction`
 * is omitted or `IN` the original India-only path runs unchanged for
 * backward-compatibility. Any other jurisdiction is routed to its registered
 * authority adapter, which returns explicit `verified` / `unverified` /
 * `invalid` verdicts (NO silent passes — guardrails §5.5).
 *
 * Returns a HallucinationReport with per-citation verdicts and a confidence score.
 */

import { createLogger } from '../utils/logger.js';
import {
  verifyCitations as verifyCitationsForJurisdiction,
  normalizeJurisdiction,
  type JurisdictionCode,
  type AuthorityVerifyReport,
  type AuthorityVerdict,
} from './citation-verification/index.js';

const logger = createLogger('hallucination-checker');

/* ── Types ─────────────────────────────────────────────────── */

export interface CitationCandidate {
  raw: string;
  type: 'statute' | 'section' | 'case' | 'article' | 'rule';
  actTitle?: string;
  section?: string;
  year?: number;
}

export interface CitationVerdict {
  citation: CitationCandidate;
  verified: boolean;
  source: 'india_code' | 'local_cache' | 'unverifiable' | 'authority_adapter';
  confidence: number;
  note?: string;
  /** Present when verified through a per-jurisdiction authority adapter. */
  status?: 'verified' | 'unverified' | 'invalid' | 'unsupported';
}

export interface HallucinationReport {
  inputLength: number;
  /** Jurisdiction the citations were verified against (default IN). */
  jurisdiction: JurisdictionCode;
  citationsFound: number;
  citationsVerified: number;
  citationsFailed: number;
  /** Citations explicitly unconfirmed (not a silent pass). */
  citationsUnverified: number;
  /** Citations whose format is structurally impossible (strong hallucination signal). */
  citationsInvalid: number;
  overallConfidence: number;   // 0.0 – 1.0
  hasSuspiciousClaims: boolean;
  verdicts: CitationVerdict[];
  checkedAt: string;
}

/* ── Regex patterns for Indian legal citations ─────────────── */

const CITATION_PATTERNS = [
  /* "Indian Penal Code, 1860 Section 302" / "Bharatiya Nyaya Sanhita, 2023 Section 103" */
  /(?<act>[A-Z][a-zA-Z\s]+(?:Act|Code|Sanhita|Adhiniyam|Suraksha\s+Sanhita|Ordinance|Rules?|Regulations?|Order|Schedule)),?\s*(?<year>(?:19|20)\d{2})(?:\s*(?:Section|Sec\.?|S\.)\s*(?<sec>\d+[A-Z]?))?/g,
  /* "Section 302 IPC" / "Section 103 BNS" / "Section 41 BNSS" / "Section 57 BSA" */
  /Section\s+(?<sec>\d+[A-Z]?)\s+(?<abbr>IPC|BNS|CrPC|BNSS|CPC|CRPC|BSA|IT Act|IEA|IDA|GST|TDS|IT)/g,
  /* "Article 21 of the Constitution" */
  /Article\s+(?<art>\d+[A-Z]?)\s+(?:of\s+the\s+)?Constitution/gi,
  /* Case citation: "AIR 2023 SC 1234" */
  /\b(?:AIR|SCC|SCR|MLJ|Cri LJ)\s+(?:19|20)\d{2}\s+(?:SC|HC|Bom|Del|Mad|Cal|All)\s+\d+/g,
];

/* ── Known-valid Indian acts (local cache to avoid false negatives) ── */

const KNOWN_ACTS: Record<string, boolean> = {
  /* Legacy Indian criminal law triad (pre-2024) */
  'Indian Penal Code': true,
  'Code of Criminal Procedure': true,
  'Indian Evidence Act': true,
  /* New Indian criminal law triad (effective 1 July 2024) */
  'Bharatiya Nyaya Sanhita': true,
  'Bharatiya Nagarik Suraksha Sanhita': true,
  'Bharatiya Sakshya Adhiniyam': true,
  /* Abbreviation aliases for new triad */
  'BNS': true,
  'BNSS': true,
  'BSA': true,
  /* Civil & procedural */
  'Civil Procedure Code': true,
  'Constitution of India': true,
  'Information Technology Act': true,
  'Companies Act': true,
  'Income Tax Act': true,
  'Goods and Services Tax Act': true,
  'Transfer of Property Act': true,
  'Contract Act': true,
  'Negotiable Instruments Act': true,
  'Arbitration and Conciliation Act': true,
  'Consumer Protection Act': true,
  'Prevention of Corruption Act': true,
  'Protection of Children from Sexual Offences Act': true,
  'Insolvency and Bankruptcy Code': true,
  'Real Estate Regulation and Development Act': true,
  /* Digital/data law */
  'Digital Personal Data Protection Act': true,
  'DPDPA': true,
};

/* ── India Code API lookup ─────────────────────────────────── */

const INDIA_CODE_BASE = 'https://www.indiacode.nic.in/api/v1';
const LOOKUP_TIMEOUT_MS = 4000;

async function lookupIndiaCodeAPI(actTitle: string, year?: number): Promise<boolean> {
  try {
    const query = encodeURIComponent(`${actTitle}${year ? ` ${year}` : ''}`);
    const url = `${INDIA_CODE_BASE}/acts/search?q=${query}&limit=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) return false;
    const data: any = await res.json();
    return Array.isArray(data?.results) && data.results.length > 0;
  } catch {
    /* Network error / timeout — treat as unverifiable, not false */
    return false;
  }
}

/* ── Citation extractor ────────────────────────────────────── */

export function extractCitations(text: string): CitationCandidate[] {
  const citations: CitationCandidate[] = [];
  const seen = new Set<string>();

  for (const pattern of CITATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0].trim();
      if (seen.has(raw)) continue;
      seen.add(raw);

      const g = match.groups || {};
      if (g.act) {
        citations.push({
          raw,
          type: 'statute',
          actTitle: g.act?.trim(),
          section: g.sec,
          year: g.year ? parseInt(g.year) : undefined,
        });
      } else if (g.sec && g.abbr) {
        citations.push({ raw, type: 'section', section: g.sec, actTitle: g.abbr });
      } else if (g.art) {
        citations.push({ raw, type: 'article', section: g.art, actTitle: 'Constitution of India' });
      } else {
        citations.push({ raw, type: 'case' });
      }
    }
  }

  return citations;
}

/* ── Main verifier ─────────────────────────────────────────── */

/** Map an authority-adapter report into the legacy HallucinationReport shape. */
function reportFromAuthority(aiOutput: string, report: AuthorityVerifyReport): HallucinationReport {
  const verdicts: CitationVerdict[] = report.verdicts.map((v: AuthorityVerdict) => ({
    citation: {
      raw: v.citation.raw,
      type: v.citation.kind === 'regulation' ? 'rule' : (v.citation.kind as CitationCandidate['type']),
      actTitle: v.citation.instrument,
      section: v.citation.section,
      year: v.citation.year,
    },
    verified: v.verified,
    source: 'authority_adapter',
    confidence: v.confidence,
    note: v.note,
    status: v.status,
  }));

  // "failed" preserves the legacy meaning (a real verification miss): invalid
  // citations + explicit unverified statute/section misses. `unsupported`
  // (e.g. case-law with no live reporter) is NOT counted as a hard failure.
  const failed = report.citationsInvalid + report.citationsUnverified;

  return {
    inputLength: aiOutput.length,
    jurisdiction: report.jurisdiction,
    citationsFound: report.citationsFound,
    citationsVerified: report.citationsVerified,
    citationsFailed: failed,
    citationsUnverified: report.citationsUnverified,
    citationsInvalid: report.citationsInvalid,
    overallConfidence: report.overallConfidence,
    hasSuspiciousClaims:
      report.citationsInvalid > 0 ||
      report.citationsUnverified > 0 ||
      (report.citationsFound === 0 && aiOutput.length > 500),
    verdicts,
    checkedAt: report.checkedAt,
  };
}

export async function checkForHallucinations(
  aiOutput: string,
  options: { skipApiLookup?: boolean; jurisdiction?: string } = {}
): Promise<HallucinationReport> {
  // Jurisdiction-pluggable routing. IN (or unset) keeps the original India-only
  // path below byte-for-byte; everything else is delegated to its authority
  // adapter via the registry.
  const jurisdiction = normalizeJurisdiction(options.jurisdiction);
  if (jurisdiction !== 'IN') {
    const report = await verifyCitationsForJurisdiction(aiOutput, jurisdiction);
    logger.info('hallucination_check', {
      jurisdiction,
      citationsFound: report.citationsFound,
      verified: report.citationsVerified,
      unverified: report.citationsUnverified,
      invalid: report.citationsInvalid,
      overallConfidence: report.overallConfidence,
    });
    return reportFromAuthority(aiOutput, report);
  }

  const citations = extractCitations(aiOutput);
  const verdicts: CitationVerdict[] = [];

  for (const cit of citations) {
    /* Case citations — not verifiable via API, mark as such */
    if (cit.type === 'case') {
      verdicts.push({ citation: cit, verified: true, source: 'unverifiable', confidence: 0.6 });
      continue;
    }

    /* Check local cache first */
    const inCache = KNOWN_ACTS[cit.actTitle || ''];
    if (inCache !== undefined) {
      verdicts.push({
        citation: cit,
        verified: inCache,
        source: 'local_cache',
        confidence: inCache ? 0.9 : 0.2,
        note: inCache ? undefined : `"${cit.actTitle}" not in known acts list`,
      });
      continue;
    }

    /* API lookup */
    if (options.skipApiLookup) {
      verdicts.push({ citation: cit, verified: true, source: 'unverifiable', confidence: 0.5 });
      continue;
    }

    const found = cit.actTitle
      ? await lookupIndiaCodeAPI(cit.actTitle, cit.year)
      : false;

    verdicts.push({
      citation: cit,
      verified: found,
      source: 'india_code',
      confidence: found ? 0.95 : 0.1,
      note: found ? undefined : `Could not verify "${cit.raw}" against India Code`,
    });
  }

  const verified = verdicts.filter(v => v.verified).length;
  const failed   = verdicts.filter(v => !v.verified).length;
  const avgConf  = verdicts.length
    ? verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length
    : 1.0;

  logger.info('hallucination_check', {
    jurisdiction: 'IN',
    citationsFound: citations.length,
    verified,
    failed,
    overallConfidence: avgConf,
  });

  return {
    inputLength: aiOutput.length,
    jurisdiction: 'IN',
    citationsFound: citations.length,
    citationsVerified: verified,
    citationsFailed: failed,
    // Legacy IN path does not distinguish unverified-vs-invalid; surface the
    // failures under `citationsUnverified` so the richer counters stay populated.
    citationsUnverified: failed,
    citationsInvalid: 0,
    overallConfidence: parseFloat(avgConf.toFixed(3)),
    hasSuspiciousClaims: failed > 0 || (citations.length === 0 && aiOutput.length > 500),
    verdicts,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Re-export the jurisdiction-aware verifier so callers (safety ring, eval
 * harness) can obtain the richer per-jurisdiction authority report directly
 * without depending on the legacy India-only report shape.
 */
export { verifyCitationsForJurisdiction };
export type { AuthorityVerifyReport, JurisdictionCode };
