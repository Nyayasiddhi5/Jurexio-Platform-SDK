/**
 * Gulf Cooperation Council (GC / GCC) citation authority adapter.
 *
 * Authority sources: UAE Federal Legislation portal + DIFC / ADGM legislation
 * registries. No single free machine API spans the GCC, so the deterministic
 * known-corpus + structural verifier is the primary path; a live probe is
 * gated by JRX_F_CITATION_LIVE_GC (+ NYV_GC_LEGISLATION_API_BASE) for
 * operators who wire a regional source. Unconfirmed citations return explicit
 * `unverified` (never a silent pass).
 */

import { isNyvFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

const GC_LEGISLATION_BASE = (process.env.NYV_GC_LEGISLATION_API_BASE || '').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 4000;

const GC_KNOWN_INSTRUMENTS = [
  'uae civil code', 'federal law no. 5 of 1985', 'civil transactions law',
  'uae commercial transactions law', 'federal law no. 18 of 1993',
  'uae penal code', 'federal decree-law no. 31 of 2021',
  'uae labour law', 'federal decree-law no. 33 of 2021',
  'uae cybercrime law', 'federal decree-law no. 34 of 2021',
  'uae companies law', 'federal decree-law no. 32 of 2021',
  'uae data protection law', 'federal decree-law no. 45 of 2021', 'pdpl',
  'difc law', 'difc contract law', 'difc data protection law',
  'adgm regulations', 'adgm companies regulations',
  'saudi companies law', 'qatar civil code', 'bahrain commercial companies law',
  'kuwait civil code', 'oman commercial companies law',
];

/** Optional operator-wired GC legislation probe. Disabled by default → null. */
async function gcLegislationLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  if (!GC_LEGISLATION_BASE || !citation.instrument) return null;
  const q = encodeURIComponent(citation.instrument);
  const res = await authorityFetch(`${GC_LEGISLATION_BASE}/search?q=${q}&limit=1`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });
  if (!res || !res.ok) return null;
  try {
    const data: any = await res.json();
    if (Array.isArray(data?.results)) return data.results.length > 0;
    if (typeof data?.count === 'number') return data.count > 0;
  } catch { /* parse error → inconclusive */ }
  return null;
}

export const gcAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'GC',
  name: 'UAE Federal / DIFC / ADGM legislation',
  authoritySources: ['UAE Federal Legislation portal', 'DIFC Laws & Regulations', 'ADGM Legislation'],
  citationPatterns: [
    // "Federal Law No. 5 of 1985" / "Federal Decree-Law No. 45 of 2021"
    /(?<instrument>Federal\s+(?:Decree-)?Law)\s+No\.?\s*(?<sec>\d+)\s+of\s+(?<year>(?:19|20)\d{2})/g,
    // "DIFC Law No. 1 of 2007" / "ADGM Regulations 2015"
    /(?<instrument>(?:DIFC|ADGM)\s+(?:Law|Regulations?))\s+(?:No\.?\s*(?<sec>\d+)\s+of\s+)?(?<year>(?:19|20)\d{2})/g,
    // "Article 246 of the UAE Civil Code"
    /(?:Article|Art\.)\s*(?<art>\d+)\s+of\s+the\s+(?<art_instrument>UAE\s+[A-Z][A-Za-z\s]+(?:Code|Law))/g,
  ],
  knownInstruments: GC_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isNyvFeatureOn('citationLiveGc') && !!GC_LEGISLATION_BASE,
  liveLookup: gcLegislationLookup,
});
