/**
 * India (IN) citation authority adapter.
 *
 * Authority sources: India Code (indiacode.nic.in). Live lookup is gated by
 * JRX_F_CITATION_LIVE_IN (+ optional NYV_INDIA_CODE_API_BASE override). When
 * disabled, the deterministic known-corpus + structural verifier runs — this
 * mirrors the long-standing behavior of `hallucination-checker.ts` so the IN
 * path is unchanged for callers that opt into the registry.
 */

import { isNyvFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  cleanInstrumentForQuery,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

// India Code (indiacode.nic.in) is a DSpace repository. It has no clean JSON
// API, but its server-rendered `/simple-search?query=` page returns result
// rows (item `/handle/<id>` links) or the literal "Search produced no results"
// — both reliable signals. Default to the site root; `NYV_INDIA_CODE_API_BASE`
// may point at a richer operator-supplied statute API (same true/false/null
// contract).
const INDIA_CODE_BASE = (process.env.NYV_INDIA_CODE_API_BASE || 'https://www.indiacode.nic.in').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 7000; // India Code (DSpace) is slow; allow more headroom before degrading

/** Known-valid Indian instruments (titles + abbreviations). */
const IN_KNOWN_INSTRUMENTS = [
  'indian penal code', 'ipc',
  'code of criminal procedure', 'crpc',
  'indian evidence act', 'iea',
  'bharatiya nyaya sanhita', 'bns',
  'bharatiya nagarik suraksha sanhita', 'bnss',
  'bharatiya sakshya adhiniyam', 'bsa',
  'code of civil procedure', 'civil procedure code', 'cpc',
  'constitution of india', 'constitution',
  'information technology act', 'it act',
  'companies act',
  'income tax act',
  'goods and services tax act', 'gst',
  'transfer of property act',
  'indian contract act', 'contract act',
  'negotiable instruments act',
  'arbitration and conciliation act',
  'consumer protection act',
  'prevention of corruption act',
  'protection of children from sexual offences act', 'pocso',
  'insolvency and bankruptcy code',
  'real estate regulation and development act', 'rera',
  'digital personal data protection act', 'dpdpa',
  'industrial disputes act',
];

async function indiaCodeLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  const instrument = cleanInstrumentForQuery(citation.instrument);
  if (!instrument) return null;
  const query = encodeURIComponent(`${instrument}${citation.year ? ` ${citation.year}` : ''}`);

  // Operator-supplied JSON API path (when NYV_INDIA_CODE_API_BASE points at a
  // structured statute service that exposes /acts/search).
  if (/\/api(\/|$)/i.test(INDIA_CODE_BASE)) {
    const res = await authorityFetch(`${INDIA_CODE_BASE}/acts/search?q=${query}&limit=1`, {
      timeoutMs: LOOKUP_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) return null;
    try {
      const data: any = await res.json();
      if (Array.isArray(data?.results)) return data.results.length > 0;
      if (typeof data?.count === 'number') return data.count > 0;
    } catch { /* fall through */ }
    return null;
  }

  // Default: India Code DSpace server-rendered search.
  const res = await authorityFetch(`${INDIA_CODE_BASE}/simple-search?query=${query}`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { Accept: 'text/html' },
  });
  if (!res || !res.ok) return null;
  const body = await res.text().catch(() => '');
  if (!body) return null;
  if (/Search produced no results/i.test(body)) return false;
  if (/\/handle\/\d+\/\d+/.test(body)) return true;
  return null; // inconclusive → explicit unverified, never a false negative
}

export const inAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'IN',
  name: 'India Code',
  authoritySources: ['India Code (indiacode.nic.in)', 'Constitution of India'],
  citationPatterns: [
    // "Indian Penal Code, 1860 Section 302" / "Bharatiya Nyaya Sanhita, 2023 Section 103"
    /(?<instrument>[A-Z][a-zA-Z\s]+(?:Act|Code|Sanhita|Adhiniyam|Suraksha\s+Sanhita|Ordinance|Rules?|Regulations?|Order|Schedule)),?\s*(?<year>(?:19|20)\d{2})(?:\s*(?:Section|Sec\.?|S\.)\s*(?<sec>\d+[A-Z]?))?/g,
    // "Section 302 IPC" / "Section 103 BNS"
    /Section\s+(?<sec>\d+[A-Z]?)\s+(?<abbr>IPC|BNS|CrPC|BNSS|CPC|CRPC|BSA|IT Act|IEA|IDA|GST|DPDPA)/g,
    // "Article 21 of the Constitution"
    /Article\s+(?<art>\d+[A-Z]?)\s+(?:of\s+the\s+)?(?<art_instrument>Constitution)/gi,
  ],
  casePatterns: [
    /\b(?:AIR|SCC|SCR|MLJ|Cri LJ)\s+(?<year>(?:19|20)\d{2})\s+(?:SC|HC|Bom|Del|Mad|Cal|All)\s+\d+/g,
  ],
  knownInstruments: IN_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isNyvFeatureOn('citationLiveIn'),
  liveLookup: async (citation) => {
    // Prefer NYS corpus oracle when knowledge plane is on (authoritative IN caselaw/statutes).
    if (isNyvFeatureOn('nysKnowledgePlane')) {
      try {
        const { nysVerifyCitation } = await import('../jrx-nys-knowledge-retriever.js');
        const raw =
          citation.raw ||
          [citation.instrument, citation.section, citation.year].filter(Boolean).join(' ');
        if (raw) {
          const nys = await nysVerifyCitation(raw, 'IN');
          if (nys) return nys.verified;
        }
      } catch {
        /* fall through to India Code */
      }
    }
    return indiaCodeLookup(citation);
  },
  structuralValidator: (c) => {
    // Constitution of India has ~470 articles; flag absurd article numbers.
    if (c.kind === 'article' && c.section && parseInt(c.section, 10) > 600) return false;
    return true;
  },
});
