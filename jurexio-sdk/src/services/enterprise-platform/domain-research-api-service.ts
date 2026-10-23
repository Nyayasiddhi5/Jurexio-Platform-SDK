/**
 * DomainResearchAPIService
 *
 * Multi-domain research adapter consumed by the SDK Enterprise routes
 * (`/api/jrx/sdk/enterprise/research/domain/{legal,academic,patents,medical}`
 * and `/api/jrx/sdk/enterprise/research/synthesis`).
 *
 * NV-REAL-DATA-001 (Session-29, 2026-06-29): the previous version returned
 * typed-but-EMPTY results and synthetic WHOIS/IP data. It now performs REAL
 * research via the Tavily-backed web search service with domain-tuned queries,
 * and synthesises results through the single safety ring (NV-LLM-001). It fails
 * loud when no search provider is configured rather than returning fabricated
 * or empty data. The unused synthetic WHOIS/IP/domain-availability helpers were
 * removed (dead code).
 */
import { createLogger } from '../../utils/logger.js';
import { realWebSearchService } from './real-web-search-service.js';

const logger = createLogger('domain-research');

export type DomainType = 'legal' | 'academic' | 'patents' | 'medical' | 'general';

interface ResearchResult {
  title: string;
  source: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  jurisdiction?: string;
  relevanceScore?: number;
}

interface ResearchResponse {
  query: string;
  domain: DomainType;
  results: ResearchResult[];
  totalCount: number;
  provider: string;
  cached: boolean;
  retrievedAt: string;
  stub: boolean;
}

interface SynthesisResponse {
  query: string;
  domain: DomainType;
  synthesis: string;
  citations: Array<{ title: string; url: string }>;
  confidence: number;
  generatedAt: string;
  stub: boolean;
}

const DOMAIN_QUERY_HINT: Record<DomainType, string> = {
  legal: 'case law statute regulation legal authority',
  academic: 'research paper study peer-reviewed',
  patents: 'patent filing claims prior art',
  medical: 'clinical study medical guideline evidence',
  general: '',
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

class DomainResearchAPIService {
  private requestCount = 0;

  private async runDomainSearch(
    query: string,
    domain: DomainType,
    options?: Record<string, unknown>,
  ): Promise<ResearchResponse> {
    this.requestCount++;
    const limit = Number((options?.limit as number) || 8);
    const hint = DOMAIN_QUERY_HINT[domain];
    const augmented = hint ? `${query} ${hint}` : query;

    const web = await realWebSearchService.search(augmented, { limit, searchDepth: 'advanced' });
    const results: ResearchResult[] = web.results.map((r) => ({
      title: r.title,
      source: hostOf(r.url),
      url: r.url,
      snippet: r.snippet,
      publishedAt: r.publishedAt ?? undefined,
      jurisdiction: (options?.jurisdiction as string) || undefined,
      relevanceScore: r.score,
    }));

    return {
      query,
      domain,
      results,
      totalCount: results.length,
      provider: `tavily:${domain}`,
      cached: web.cached,
      retrievedAt: new Date().toISOString(),
      stub: false,
    };
  }

  async searchLegal(query: string, options?: Record<string, unknown>): Promise<ResearchResponse> {
    return this.runDomainSearch(query, 'legal', options);
  }

  async searchAcademic(query: string, options?: Record<string, unknown>): Promise<ResearchResponse> {
    return this.runDomainSearch(query, 'academic', options);
  }

  async searchPatents(query: string, options?: Record<string, unknown>): Promise<ResearchResponse> {
    return this.runDomainSearch(query, 'patents', options);
  }

  async searchMedical(query: string, options?: Record<string, unknown>): Promise<ResearchResponse> {
    return this.runDomainSearch(query, 'medical', options);
  }

  async generateResearchSynthesis(query: string, domain: DomainType): Promise<SynthesisResponse> {
    this.requestCount++;
    const search = await this.runDomainSearch(query, domain);
    if (search.results.length === 0) {
      return {
        query, domain, synthesis: '', citations: [], confidence: 0,
        generatedAt: new Date().toISOString(), stub: false,
      };
    }

    const sources = search.results
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`)
      .join('\n\n');

    let synthesis = '';
    try {
      const { callJurexioSimple } = await import('../jrx-client.js');
      const system = `You are a ${domain} research analyst. Synthesise the provided sources into a concise, well-structured brief. Cite sources inline as [n]. Do not invent facts not present in the sources.`;
      synthesis = await callJurexioSimple(system, `Question: ${query}\n\nSources:\n${sources}\n\nSynthesis:`, 1200);
    } catch (err) {
      logger.warn('research synthesis safety-ring failed', { error: (err as Error).message });
      throw new Error(`Research synthesis unavailable: ${(err as Error).message}`);
    }

    return {
      query,
      domain,
      synthesis: synthesis.trim(),
      citations: search.results.slice(0, 8).map((r) => ({ title: r.title, url: r.url })),
      confidence: Math.min(0.95, 0.4 + search.results.length * 0.05),
      generatedAt: new Date().toISOString(),
      stub: false,
    };
  }

  getStats(): { requestCount: number } {
    return { requestCount: this.requestCount };
  }
}

export const domainResearchAPIService = new DomainResearchAPIService();
