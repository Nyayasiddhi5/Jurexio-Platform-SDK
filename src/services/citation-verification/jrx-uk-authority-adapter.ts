/**
 * United Kingdom (UK) citation authority adapter.
 *
 * Authority source: legislation.gov.uk (statutes) + neutral citation format
 * validation for case-law (UKSC/UKHL/EWCA/EWHC). Live lookup is gated by
 * JRX_F_CITATION_LIVE_UK (+ optional JRX_UK_LEGISLATION_API_BASE).
 */

import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  cleanInstrumentForQuery,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

const UK_LEGISLATION_BASE = (process.env.JRX_UK_LEGISLATION_API_BASE || 'https://www.legislation.gov.uk').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 4000;

const UK_KNOWN_INSTRUMENTS = [
  'companies act', 'equality act', 'data protection act', 'uk gdpr',
  'human rights act', 'theft act', 'fraud act', 'police and criminal evidence act', 'pace',
  'limitation act', 'sale of goods act', 'consumer rights act', 'employment rights act',
  'insolvency act', 'partnership act', 'arbitration act', 'bribery act',
  'misrepresentation act', 'unfair contract terms act', 'defamation act',
  'criminal justice act', 'mental capacity act', 'modern slavery act',
];

/**
 * legislation.gov.uk exposes machine-readable data at
 * /{type}/{year}/{number}/data.xml. We map a parsed "Act <year>" to a HEAD
 * probe of the search endpoint. Inconclusive (non-200/parse) → null.
 */
async function ukLegislationLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  const instrument = cleanInstrumentForQuery(citation.instrument);
  if (!instrument) return null;
  const q = encodeURIComponent(`${instrument}${citation.year ? ` ${citation.year}` : ''}`);
  const url = `${UK_LEGISLATION_BASE}/all/data.feed?text=${q}&results-count=1`;

  // legislation.gov.uk returns 202 (no Retry-After) while it async-generates a
  // feed or throttles a burst. One short bounded retry converts the common
  // transient 202 → 200 without risking a safety-ring stall; a persistent 202
  // degrades to inconclusive (null → explicit `unverified`), never a false
  // answer.
  let res = await authorityFetch(url, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { Accept: 'application/atom+xml,application/xml' },
  });
  if (res && res.status === 202) {
    await new Promise(r => setTimeout(r, 700));
    res = await authorityFetch(url, {
      timeoutMs: LOOKUP_TIMEOUT_MS,
      headers: { Accept: 'application/atom+xml,application/xml' },
    });
  }
  if (!res || !res.ok || res.status === 202) return null;
  const body = await res.text().catch(() => '');
  // Atom feed carries an <entry> per hit and an openSearch:totalResults count.
  if (/<entry[\s>]/i.test(body)) return true;
  if (/totalResults>\s*0\s*</i.test(body)) return false;
  return null;
}

export const ukAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'UK',
  name: 'legislation.gov.uk',
  authoritySources: ['legislation.gov.uk', 'The National Archives (case neutral citations)'],
  citationPatterns: [
    // "section 13 of the Equality Act 2010" / "s.1 of the Companies Act 2006"
    /(?:[Ss]ection|s\.)\s*(?<sec>\d+[A-Z]?)\s+of\s+the\s+(?<instrument>[A-Z][A-Za-z\s]+Act)\s+(?<year>(?:18|19|20)\d{2})/g,
    // "Companies Act 2006" / "Equality Act 2010"
    /(?<instrument>[A-Z][A-Za-z\s]+Act)\s+(?<year>(?:18|19|20)\d{2})/g,
    // "Regulation 5 of the Working Time Regulations 1998"
    /(?:Regulation|reg\.)\s*(?<reg>\d+[A-Z]?)\s+of\s+the\s+(?<instrument>[A-Z][A-Za-z\s]+Regulations)\s+(?<year>(?:18|19|20)\d{2})/g,
  ],
  casePatterns: [
    // Neutral citations: "[2023] UKSC 15", "[2022] EWCA Civ 123", "[2021] EWHC 100 (Ch)"
    /\[(?<year>(?:19|20)\d{2})\]\s+(?:UKSC|UKHL|UKPC|EWCA|EWHC|EWFC|UKUT|UKEAT)(?:\s+(?:Civ|Crim|Admin|Ch|QB|KB|Comm|Pat|Fam|TCC))?\s+\d+/g,
  ],
  knownInstruments: UK_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isJrxFeatureOn('citationLiveUk'),
  liveLookup: ukLegislationLookup,
  structuralValidator: (c) => {
    // UK statute law (in this form) doesn't predate ~1267; reject impossible years.
    if (c.year && c.year < 1200) return false;
    return true;
  },
});
