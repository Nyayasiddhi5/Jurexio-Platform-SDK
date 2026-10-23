/**
 * Jurexio Tavily Client — task #304 (Demo G3B)
 *
 * Thin wrapper around the Tavily Search API used by the Regulatory Monitor
 * to scrape live regulatory news for jurisdictions that don't have a
 * curated SLM-grade feed (US, UK, EU, SG, GC, IN). Reads `TAVILY_API_KEY`
 * from env. Returns normalised `TavilyNewsItem` records suitable for
 * persisting to `nv_regulatory_feeds`.
 *
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference#search
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-tavily');

export type TavilyJurisdiction = 'US' | 'IN' | 'UK' | 'EU' | 'SG' | 'GC';

export interface TavilyNewsItem {
  title: string;
  url: string;
  source: string;            // hostname extracted from URL
  summary: string;           // tavily content
  publishedAt: string | null; // ISO date if tavily supplies it
  score: number;             // 0..1 relevance score from tavily
  jurisdiction: TavilyJurisdiction;
  topic: string;             // the search term that produced the hit
  rawDomain: string;
}

interface TavilyApiResult {
  title: string;
  url: string;
  content?: string;
  raw_content?: string;
  score?: number;
  published_date?: string;
}

interface TavilyApiResponse {
  results?: TavilyApiResult[];
  answer?: string;
  query?: string;
}

/**
 * Curated, jurisdiction-tuned regulatory search terms used by the Tavily
 * client. Each term targets a different angle (rule-making, enforcement,
 * data-protection, antitrust, financial supervision, AI policy) so that
 * a single jurisdiction sweep returns diverse coverage rather than 20
 * variants of the same headline.
 */
export const REGULATORY_SEARCH_TERMS: Record<TavilyJurisdiction, string[]> = {
  US: [
    'SEC new rule announcement',
    'FTC consent decree',
    'CFPB enforcement action',
    'DOJ antitrust filing',
    'CCPA amendment',
    'HIPAA enforcement',
    'OCC banking guidance',
    'White House executive order regulation',
    // task-345: explicit state-privacy + federal-cloud probes so VCDPA,
    // CPA, and FedRAMP get distinct headlines instead of falling out of
    // the broader "FTC / SEC" sweep.
    'Virginia Attorney General VCDPA enforcement',
    'Colorado Attorney General CPA Privacy Act enforcement',
    'FedRAMP PMO authorization GSA cloud security',
    // task-351: state breach-notification probes so NY SHIELD, IL BIPA,
    // and MA 201 CMR 17 enforcement events surface as distinct headlines
    // instead of disappearing into the FTC / DOJ catch-all.
    'New York Attorney General SHIELD Act data breach enforcement',
    'Illinois Attorney General BIPA biometric privacy lawsuit',
    'Massachusetts OCABR 201 CMR 17 data breach notification',
  ],
  IN: [
    'SEBI circular',
    'RBI master direction',
    'MCA notification companies act',
    'CCI antitrust order',
    'DPDP Act enforcement',
    'TRAI consultation paper',
    'IRDAI insurance regulation',
  ],
  UK: [
    'FCA policy statement',
    'ICO data protection enforcement',
    'CMA market investigation',
    'PRA prudential regulation',
    'HMRC tax consultation',
    'Ofcom online safety',
  ],
  EU: [
    'European Commission regulation',
    'EDPB GDPR guideline',
    'ESMA market regulation',
    'EBA banking standard',
    'EU AI Act implementation',
    'Digital Services Act enforcement',
  ],
  SG: [
    'MAS regulatory notice',
    'PDPC data protection enforcement Singapore',
    'ACRA companies act Singapore',
    'SGX listing rule',
    'Competition Commission Singapore',
  ],
  GC: [
    'ADGM regulation',
    'DIFC financial regulation',
    'UAE Central Bank circular',
    'SAMA Saudi banking regulation',
    'ZATCA tax notice',
  ],
};

/**
 * Country bias passed to Tavily so that "SEC rule" returns
 * sec.gov / reuters.com / law360.com hits rather than overseas press.
 */
const COUNTRY_FOR_JURISDICTION: Record<TavilyJurisdiction, string | undefined> = {
  US: 'united states',
  IN: 'india',
  UK: 'united kingdom',
  EU: undefined, // pan-european; rely on search terms
  SG: 'singapore',
  GC: 'united arab emirates',
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

export function isTavilyConfigured(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Run a single Tavily news search for the given jurisdiction + topic.
 * Returns at most `maxResults` normalised items.
 */
export async function tavilySearchNews(
  jurisdiction: TavilyJurisdiction,
  topic: string,
  opts: { maxResults?: number; daysBack?: number } = {},
): Promise<TavilyNewsItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  const maxResults = opts.maxResults ?? 5;
  const daysBack = opts.daysBack ?? 7;

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: topic,
    search_depth: 'basic',
    topic: 'news',
    days: daysBack,
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
  const country = COUNTRY_FOR_JURISDICTION[jurisdiction];
  if (country) body.country = country;

  let response: Response;
  try {
    response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: any) {
    logger.warn('[tavily] request failed', { jurisdiction, topic, error: err?.message });
    return [];
  }

  if (response.ok === false) {
    logger.warn('[tavily] non-200 response', {
      jurisdiction,
      topic,
      status: response.status,
    });
    return [];
  }

  let payload: TavilyApiResponse;
  try {
    payload = (await response.json()) as TavilyApiResponse;
  } catch {
    return [];
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  return results
    .filter((r) => r && typeof r.url === 'string' && typeof r.title === 'string')
    .map<TavilyNewsItem>((r) => {
      const host = hostnameOf(r.url);
      return {
        title: r.title.slice(0, 500),
        url: r.url,
        source: host,
        rawDomain: host,
        summary: (r.content ?? '').slice(0, 1200),
        publishedAt: r.published_date ?? null,
        score: typeof r.score === 'number' ? r.score : 0,
        jurisdiction,
        topic,
      };
    });
}

/**
 * Run all curated search terms for a jurisdiction in parallel and
 * deduplicate the merged set by URL. Returns up to `cap` items sorted
 * by score (desc) then by publishedAt (desc).
 */
export async function tavilySweepJurisdiction(
  jurisdiction: TavilyJurisdiction,
  opts: { perTermLimit?: number; cap?: number; daysBack?: number } = {},
): Promise<TavilyNewsItem[]> {
  if (!isTavilyConfigured()) return [];
  const perTermLimit = opts.perTermLimit ?? 4;
  const cap = opts.cap ?? 30;
  const daysBack = opts.daysBack ?? 7;
  const terms = REGULATORY_SEARCH_TERMS[jurisdiction] ?? [];
  if (terms.length === 0) return [];

  const batches = await Promise.allSettled(
    terms.map((t) =>
      tavilySearchNews(jurisdiction, t, { maxResults: perTermLimit, daysBack }),
    ),
  );

  const seen = new Set<string>();
  const merged: TavilyNewsItem[] = [];
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    for (const item of b.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }

  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ad = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bd = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bd - ad;
  });

  return merged.slice(0, cap);
}
