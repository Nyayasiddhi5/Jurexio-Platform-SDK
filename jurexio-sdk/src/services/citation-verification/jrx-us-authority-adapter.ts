/**
 * United States (US) citation authority adapter.
 *
 * Authority sources: US Code (uscode.house.gov / govinfo) for statutes and
 * CourtListener for case-law. Live lookup gated by JRX_F_CITATION_LIVE_US
 * (+ optional JRX_COURTLISTENER_API_BASE / JRX_COURTLISTENER_TOKEN).
 */

import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

const COURTLISTENER_BASE = (process.env.JRX_COURTLISTENER_API_BASE || 'https://www.courtlistener.com/api/rest/v4').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 8000; // CourtListener can be slow/cold under load

const US_KNOWN_INSTRUMENTS = [
  'u.s.c', 'usc', 'united states code',
  'uniform commercial code', 'ucc',
  'federal rules of civil procedure', 'fed. r. civ. p', 'frcp',
  'federal rules of criminal procedure', 'fed. r. crim. p',
  'federal rules of evidence', 'fed. r. evid', 'fre',
  'ccpa', 'california consumer privacy act',
  'hipaa', 'health insurance portability and accountability act',
  'sarbanes-oxley act', 'dodd-frank', 'sherman act', 'clayton act',
  'civil rights act', 'americans with disabilities act', 'ada',
  'fair labor standards act', 'flsa', 'lanham act', 'copyright act',
  'constitution of the united states', 'u.s. constitution', 'amendment',
];

/**
 * CourtListener opinion search. Works without a token (rate-limited); a
 * `JRX_COURTLISTENER_TOKEN` lifts the anonymous rate limit and is the operator
 * action item for sustained live US case-law verification. Inconclusive
 * (non-200, e.g. a 429 rate-limit, or timeout) → null → explicit `unverified`,
 * never a false negative.
 */
async function courtListenerLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  const q = encodeURIComponent(citation.raw);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = process.env.JRX_COURTLISTENER_TOKEN;
  if (token) headers.Authorization = `Token ${token}`;
  const res = await authorityFetch(`${COURTLISTENER_BASE}/search/?q=${q}&type=o&page_size=1`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers,
  });
  if (!res || !res.ok) return null;
  try {
    const data: any = await res.json();
    if (typeof data?.count === 'number') return data.count > 0;
    if (Array.isArray(data?.results)) return data.results.length > 0;
  } catch { /* parse error → inconclusive */ }
  return null;
}

export const usAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'US',
  name: 'US Code / CourtListener',
  authoritySources: ['United States Code (uscode.house.gov)', 'CourtListener (Free Law Project)'],
  citationPatterns: [
    // "42 U.S.C. § 1983" / "15 USC 78j"
    /(?<title>\d+)\s+(?<instrument>U\.?S\.?C\.?)\s*(?:§|sec\.?|section)?\s*(?<sec>\d+[a-zA-Z]?)/g,
    // "Fed. R. Civ. P. 12(b)(6)"
    /(?<instrument>Fed\.?\s*R\.?\s*(?:Civ|Crim|Evid|App)\.?\s*P\.?)\s*(?<sec>\d+(?:\([a-z0-9]+\))*)/g,
    // "Section 5 of the Sherman Act"
    /(?:[Ss]ection|§)\s*(?<sec>\d+[A-Za-z]?)\s+of\s+the\s+(?<instrument>[A-Z][A-Za-z\s\-]+Act)/g,
    // "the First Amendment" (constitutional)
    /(?<art_instrument>the\s+(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Fourteenth|Fifteenth|Sixteenth|Seventeenth|Eighteenth|Nineteenth)\s+Amendment)/g,
  ],
  casePatterns: [
    // Reporter citations: "410 U.S. 113", "550 F.3d 100", "5 F. Supp. 2d 10", "123 S. Ct. 456"
    /\b\d+\s+(?:U\.?S\.?|F\.(?:\s?\dd|\s?Supp\.?(?:\s?\dd)?)|S\.?\s?Ct\.?|L\.?\s?Ed\.?(?:\s?\dd)?)\s+\d+/g,
  ],
  knownInstruments: US_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isJrxFeatureOn('citationLiveUs'),
  liveLookup: courtListenerLookup,
  structuralValidator: (c) => {
    // The U.S. Code has 54 titles. A "999 U.S.C." citation is impossible.
    const usc = c.raw.match(/^(\d+)\s+U\.?S\.?C\.?/i);
    if (usc && parseInt(usc[1], 10) > 54) return false;
    return true;
  },
});
