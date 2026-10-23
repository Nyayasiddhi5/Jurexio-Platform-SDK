import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-legal-reranker');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  jurisdiction?: JurisdictionCode;
  metadata?: Record<string, unknown>;
}

export interface RankedResult extends SearchResult {
  rrfScore: number;
  crossEncoderScore: number;
  finalScore: number;
  rank: number;
}

export interface RerankOptions {
  jurisdiction?: JurisdictionCode;
  topK?: number;
  mmrLambda?: number;
  rrfK?: number;
  jurisdictionBoostFactor?: number;
}

const DEFAULT_RRF_K = 60;
const DEFAULT_MMR_LAMBDA = 0.7;
const DEFAULT_TOP_K = 10;
const DEFAULT_JURISDICTION_BOOST = 1.2;

const DEFAULT_COHERE_RERANK_MODEL = 'rerank-v3.5';
const DEFAULT_VOYAGE_RERANK_MODEL = 'rerank-2';
const RERANK_DOC_CHAR_LIMIT = 4000;

/**
 * A neural cross-encoder/rerank provider is used by DEFAULT whenever one is
 * configured (precedence: self-hosted CROSS_ENCODER_URL → Cohere → Voyage).
 * The keyword-overlap heuristic is a real, deterministic last resort used ONLY
 * when no provider is configured (or a provider call fails) — and every such
 * degrade is logged explicitly. No scores are fabricated: relevance always
 * comes from the provider, or from term-overlap in the heuristic path.
 */
type RerankProvider =
  | { kind: 'cross-encoder'; endpoint: string }
  | { kind: 'cohere'; apiKey: string; model: string }
  | { kind: 'voyage'; apiKey: string; model: string }
  | { kind: 'keyword' };

export class NvLegalRerankerService {
  private static instance: NvLegalRerankerService;

  private constructor() {}

  static getInstance(): NvLegalRerankerService {
    if (!NvLegalRerankerService.instance) {
      NvLegalRerankerService.instance = new NvLegalRerankerService();
    }
    return NvLegalRerankerService.instance;
  }

  fusionRRF(resultLists: Array<{ items: SearchResult[]; weight: number }>, k: number = DEFAULT_RRF_K): SearchResult[] {
    const scores = new Map<string, { score: number; item: SearchResult }>();

    for (const { items, weight } of resultLists) {
      for (let rank = 0; rank < items.length; rank++) {
        const item = items[rank];
        const rrfScore = weight / (k + rank + 1);
        const existing = scores.get(item.id);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scores.set(item.id, { score: rrfScore, item: { ...item } });
        }
      }
    }

