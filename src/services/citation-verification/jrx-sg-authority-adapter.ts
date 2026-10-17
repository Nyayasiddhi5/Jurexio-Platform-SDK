/**
 * Singapore (SG) citation authority adapter.
 *
 * Authority source: Singapore Statutes Online (sso.agc.gov.sg) for statutes
 * and SG neutral citations (SGCA/SGHC) for case-law. Live lookup gated by
 * JRX_F_CITATION_LIVE_SG (+ optional JRX_SG_SSO_API_BASE).
 */

import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  cleanInstrumentForQuery,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

const SG_SSO_BASE = (process.env.JRX_SG_SSO_API_BASE || 'https://sso.agc.gov.sg').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 4000;

const SG_KNOWN_INSTRUMENTS = [
  'penal code', 'companies act', 'personal data protection act', 'pdpa',
  'evidence act', 'criminal procedure code', 'cpc',
  'employment act', 'contracts act', 'sale of goods act',
  'electronic transactions act', 'computer misuse act', 'cybersecurity act',
  'companies act 1967', 'securities and futures act', 'banking act',
  'arbitration act', 'international arbitration act', 'insolvency restructuring and dissolution act',
  'competition act', 'consumer protection (fair trading) act', 'trade marks act',
  'patents act', 'copyright act', 'misuse of drugs act', 'constitution of the republic of singapore',
];

/**
 * Singapore Statutes Online (SSO) best-effort probe.
 *
 * SSO's search/browse results are rendered client-side (the initial HTML is a
 * JS shell), so there is no stable free machine-readable search response to
 * parse — see the operator note in the adapter export below. We therefore do a
 * positive-only confirmation: query the title-search endpoint and confirm only
 * when the instrument title appears verbatim in the returned markup. We NEVER
 * return `false` from this probe (the absence of server-rendered results is an
 * SSO rendering artefact, not proof the act is fake), so a real citation can
 * only ever be `verified` (corpus or title-hit) or `unverified` here — never a
 * false negative. Operators who wire a parseable SSO/commercial endpoint via
 * `JRX_SG_SSO_API_BASE` get full live coverage with the same true/null
 * contract.
 */
async function sgSsoLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  const title = cleanInstrumentForQuery(citation.instrument);
  if (!title) return null;
  const q = encodeURIComponent(title);
  const res = await authorityFetch(`${SG_SSO_BASE}/Browse/Act/Current?TitleQuery=${q}&SortBy=Title&PageSize=10`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { Accept: 'text/html' },
  });
  if (!res || !res.ok) return null;
  const body = await res.text().catch(() => '');
  if (!body) return null;
  // Positive only: server-rendered title match (also matches operator-supplied
  // endpoints that DO inline results). Absence → inconclusive, not false.
  if (title.length >= 4 && body.toLowerCase().includes(title.toLowerCase())) return true;
  return null;
}

export const sgAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'SG',
  name: 'Singapore Statutes Online',
  authoritySources: ['Singapore Statutes Online (sso.agc.gov.sg)', 'SG Supreme Court neutral citations'],
  citationPatterns: [
    // "section 13 of the Personal Data Protection Act 2012" / "s.300 of the Penal Code"
    /(?:[Ss]ection|s\.)\s*(?<sec>\d+[A-Z]?)\s+of\s+the\s+(?<instrument>[A-Z][A-Za-z\s()]+(?:Act|Code))(?:\s+(?<year>(?:19|20)\d{2}))?/g,
    // "Companies Act 1967" / "Personal Data Protection Act 2012"
    /(?<instrument>[A-Z][A-Za-z\s()]+Act)\s+(?<year>(?:19|20)\d{2})/g,
  ],
  casePatterns: [
    // SG neutral citations: "[2020] SGCA 1", "[2019] SGHC 254", "[2021] SGHC(I) 3"
    /\[(?<year>(?:19|20)\d{2})\]\s+SG(?:CA|HC|DC|MC|HCR|HC\(I\))\s+\d+/g,
  ],
  knownInstruments: SG_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isJrxFeatureOn('citationLiveSg'),
  liveLookup: sgSsoLookup,
});
