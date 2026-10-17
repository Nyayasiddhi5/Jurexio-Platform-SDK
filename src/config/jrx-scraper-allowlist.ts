/**
 * JRX Web Scraper — Legal-Source Allowlist & Per-Domain Policy
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for which domains the platform may scrape.
 * Anything not in this list is rejected by `WebScrapingService.scrape()`.
 *
 * Rules of engagement:
 *   - Only authoritative legal sources (govt portals, official courts,
 *     parliamentary gazettes, regulator websites)
 *   - Per-domain rate-limit budget (requests / minute) — Token-bucket
 *     enforced in WebScrapingService
 *   - Per-jurisdiction tagging so GraphRAG ingestion can stamp documents
 *     with the correct JCN
 *
 * Add a domain → add a row here. Zero code changes needed elsewhere.
 */

export type Jurisdiction = 'IN' | 'UK' | 'US' | 'GCC' | 'EU' | 'SG' | 'DEFAULT';

export interface AllowedSource {
  /** Bare host (no scheme, no path). Subdomains match if `matchSubdomains: true`. */
  host: string;
  jurisdiction: Jurisdiction;
  /** Human label for logs / dashboards */
  label: string;
  /** Token bucket: max requests per minute against this host */
  rateLimit: number;
  /** Authoritative tier (1 = primary govt source, 2 = official secondary, 3 = curated tertiary) */
  tier: 1 | 2 | 3;
  /** True if subdomains of `host` are also permitted */
  matchSubdomains?: boolean;
  /** Optional path prefix restriction; if set, only URLs whose pathname starts with this string are allowed */
  pathPrefix?: string;
  /** Notes for auditors */
  notes?: string;
}

export const NV_SCRAPER_ALLOWLIST: AllowedSource[] = [
  // ── INDIA ──────────────────────────────────────────────────────────────────
  { host: 'indiankanoon.org', jurisdiction: 'IN', label: 'Indian Kanoon', rateLimit: 30, tier: 2, matchSubdomains: false, notes: 'Curated case-law repository' },
  { host: 'main.sci.gov.in', jurisdiction: 'IN', label: 'Supreme Court of India', rateLimit: 20, tier: 1 },
  { host: 'ecourts.gov.in', jurisdiction: 'IN', label: 'eCourts (HC/DC)', rateLimit: 15, tier: 1, matchSubdomains: true },
  { host: 'egazette.gov.in', jurisdiction: 'IN', label: 'India e-Gazette', rateLimit: 20, tier: 1 },
  { host: 'prsindia.org', jurisdiction: 'IN', label: 'PRS Legislative Research', rateLimit: 30, tier: 2 },
  { host: 'lawmin.gov.in', jurisdiction: 'IN', label: 'Ministry of Law & Justice', rateLimit: 20, tier: 1 },

  // ── UNITED KINGDOM ────────────────────────────────────────────────────────
  { host: 'legislation.gov.uk', jurisdiction: 'UK', label: 'UK Legislation', rateLimit: 30, tier: 1, matchSubdomains: true },
  { host: 'caselaw.nationalarchives.gov.uk', jurisdiction: 'UK', label: 'UK Case Law (National Archives)', rateLimit: 30, tier: 1 },
  { host: 'judiciary.uk', jurisdiction: 'UK', label: 'UK Judiciary', rateLimit: 20, tier: 1, matchSubdomains: true },
  { host: 'gov.uk', jurisdiction: 'UK', label: 'gov.uk (regulator content)', rateLimit: 30, tier: 1, matchSubdomains: true },

  // ── UNITED STATES ─────────────────────────────────────────────────────────
  { host: 'supremecourt.gov', jurisdiction: 'US', label: 'US Supreme Court', rateLimit: 20, tier: 1 },
  { host: 'law.cornell.edu', jurisdiction: 'US', label: 'Cornell LII', rateLimit: 30, tier: 2 },
  { host: 'congress.gov', jurisdiction: 'US', label: 'US Congress', rateLimit: 30, tier: 1 },
  { host: 'govinfo.gov', jurisdiction: 'US', label: 'US Government Publishing Office', rateLimit: 30, tier: 1 },
  { host: 'ecfr.gov', jurisdiction: 'US', label: 'eCFR — Code of Federal Regulations', rateLimit: 30, tier: 1 },
  { host: 'sec.gov', jurisdiction: 'US', label: 'SEC', rateLimit: 20, tier: 1, matchSubdomains: true },

  // ── GCC ───────────────────────────────────────────────────────────────────
  { host: 'elaws.moj.gov.ae', jurisdiction: 'GCC', label: 'UAE Ministry of Justice e-Laws', rateLimit: 15, tier: 1 },
  { host: 'mof.gov.ae', jurisdiction: 'GCC', label: 'UAE Ministry of Finance', rateLimit: 15, tier: 1 },
  { host: 'laws.boe.gov.sa', jurisdiction: 'GCC', label: 'KSA Bureau of Experts', rateLimit: 15, tier: 1 },
  { host: 'almeezan.qa', jurisdiction: 'GCC', label: 'Qatar Al Meezan Legal Portal', rateLimit: 15, tier: 1 },

  // ── EUROPEAN UNION ────────────────────────────────────────────────────────
  { host: 'eur-lex.europa.eu', jurisdiction: 'EU', label: 'EUR-Lex', rateLimit: 30, tier: 1 },
  { host: 'curia.europa.eu', jurisdiction: 'EU', label: 'CJEU', rateLimit: 20, tier: 1 },
  { host: 'europarl.europa.eu', jurisdiction: 'EU', label: 'European Parliament', rateLimit: 20, tier: 1 },
  { host: 'edpb.europa.eu', jurisdiction: 'EU', label: 'European Data Protection Board', rateLimit: 20, tier: 1 },

  // ── SINGAPORE ─────────────────────────────────────────────────────────────
  { host: 'sso.agc.gov.sg', jurisdiction: 'SG', label: 'Singapore Statutes Online', rateLimit: 20, tier: 1 },
  { host: 'judiciary.gov.sg', jurisdiction: 'SG', label: 'Singapore Judiciary', rateLimit: 20, tier: 1 },
  { host: 'mlaw.gov.sg', jurisdiction: 'SG', label: 'Ministry of Law (SG)', rateLimit: 20, tier: 1, matchSubdomains: true },
];

/**
 * Look up an allowed source for a given URL. Returns null when the URL is not
 * permitted (caller MUST treat this as a hard reject).
 */
export function findAllowedSource(rawUrl: string): AllowedSource | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const host = parsed.hostname.toLowerCase();
  for (const src of NV_SCRAPER_ALLOWLIST) {
    const matches = src.matchSubdomains
      ? host === src.host || host.endsWith('.' + src.host)
      : host === src.host;
    if (!matches) continue;
    if (src.pathPrefix && !parsed.pathname.startsWith(src.pathPrefix)) continue;
    return src;
  }
  return null;
}
