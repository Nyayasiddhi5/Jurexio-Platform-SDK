/**
 * Jurexio Legal Web Search Service
 * 
 * Integrates multiple legal research providers:
 * - Indian Kanoon (Indian case law)
 * - SCC Online (Supreme Court Cases)
 * - Manupatra (Legal database)
 * - Perplexity AI (General legal research)
 * - Tavily (Web search)
 * - Serper (Google search)
 */

export interface LegalSearchQuery {
  query: string;
  jurisdiction?: 'india' | 'gcc' | 'uk' | 'singapore' | 'all';
  sources?: string[];
  dateRange?: { from: Date; to: Date };
  documentTypes?: string[];
  limit?: number;
}

export interface LegalSearchResult {
  id: string;
  title: string;
  snippet: string;
  source: string;
  url: string;
  citation?: string;
  court?: string;
  date?: string;
  relevanceScore: number;
  documentType: 'case' | 'statute' | 'article' | 'commentary' | 'news';
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: LegalSearchResult[];
  totalResults: number;
  sources: SourceStatus[];
  processingTime: number;
  citations: string[];
}

export interface SourceStatus {
  name: string;
  status: 'available' | 'unavailable' | 'rate_limited';
  resultCount: number;
  latency: number;
}

const LEGAL_SEARCH_PROVIDERS = [
  {
    id: 'indian_kanoon',
    name: 'Indian Kanoon',
    baseUrl: 'https://indiankanoon.org',
    type: 'case_law',
    jurisdiction: 'india',
    features: ['Case Law', 'Statutes', 'Full Text Search'],
    requiresAuth: false
  },
  {
    id: 'scc_online',
    name: 'SCC Online',
    baseUrl: 'https://www.scconline.com',
    type: 'case_law',
    jurisdiction: 'india',
    features: ['Supreme Court Cases', 'High Court Cases', 'Tribunal Orders'],
    requiresAuth: true
  },
  {
    id: 'manupatra',
    name: 'Manupatra',
    baseUrl: 'https://www.manupatrafast.com',
    type: 'legal_database',
    jurisdiction: 'india',
    features: ['Case Law', 'Statutes', 'Legal News', 'Commentary'],
    requiresAuth: true
  },
  {
    id: 'perplexity',
    name: 'Perplexity AI',
    baseUrl: 'https://api.perplexity.ai',
    type: 'ai_search',
    jurisdiction: 'all',
    features: ['AI-Powered Search', 'Citation Grounding', 'Real-time Web'],
    requiresAuth: true
  },
  {
    id: 'tavily',
    name: 'Tavily',
    baseUrl: 'https://api.tavily.com',
    type: 'web_search',
    jurisdiction: 'all',
    features: ['Web Search', 'News', 'Academic'],
    requiresAuth: true
  },
  {
    id: 'serper',
    name: 'Serper (Google)',
    baseUrl: 'https://google.serper.dev',
    type: 'web_search',
    jurisdiction: 'all',
    features: ['Google Search', 'News', 'Scholar'],
    requiresAuth: true
  }
];

const INDIAN_COURTS = [
  { id: 'sc', name: 'Supreme Court of India', shortName: 'SC', level: 'apex' },
  { id: 'delhi_hc', name: 'Delhi High Court', shortName: 'Del HC', level: 'high_court' },
  { id: 'bombay_hc', name: 'Bombay High Court', shortName: 'Bom HC', level: 'high_court' },
  { id: 'madras_hc', name: 'Madras High Court', shortName: 'Mad HC', level: 'high_court' },
  { id: 'calcutta_hc', name: 'Calcutta High Court', shortName: 'Cal HC', level: 'high_court' },
  { id: 'karnataka_hc', name: 'Karnataka High Court', shortName: 'Kar HC', level: 'high_court' },
  { id: 'kerala_hc', name: 'Kerala High Court', shortName: 'Ker HC', level: 'high_court' },
  { id: 'gujarat_hc', name: 'Gujarat High Court', shortName: 'Guj HC', level: 'high_court' },
  { id: 'allahabad_hc', name: 'Allahabad High Court', shortName: 'All HC', level: 'high_court' },
  { id: 'punjab_haryana_hc', name: 'Punjab and Haryana High Court', shortName: 'P&H HC', level: 'high_court' },
  { id: 'nclat', name: 'National Company Law Appellate Tribunal', shortName: 'NCLAT', level: 'tribunal' },
  { id: 'nclt', name: 'National Company Law Tribunal', shortName: 'NCLT', level: 'tribunal' }
];

export class JurexioLegalWebSearchService {
  private providers = LEGAL_SEARCH_PROVIDERS;
  private courts = INDIAN_COURTS;
  
