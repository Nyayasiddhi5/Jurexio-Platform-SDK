/**
 * European Union (EU) citation authority adapter.
 *
 * Authority source: EUR-Lex (CELEX-numbered instruments). Live lookup gated by
 * JRX_F_CITATION_LIVE_EU (+ optional NYV_EURLEX_API_BASE). Recognises
 * Regulations, Directives, Decisions and Article references to named acts.
 */

import { isNyvFeatureOn } from '../../config/jrx-feature-flags.js';
import {
  BaseAuthorityAdapter,
  authorityFetch,
  type AuthorityCitationCandidate,
} from './jrx-authority-adapter.js';

const EURLEX_BASE = (process.env.NYV_EURLEX_API_BASE || 'https://eur-lex.europa.eu').replace(/\/+$/, '');
const LOOKUP_TIMEOUT_MS = 4000;
const CURRENT_YEAR = new Date().getFullYear();

const EU_KNOWN_INSTRUMENTS = [
  'gdpr', 'general data protection regulation', 'regulation (eu) 2016/679',
  'eu ai act', 'artificial intelligence act', 'regulation (eu) 2024/1689',
  'digital services act', 'dsa', 'regulation (eu) 2022/2065',
  'digital markets act', 'dma', 'regulation (eu) 2022/1925',
  'directive 95/46/ec', 'eprivacy directive', 'directive 2002/58/ec',
  'mifid ii', 'directive 2014/65/eu', 'nis2 directive', 'directive (eu) 2022/2555',
  'treaty on the functioning of the european union', 'tfeu',
  'charter of fundamental rights',
];

/**
 * Build the EUR-Lex CELEX identifier for a numbered Regulation/Directive/
 * Decision so we can resolve it deterministically (no fragile full-text
 * scraping). CELEX = sector `3` (legislation) + 4-digit year + descriptor
 * (R=Regulation, L=Directive, D=Decision) + 4-digit zero-padded number.
 *
 * EU numbering has two historical orders:
 *   - modern  YEAR/NUMBER  ("2016/679"  → 32016R0679)
 *   - legacy  NUMBER/YEAR  ("1/2003"    → 32003R0001)
 *   - 2-digit-year directives ("95/46"  → 31995L0046)
 * We detect the year by which side is a plausible 4-digit year, else treat a
 * leading 2-digit token as the year (≥50 → 19xx, else 20xx). Returns null when
 * the instrument is a bare named act (e.g. "the GDPR") — those resolve via the
 * known corpus, not a CELEX probe.
 */
function celexFromCitation(citation: AuthorityCitationCandidate): string | null {
  const instrument = (citation.instrument || '').trim();
  const m = instrument.match(/(\d{1,4})\/(\d{1,4})/);
  if (!m) return null;
  const aStr = m[1];
  const bStr = m[2];
  const a = parseInt(aStr, 10);
  const b = parseInt(bStr, 10);
  let year: number;
  let num: number;
  if (aStr.length === 4 && a >= 1950) {
    year = a; num = b;            // 2016/679
  } else if (bStr.length === 4 && b >= 1950) {
    year = b; num = a;            // 1/2003
  } else {
    year = a >= 50 ? 1900 + a : 2000 + a; // 95/46 → 1995
    num = b;
  }
  if (year < 1950 || year > CURRENT_YEAR + 1) return null;

  const raw = (citation.raw || '').toLowerCase();
  const descriptor = /directive/.test(raw) ? 'L' : /decision/.test(raw) ? 'D' : 'R';
  return `3${year}${descriptor}${String(num).padStart(4, '0')}`;
}

/**
 * Resolve a numbered EU instrument against EUR-Lex CELEX. A 200 on the
 * canonical legal-content URL positively confirms the instrument exists; any
 * other outcome (404, non-200, timeout, un-constructible CELEX) is treated as
 * inconclusive (`null` → explicit `unverified`) rather than a false negative,
 * because CELEX construction is heuristic.
 */
async function eurLexLookup(citation: AuthorityCitationCandidate): Promise<boolean | null> {
  const celex = celexFromCitation(citation);
  if (!celex) return null;
  // HEAD avoids downloading the (~0.5 MB) consolidated text — we only need the
  // existence signal: 200 = the CELEX instrument exists, 404 = not constructible
  // to a real document (treated as inconclusive, not a false negative, since
  // CELEX construction is heuristic).
  const res = await authorityFetch(`${EURLEX_BASE}/legal-content/EN/TXT/?uri=CELEX:${celex}`, {
    method: 'HEAD',
    timeoutMs: LOOKUP_TIMEOUT_MS,
    headers: { Accept: 'text/html' },
  });
  if (!res) return null;
  if (res.status === 200) return true;
  return null;
}

export const euAuthorityAdapter = new BaseAuthorityAdapter({
  jurisdiction: 'EU',
  name: 'EUR-Lex',
  authoritySources: ['EUR-Lex (eur-lex.europa.eu)', 'CJEU case-law (CURIA)'],
  citationPatterns: [
    // "Regulation (EU) 2016/679" / "Regulation (EC) No 1/2003"
    /(?<reg>Regulation)\s+\((?:EU|EC|EEC)\)\s+(?:No\s+)?(?<instrument>\d+\/\d+)/g,
    // "Directive 95/46/EC" / "Directive (EU) 2022/2555"
    /(?<reg>Directive)\s+(?:\(EU\)\s+)?(?<instrument>\d+\/\d+(?:\/[A-Z]{2,3})?)/g,
    // "Article 28 of the GDPR" / "Art. 6 GDPR"
    /(?:Article|Art\.)\s*(?<art>\d+[a-z]?)\s+(?:of\s+the\s+)?(?<art_instrument>GDPR|EU AI Act|TFEU|DSA|DMA|Charter)/g,
    // "the GDPR" / "the EU AI Act" bare references
    /(?<art_instrument>(?:the\s+)?(?:GDPR|EU AI Act|Digital Services Act|Digital Markets Act|TFEU))/g,
  ],
  casePatterns: [
    // CJEU case numbers: "Case C-131/12", "Case T-201/04"
    /\bCase\s+(?:C|T|F)-\d+\/(?<year>\d+)/g,
  ],
  knownInstruments: EU_KNOWN_INSTRUMENTS,
  liveApiEnabled: () => isNyvFeatureOn('citationLiveEu'),
  liveLookup: eurLexLookup,
});
