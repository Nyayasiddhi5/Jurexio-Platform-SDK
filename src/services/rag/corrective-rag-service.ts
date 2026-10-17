/**
 * Corrective RAG (CRAG) Service
 * 
 * Features:
 * - Document relevance grading before generation
 * - Query rewriting for better retrieval
 * - Web search fallback for knowledge gaps
 * - Self-correction pipeline
 * - Confidence scoring and thresholding
 */

import { v4 as uuidv4 } from 'uuid';
import { isNyvFeatureOn } from '../../config/jrx-feature-flags.js';
import { createLogger } from '../../utils/logger.js';

const cragLogger = createLogger('corrective-rag');

export type DocumentGrade = 'relevant' | 'partially_relevant' | 'irrelevant';
export type CorrectionAction = 'use_as_is' | 'rewrite_query' | 'web_search' | 'combine_sources' | 'reject';

export interface GradedDocument {
  id: string;
  content: string;
  source: string;
  grade: DocumentGrade;
  relevanceScore: number;
  gradeReasoning: string;
  metadata: Record<string, any>;
}

export interface QueryRewrite {
  originalQuery: string;
  rewrittenQuery: string;
  rewriteReason: string;
  confidence: number;
  strategy: 'expansion' | 'refinement' | 'decomposition' | 'synonym' | 'contextual';
}

export interface CorrectionDecision {
  action: CorrectionAction;
  reasoning: string;
  confidence: number;
  suggestedQuery?: string;
  documentsToUse: string[];
  documentsToReject: string[];
}

export interface CRAGPipeline {
  id: string;
  originalQuery: string;
  documents: GradedDocument[];
  rewrites: QueryRewrite[];
  corrections: CorrectionDecision[];
  finalContext: string;
  confidenceScore: number;
  iterations: number;
  latencyMs: number;
  success: boolean;
}

export interface CRAGConfig {
  relevanceThreshold: number;
  maxRewrites: number;
  maxIterations: number;
  webSearchFallback: boolean;
  minDocumentsRequired: number;
  confidenceThreshold: number;
}

class CorrectiveRAGService {
  private pipelines: Map<string, CRAGPipeline> = new Map();
  
  private config: CRAGConfig = {
    relevanceThreshold: 0.6,
    maxRewrites: 3,
    maxIterations: 5,
    webSearchFallback: true,
    minDocumentsRequired: 2,
    confidenceThreshold: 0.7
  };

  private readonly QUERY_REWRITE_STRATEGIES = {
    expansion: (query: string): string => {
      const expansions = [
        'detailed explanation of',
        'comprehensive guide to',
        'examples and use cases for'
      ];
      return `${expansions[query.length % expansions.length]} ${query}`;
    },
    refinement: (query: string): string => {
      return query.replace(/\b(what|how|why|when|where)\b/i, (match) => {
        const refined: Record<string, string> = {
          'what': 'define precisely',
          'how': 'step-by-step process for',
          'why': 'underlying reasons for',
          'when': 'timeline and conditions for',
          'where': 'specific locations for'
        };
        return refined[match.toLowerCase()] || match;
      });
    },
    decomposition: (query: string): string => {
      const parts = query.split(/\s+and\s+|\s+or\s+/i);
      return parts[0];
    },
    synonym: (query: string): string => {
      const synonymMap: Record<string, string[]> = {
        'best': ['optimal', 'top', 'recommended'],
        'how to': ['guide for', 'steps to', 'method for'],
        'explain': ['describe', 'clarify', 'elaborate on']
      };
      let result = query;
      for (const [word, synonyms] of Object.entries(synonymMap)) {
        if (query.toLowerCase().includes(word)) {
          result = result.replace(new RegExp(word, 'i'), synonyms[0]);
          break;
        }
      }
      return result;
    },
    contextual: (query: string): string => {
      return `In the context of modern best practices, ${query}`;
    }
  };