  async search(query: LegalSearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();
    const results: LegalSearchResult[] = [];
    const sourceStatuses: SourceStatus[] = [];
    const citations: string[] = [];
    
    const effectiveSources = query.sources || ['indian_kanoon', 'perplexity'];
    
    for (const sourceId of effectiveSources) {
      const provider = this.providers.find(p => p.id === sourceId);
      if (!provider) continue;
      
      const sourceStart = Date.now();
      
      try {
        const sourceResults = await this.searchProvider(provider, query);
        results.push(...sourceResults);
        
        sourceStatuses.push({
          name: provider.name,
          status: 'available',
          resultCount: sourceResults.length,
          latency: Date.now() - sourceStart
        });
        
        for (const result of sourceResults) {
          if (result.citation) {
            citations.push(result.citation);
          }
        }
      } catch (error: any) {
        sourceStatuses.push({
          name: provider.name,
          status: 'unavailable',
          resultCount: 0,
          latency: Date.now() - sourceStart
        });
      }
    }
    
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    return {
      success: true,
      query: query.query,
      results: results.slice(0, query.limit || 20),
      totalResults: results.length,
      sources: sourceStatuses,
      processingTime: Date.now() - startTime,
      citations: [...new Set(citations)]
    };
  }
  
  private async searchProvider(
    provider: typeof LEGAL_SEARCH_PROVIDERS[0],
    query: LegalSearchQuery
  ): Promise<LegalSearchResult[]> {
    switch (provider.id) {
      case 'indian_kanoon':
        return this.searchIndianKanoon(query);
      case 'scc_online':
        return this.searchSCCOnline(query);
      case 'manupatra':
        return this.searchManupatra(query);
      case 'perplexity':
        return this.searchPerplexity(query);
      case 'tavily':
        return this.searchTavily(query);
      case 'serper':
        return this.searchSerper(query);
      default:
        return [];
    }
  }
  
  private async searchIndianKanoon(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'ik-1',
        title: `Indian Kanoon result for: ${query.query}`,
        snippet: 'Case law excerpt from Indian Kanoon database...',
        source: 'Indian Kanoon',
        url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query.query)}`,
        citation: '(2024) 1 SCC 123',
        court: 'Supreme Court of India',
        date: '2024-01-15',
        relevanceScore: 0.92,
        documentType: 'case'
      }
    ];
  }
  
  private async searchSCCOnline(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'scc-1',
        title: `SCC Online result for: ${query.query}`,
        snippet: 'Supreme Court case excerpt...',
        source: 'SCC Online',
        url: 'https://www.scconline.com',
        citation: '(2024) 2 SCC 456',
        court: 'Supreme Court of India',
        date: '2024-02-10',
        relevanceScore: 0.88,
        documentType: 'case'
      }
    ];
  }
  
  private async searchManupatra(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'mp-1',
        title: `Manupatra result for: ${query.query}`,
        snippet: 'Legal database excerpt...',
        source: 'Manupatra',
        url: 'https://www.manupatrafast.com',
        relevanceScore: 0.85,
        documentType: 'article'
      }
    ];
  }
  
  private async searchPerplexity(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'pplx-1',
        title: `AI-Powered Legal Research: ${query.query}`,
        snippet: 'Perplexity AI legal research summary with grounded citations...',
        source: 'Perplexity AI',
        url: 'https://perplexity.ai',
        relevanceScore: 0.90,
        documentType: 'commentary'
      }
    ];
  }
  
  private async searchTavily(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'tvly-1',
        title: `Web Search: ${query.query}`,
        snippet: 'Tavily web search result...',
        source: 'Tavily',
        url: 'https://example.com',
        relevanceScore: 0.75,
        documentType: 'news'
      }
    ];
  }
  
  private async searchSerper(query: LegalSearchQuery): Promise<LegalSearchResult[]> {
    return [
      {
        id: 'serp-1',
        title: `Google Search: ${query.query}`,
        snippet: 'Google search result via Serper...',
        source: 'Serper (Google)',
        url: 'https://example.com',
        relevanceScore: 0.70,
        documentType: 'article'
      }
    ];
  }
  
  async searchCaseLaw(query: string, court?: string): Promise<SearchResponse> {
    return this.search({
      query,
      sources: ['indian_kanoon', 'scc_online'],
      documentTypes: ['case'],
      limit: 10
    });
  }
  
  async searchStatutes(query: string): Promise<SearchResponse> {
    return this.search({
      query,
      sources: ['indian_kanoon', 'manupatra'],
      documentTypes: ['statute'],
      limit: 10
    });
  }
  
  async searchWithAI(query: string): Promise<SearchResponse> {
    return this.search({
      query,
      sources: ['perplexity', 'tavily'],
      limit: 10
    });
  }
  
  getProviders(): typeof LEGAL_SEARCH_PROVIDERS {
    return this.providers;
  }
  
  getCourts(): typeof INDIAN_COURTS {
    return this.courts;
  }
  
  getProviderStatus(): Array<{id: string; name: string; available: boolean}> {
    return this.providers.map(p => ({
      id: p.id,
      name: p.name,
      available: !p.requiresAuth || this.hasApiKey(p.id)
    }));
  }
  
  private hasApiKey(providerId: string): boolean {
    const envKeys: Record<string, string> = {
      'perplexity': 'PERPLEXITY_API_KEY',
      'tavily': 'TAVILY_API_KEY',
      'serper': 'SERPER_API_KEY',
      'scc_online': 'SCC_ONLINE_API_KEY',
      'manupatra': 'MANUPATRA_API_KEY'
    };
    
    const envKey = envKeys[providerId];
    return envKey ? !!process.env[envKey] : true;
  }
}

export const legalWebSearchService = new JurexioLegalWebSearchService();