    const fused = Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, item }) => ({ ...item, score }));

    return fused;
  }

  async rerankLegal(query: string, candidates: SearchResult[], options: RerankOptions = {}): Promise<RankedResult[]> {
    const startTime = Date.now();
    const jurisdictionBoost = options.jurisdictionBoostFactor || DEFAULT_JURISDICTION_BOOST;

    try {
      const provider = this.selectRerankProvider();

      let rankedResults: RankedResult[];

      switch (provider.kind) {
        case 'cross-encoder':
          rankedResults = await this.callCrossEncoder(query, candidates, provider.endpoint);
          break;
        case 'cohere':
          rankedResults = await this.callCohereRerank(query, candidates, provider.apiKey, provider.model);
          break;
        case 'voyage':
          rankedResults = await this.callVoyageRerank(query, candidates, provider.apiKey, provider.model);
          break;
        case 'keyword':
        default:
          logger.warn({
            service: 'NvLegalRerankerService',
            method: 'rerankLegal',
            note: 'No neural reranker provider configured (set CROSS_ENCODER_URL, COHERE_API_KEY, or VOYAGE_API_KEY). Using keyword-overlap heuristic as an explicit last resort.',
          });
          rankedResults = this.keywordBasedRerank(query, candidates);
          break;
      }

      if (options.jurisdiction) {
        for (const result of rankedResults) {
          if (result.jurisdiction === options.jurisdiction) {
            result.finalScore *= jurisdictionBoost;
          }
        }
      }

      rankedResults.sort((a, b) => b.finalScore - a.finalScore);
      rankedResults.forEach((r, i) => { r.rank = i + 1; });

      logger.info({
        service: 'NvLegalRerankerService',
        method: 'rerankLegal',
        provider: provider.kind,
        candidateCount: candidates.length,
        resultCount: rankedResults.length,
        durationMs: Date.now() - startTime,
      });

      return rankedResults;
    } catch (error: any) {
      logger.error({
        service: 'NvLegalRerankerService',
        method: 'rerankLegal',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return candidates.map((c, i) => ({
        ...c, rrfScore: c.score, crossEncoderScore: 0, finalScore: c.score, rank: i + 1,
      }));
    }
  }

  applyMMR(candidates: RankedResult[], lambda: number = DEFAULT_MMR_LAMBDA, topK: number = DEFAULT_TOP_K): RankedResult[] {
    if (candidates.length === 0) return [];

    const selected: RankedResult[] = [candidates[0]];
    const remaining = candidates.slice(1);

    while (selected.length < topK && remaining.length > 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevanceScore = candidate.finalScore;
        const maxSimilarity = Math.max(...selected.map(s => this.textSimilarity(s.content, candidate.content)));
        const mmrScore = lambda * relevanceScore - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
      } else {
        break;
      }
    }

    selected.forEach((r, i) => { r.rank = i + 1; });
    return selected;
  }

  async rerankResults(
    query: string,
    bm25Results: SearchResult[],
    vectorResults: SearchResult[],
    options: RerankOptions = {}
  ): Promise<RankedResult[]> {
    const startTime = Date.now();
    const k = options.rrfK || DEFAULT_RRF_K;
    const topK = options.topK || DEFAULT_TOP_K;
    const lambda = options.mmrLambda || DEFAULT_MMR_LAMBDA;

    const fused = this.fusionRRF([
      { items: bm25Results, weight: 1.0 },
      { items: vectorResults, weight: 1.2 },
    ], k);

    const reranked = await this.rerankLegal(query, fused, options);
    const diverse = this.applyMMR(reranked, lambda, topK);

    logger.info({
      service: 'NvLegalRerankerService',
      method: 'rerankResults',
      bm25Count: bm25Results.length,
      vectorCount: vectorResults.length,
      fusedCount: fused.length,
      finalCount: diverse.length,
      durationMs: Date.now() - startTime,
    });

    return diverse;
  }

  /**
   * Pick the active reranker provider. A neural provider wins whenever one is
   * configured; precedence is self-hosted endpoint → Cohere → Voyage.
   */
  private selectRerankProvider(): RerankProvider {
    const crossEncoderUrl = process.env.CROSS_ENCODER_URL;
    if (crossEncoderUrl) return { kind: 'cross-encoder', endpoint: crossEncoderUrl };

    const cohereKey = process.env.COHERE_API_KEY;
    if (cohereKey) {
      return { kind: 'cohere', apiKey: cohereKey, model: process.env.COHERE_RERANK_MODEL || DEFAULT_COHERE_RERANK_MODEL };
    }

    const voyageKey = process.env.VOYAGE_API_KEY;
    if (voyageKey) {
      return { kind: 'voyage', apiKey: voyageKey, model: process.env.VOYAGE_RERANK_MODEL || DEFAULT_VOYAGE_RERANK_MODEL };
    }

    return { kind: 'keyword' };
  }

  /** True when a real neural rerank provider is configured (not keyword heuristic). */
  hasNeuralProvider(): boolean {
    return this.selectRerankProvider().kind !== 'keyword';
  }

  private combineNeuralScores(candidates: SearchResult[], relevanceByIndex: Map<number, number>): RankedResult[] {
    return candidates.map((c, i) => {
      const relevance = relevanceByIndex.get(i) ?? 0;
      return {
        ...c,
        rrfScore: c.score,
        crossEncoderScore: relevance,
        finalScore: (c.score + relevance) / 2,
        rank: i + 1,
      };
    });
  }

  private async callCohereRerank(
    query: string,
    candidates: SearchResult[],
    apiKey: string,
    model: string,
  ): Promise<RankedResult[]> {
    try {
      const documents = candidates.map(c => c.content.substring(0, RERANK_DOC_CHAR_LIMIT));
      const response = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, query, documents, top_n: documents.length }),
      });

      if (response.ok === false) {
        throw new Error(`Cohere rerank API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const results = Array.isArray(data?.results) ? data.results : null;
      if (!results) throw new Error('Cohere rerank API returned no results');

      const relevanceByIndex = new Map<number, number>();
      for (const r of results) {
        if (typeof r?.index === 'number' && typeof r?.relevance_score === 'number') {
          relevanceByIndex.set(r.index, r.relevance_score);
        }
      }
      return this.combineNeuralScores(candidates, relevanceByIndex);
    } catch (err: any) {
      logger.warn({
        service: 'NvLegalRerankerService',
        method: 'callCohereRerank',
        error: err instanceof Error ? err.message : 'Unknown error',
        note: 'Cohere rerank failed — explicitly degrading to keyword-overlap heuristic',
      });
      return this.keywordBasedRerank(query, candidates);
    }
  }

  private async callVoyageRerank(
    query: string,
    candidates: SearchResult[],
    apiKey: string,
    model: string,
  ): Promise<RankedResult[]> {
    try {
      const documents = candidates.map(c => c.content.substring(0, RERANK_DOC_CHAR_LIMIT));
      const response = await fetch('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, documents, model, top_k: documents.length }),
      });

      if (response.ok === false) {
        throw new Error(`Voyage rerank API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const results = Array.isArray(data?.data) ? data.data : null;
      if (!results) throw new Error('Voyage rerank API returned no results');

      const relevanceByIndex = new Map<number, number>();
      for (const r of results) {
        if (typeof r?.index === 'number' && typeof r?.relevance_score === 'number') {
          relevanceByIndex.set(r.index, r.relevance_score);
        }
      }
      return this.combineNeuralScores(candidates, relevanceByIndex);
    } catch (err: any) {
      logger.warn({
        service: 'NvLegalRerankerService',
        method: 'callVoyageRerank',
        error: err instanceof Error ? err.message : 'Unknown error',
        note: 'Voyage rerank failed — explicitly degrading to keyword-overlap heuristic',
      });
      return this.keywordBasedRerank(query, candidates);
    }
  }

  private keywordBasedRerank(query: string, candidates: SearchResult[]): RankedResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    return candidates.map((c, i) => {
      const content = c.content.toLowerCase();
      let boost = 0;
      for (const term of queryTerms) {
        if (content.includes(term)) boost += 0.1;
      }
      const crossEncoderScore = c.score + boost;
      return {
        ...c,
        rrfScore: c.score,
        crossEncoderScore,
        finalScore: crossEncoderScore,
        rank: i + 1,
      };
    });
  }

  private async callCrossEncoder(query: string, candidates: SearchResult[], endpoint: string): Promise<RankedResult[]> {
    try {
      const pairs = candidates.map(c => ({ query, passage: c.content.substring(0, 500) }));
      const batchSize = 32;
      const scores: number[] = [];

      for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairs: batch }),
        });

        if (response.ok === false) throw new Error(`Cross-encoder API error: ${response.status}`);
        const data = await response.json() as any;
        scores.push(...(data.scores || []));
      }

      return candidates.map((c, i) => ({
        ...c,
        rrfScore: c.score,
        crossEncoderScore: scores[i] || 0,
        finalScore: (c.score + (scores[i] || 0)) / 2,
        rank: i + 1,
      }));
    } catch (err: any) {
      logger.warn({
        service: 'NvLegalRerankerService',
        method: 'callCrossEncoder',
        error: err instanceof Error ? err.message : 'Unknown error',
        note: 'Cross-encoder rerank failed — explicitly degrading to keyword-overlap heuristic',
      });
      return this.keywordBasedRerank(query, candidates);
    }
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    return intersection.size / Math.max(1, Math.sqrt(wordsA.size * wordsB.size));
  }
}

export const nvLegalRerankerService = NvLegalRerankerService.getInstance();