  async gradeDocuments(
    query: string,
    documents: Array<{ content: string; source: string; metadata?: Record<string, any> }>
  ): Promise<GradedDocument[]> {
    const gradedDocs: GradedDocument[] = [];

    for (const doc of documents) {
      const { grade, score, reasoning } = this.evaluateRelevance(query, doc.content);
      
      gradedDocs.push({
        id: uuidv4(),
        content: doc.content,
        source: doc.source,
        grade,
        relevanceScore: score,
        gradeReasoning: reasoning,
        metadata: doc.metadata || {}
      });
    }

    return gradedDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private evaluateRelevance(query: string, content: string): { grade: DocumentGrade; score: number; reasoning: string } {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const contentLower = content.toLowerCase();
    
    let matchCount = 0;
    const matchedTerms: string[] = [];
    
    for (const term of queryTerms) {
      if (contentLower.includes(term)) {
        matchCount++;
        matchedTerms.push(term);
      }
    }

    const termCoverage = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
    
    let semanticBonus = 0;
    const queryIntent = this.detectIntent(query);
    if (queryIntent === 'definition' && /is defined as|means|refers to/i.test(content)) {
      semanticBonus = 0.2;
    } else if (queryIntent === 'howto' && /step|first|then|finally|process/i.test(content)) {
      semanticBonus = 0.2;
    } else if (queryIntent === 'comparison' && /vs|versus|compared|difference|similar/i.test(content)) {
      semanticBonus = 0.2;
    }

    const lengthPenalty = content.length < 50 ? -0.2 : content.length > 5000 ? -0.1 : 0;
    
    const score = Math.min(1, Math.max(0, termCoverage + semanticBonus + lengthPenalty));
    
    let grade: DocumentGrade;
    if (score >= this.config.relevanceThreshold) {
      grade = 'relevant';
    } else if (score >= this.config.relevanceThreshold * 0.5) {
      grade = 'partially_relevant';
    } else {
      grade = 'irrelevant';
    }

    const reasoning = `Matched ${matchCount}/${queryTerms.length} terms (${matchedTerms.join(', ')}). ` +
                     `Semantic bonus: ${semanticBonus.toFixed(2)}. Final score: ${score.toFixed(2)}`;

    return { grade, score, reasoning };
  }

  private detectIntent(query: string): string {
    if (/what is|define|meaning of/i.test(query)) return 'definition';
    if (/how to|how do|steps|guide/i.test(query)) return 'howto';
    if (/vs|versus|compare|difference|better/i.test(query)) return 'comparison';
    if (/why|reason|cause/i.test(query)) return 'explanation';
    if (/list|examples|types of/i.test(query)) return 'enumeration';
    return 'general';
  }

  async decideCorrection(
    query: string,
    gradedDocuments: GradedDocument[]
  ): Promise<CorrectionDecision> {
    const relevantDocs = gradedDocuments.filter(d => d.grade === 'relevant');
    const partialDocs = gradedDocuments.filter(d => d.grade === 'partially_relevant');
    const irrelevantDocs = gradedDocuments.filter(d => d.grade === 'irrelevant');

    if (relevantDocs.length >= this.config.minDocumentsRequired) {
      return {
        action: 'use_as_is',
        reasoning: `Found ${relevantDocs.length} relevant documents, sufficient for generation`,
        confidence: Math.min(1, relevantDocs.reduce((sum, d) => sum + d.relevanceScore, 0) / relevantDocs.length + 0.1),
        documentsToUse: relevantDocs.map(d => d.id),
        documentsToReject: irrelevantDocs.map(d => d.id)
      };
    }

    if (relevantDocs.length + partialDocs.length >= this.config.minDocumentsRequired) {
      return {
        action: 'combine_sources',
        reasoning: `Combining ${relevantDocs.length} relevant and ${partialDocs.length} partial documents`,
        confidence: 0.7,
        documentsToUse: [...relevantDocs, ...partialDocs].map(d => d.id),
        documentsToReject: irrelevantDocs.map(d => d.id)
      };
    }

    if (this.config.webSearchFallback && relevantDocs.length === 0) {
      return {
        action: 'web_search',
        reasoning: 'No relevant documents found, falling back to web search',
        confidence: 0.5,
        suggestedQuery: this.generateWebSearchQuery(query),
        documentsToUse: [],
        documentsToReject: gradedDocuments.map(d => d.id)
      };
    }

    return {
      action: 'rewrite_query',
      reasoning: 'Insufficient relevant documents, attempting query rewrite',
      confidence: 0.6,
      suggestedQuery: await this.rewriteQuery(query),
      documentsToUse: relevantDocs.map(d => d.id),
      documentsToReject: irrelevantDocs.map(d => d.id)
    };
  }

  async rewriteQuery(query: string, strategy?: QueryRewrite['strategy']): Promise<string> {
    const strategies = Object.keys(this.QUERY_REWRITE_STRATEGIES) as Array<QueryRewrite['strategy']>;
    const selectedStrategy = strategy || strategies[query.length % strategies.length];
    
    return this.QUERY_REWRITE_STRATEGIES[selectedStrategy](query);
  }

  /**
   * NV-AGENTIC-RR-001 — LLM-driven (agentic) query reformulation. Routed through
   * the canonical safety ring (callJurexioSimple → callJurexio) per
   * NV-LLM-001, so it inherits input/output safety, routing, and metering. The
   * call is gated behind JRX_F_RAG_LLM_REFORMULATE and is fully fail-safe: any
   * error (flag off, LLM unavailable, empty/echoed result) returns `null`, and
   * every caller falls back to the deterministic heuristic rewrites. It NEVER
   * fabricates or silently swaps in a degraded query.
   *
   * @returns an improved legal search query, or null if reformulation was not
   *          performed / did not yield a usefully different query.
   */
  async llmReformulateQuery(query: string, weakSnippets: string[] = []): Promise<string | null> {
    if (!isNyvFeatureOn('ragLlmReformulate')) return null;
    const original = (query || '').trim();
    if (original.length < 3) return null;

    try {
      const { callJurexioSimple } = await import('../jrx-client.js');
      const context = weakSnippets
        .filter((s) => s && s.trim().length > 0)
        .slice(0, 3)
        .map((s, i) => `[${i + 1}] ${s.replace(/\s+/g, ' ').slice(0, 400)}`)
        .join('\n');

      const system =
        'You are a legal-research query reformulator for a multi-jurisdiction legal AI platform. ' +
        'Rewrite the user query into a single, precise search query that maximises retrieval of the ' +
        'most relevant statutes, sections, regulations, and precedents. Use canonical legal terminology, ' +
        'expand abbreviations, and name likely statutes/sections where applicable. ' +
        'Return ONLY the rewritten query on one line — no preamble, no quotes, no explanation.';
      const user =
        `Original query: ${original}\n\n` +
        (context ? `The first retrieval returned low-relevance snippets:\n${context}\n\n` : '') +
        'Rewrite into one improved legal search query:';

      const raw = await callJurexioSimple(system, user, 120);
      const reformulated = (raw || '')
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) || '';
      const cleaned = reformulated.replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 500);

      if (cleaned.length >= 3 && cleaned.toLowerCase() !== original.toLowerCase()) {
        cragLogger.info('crag: LLM reformulated query', {
          fromLen: original.length,
          toLen: cleaned.length,
        });
        return cleaned;
      }
      return null;
    } catch (err) {
      cragLogger.warn('crag: LLM reformulation failed, falling back to heuristic rewrite', {
        error: (err as Error)?.message,
      });
      return null;
    }
  }

  async generateQueryRewrites(query: string): Promise<QueryRewrite[]> {
    const rewrites: QueryRewrite[] = [];
    const strategies: Array<QueryRewrite['strategy']> = ['expansion', 'refinement', 'synonym', 'contextual'];

    for (const strategy of strategies) {
      const rewritten = this.QUERY_REWRITE_STRATEGIES[strategy](query);
      
      if (rewritten !== query) {
        rewrites.push({
          originalQuery: query,
          rewrittenQuery: rewritten,
          rewriteReason: `Applied ${strategy} strategy to improve retrieval`,
          confidence: 0.7,
          strategy
        });
      }
    }

    return rewrites;
  }

  private generateWebSearchQuery(query: string): string {
    const cleanQuery = query.replace(/[?!.,]/g, '').trim();
    return `${cleanQuery} latest information`;
  }

  async runCRAGPipeline(
    query: string,
    retrieveDocuments: (q: string) => Promise<Array<{ content: string; source: string; metadata?: Record<string, any> }>>,
    options: {
      webSearch?: (q: string) => Promise<Array<{ content: string; source: string }>>;
      config?: Partial<CRAGConfig>;
    } = {}
  ): Promise<CRAGPipeline> {
    const startTime = Date.now();
    const pipelineId = uuidv4();
    const pipelineConfig = { ...this.config, ...options.config };
    
    const pipeline: CRAGPipeline = {
      id: pipelineId,
      originalQuery: query,
      documents: [],
      rewrites: [],
      corrections: [],
      finalContext: '',
      confidenceScore: 0,
      iterations: 0,
      latencyMs: 0,
      success: false
    };

    let currentQuery = query;
    let iteration = 0;

    while (iteration < pipelineConfig.maxIterations) {
      iteration++;
      pipeline.iterations = iteration;

      const rawDocuments = await retrieveDocuments(currentQuery);
      const gradedDocuments = await this.gradeDocuments(currentQuery, rawDocuments);
      pipeline.documents = gradedDocuments;

      const decision = await this.decideCorrection(currentQuery, gradedDocuments);
      pipeline.corrections.push(decision);

      if (decision.action === 'use_as_is' || decision.action === 'combine_sources') {
        const usableDocs = gradedDocuments.filter(d => decision.documentsToUse.includes(d.id));
        pipeline.finalContext = this.buildContext(usableDocs);
        pipeline.confidenceScore = decision.confidence;
        pipeline.success = true;
        break;
      }

      if (decision.action === 'web_search' && options.webSearch && decision.suggestedQuery) {
        const webResults = await options.webSearch(decision.suggestedQuery);
        const webGraded = await this.gradeDocuments(query, webResults);
        
        const relevantWeb = webGraded.filter(d => d.grade === 'relevant' || d.grade === 'partially_relevant');
        if (relevantWeb.length > 0) {
          pipeline.documents = [...pipeline.documents, ...webGraded];
          pipeline.finalContext = this.buildContext(relevantWeb);
          pipeline.confidenceScore = Math.min(1, decision.confidence + 0.2);
          pipeline.success = true;
          break;
        }
      }

      if (decision.action === 'rewrite_query' && pipeline.rewrites.length < pipelineConfig.maxRewrites) {
        // NV-AGENTIC-RR-001 — prefer an LLM-driven reformulation (uses the weak
        // graded snippets as context); fall back to the deterministic heuristic
        // rewrites when the flag is off or the LLM call did not help.
        const llmRewrite = await this.llmReformulateQuery(
          currentQuery,
          gradedDocuments.slice(0, 3).map((d) => d.content),
        );
        if (llmRewrite) {
          pipeline.rewrites.push({
            originalQuery: currentQuery,
            rewrittenQuery: llmRewrite,
            rewriteReason: 'LLM-driven agentic reformulation (safety-ring routed)',
            confidence: 0.8,
            strategy: 'refinement',
          });
          currentQuery = llmRewrite;
          continue;
        }
        const rewrite = await this.generateQueryRewrites(currentQuery);
        if (rewrite.length > 0) {
          pipeline.rewrites.push(rewrite[0]);
          currentQuery = rewrite[0].rewrittenQuery;
          continue;
        }
      }

      if (decision.action === 'reject' || iteration >= pipelineConfig.maxIterations) {
        pipeline.finalContext = '';
        pipeline.confidenceScore = 0;
        pipeline.success = false;
        break;
      }
    }

    pipeline.latencyMs = Date.now() - startTime;
    this.pipelines.set(pipelineId, pipeline);
    
    return pipeline;
  }

  private buildContext(documents: GradedDocument[]): string {
    if (documents.length === 0) return '';

    const sorted = documents.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    const sections = sorted.map((doc, index) => {
      return `[Source ${index + 1}: ${doc.source}]\n${doc.content}`;
    });

    return sections.join('\n\n---\n\n');
  }

  async selfCorrect(
    query: string,
    generatedAnswer: string,
    context: string
  ): Promise<{
    corrected: boolean;
    issues: string[];
    correctedAnswer?: string;
    confidence: number;
  }> {
    const issues: string[] = [];

    if (generatedAnswer.length < 20) {
      issues.push('Answer is too short');
    }

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const answerLower = generatedAnswer.toLowerCase();
    const missingTerms = queryTerms.filter(t => !answerLower.includes(t));
    if (missingTerms.length > queryTerms.length * 0.5) {
      issues.push(`Answer may not address the query (missing: ${missingTerms.join(', ')})`);
    }

    const hedgingPatterns = /i think|probably|maybe|might|could be|not sure/i;
    if (hedgingPatterns.test(generatedAnswer)) {
      issues.push('Answer contains hedging language suggesting uncertainty');
    }

    const contextTerms = context.toLowerCase().split(/\s+/).filter(t => t.length > 4);
    const answerTerms = new Set(answerLower.split(/\s+/));
    const unsupportedClaims = Array.from(answerTerms).filter(t => 
      !contextTerms.includes(t) && t.length > 5
    );
    if (unsupportedClaims.length > 10) {
      issues.push('Answer may contain claims not supported by the context');
    }

    const confidence = Math.max(0, 1 - (issues.length * 0.25));

    return {
      corrected: issues.length > 0,
      issues,
      correctedAnswer: issues.length > 0 ? `[Needs review] ${generatedAnswer}` : undefined,
      confidence
    };
  }

  getPipeline(id: string): CRAGPipeline | undefined {
    return this.pipelines.get(id);
  }

  updateConfig(newConfig: Partial<CRAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getStats(): {
    totalPipelines: number;
    successRate: number;
    averageIterations: number;
    averageConfidence: number;
    rewriteUsage: number;
  } {
    const pipelines = Array.from(this.pipelines.values());
    const successful = pipelines.filter(p => p.success).length;
    const totalIterations = pipelines.reduce((sum, p) => sum + p.iterations, 0);
    const totalConfidence = pipelines.reduce((sum, p) => sum + p.confidenceScore, 0);
    const pipelinesWithRewrites = pipelines.filter(p => p.rewrites.length > 0).length;

    return {
      totalPipelines: pipelines.length,
      successRate: pipelines.length > 0 ? successful / pipelines.length : 0,
      averageIterations: pipelines.length > 0 ? totalIterations / pipelines.length : 0,
      averageConfidence: pipelines.length > 0 ? totalConfidence / pipelines.length : 0,
      rewriteUsage: pipelines.length > 0 ? pipelinesWithRewrites / pipelines.length : 0
    };
  }
}

export const correctiveRAGService = new CorrectiveRAGService();
export default correctiveRAGService;
