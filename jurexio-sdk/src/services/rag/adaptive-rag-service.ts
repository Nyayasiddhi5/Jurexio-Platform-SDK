// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Adaptive RAG Service with Query Router
 * 
 * Features:
 * - Intelligent query routing (vector/web/LLM/hybrid)
 * - Query complexity analysis
 * - Source selection optimization
 * - Retrieval strategy adaptation
 * - Multi-source fusion
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';

const logger = createLogger('adaptive-rag-service');

export type QueryType = 'factual' | 'analytical' | 'creative' | 'conversational' | 'procedural' | 'comparative';
export type RetrievalSource = 'vector_db' | 'web_search' | 'llm_knowledge' | 'document_store' | 'memory' | 'hybrid';
export type QueryComplexity = 'simple' | 'moderate' | 'complex' | 'expert';

export interface QueryAnalysis {
  queryId: string;
  originalQuery: string;
  queryType: QueryType;
  complexity: QueryComplexity;
  requiredSources: RetrievalSource[];
  estimatedTokens: number;
  keywords: string[];
  entities: string[];
  temporalContext?: 'past' | 'present' | 'future' | 'timeless';
  domainHints: string[];
  confidence: number;
}

export interface RetrievalPlan {
  planId: string;
  queryId: string;
  steps: RetrievalStep[];
  estimatedLatency: number;
  estimatedCost: number;
  fallbackStrategy: RetrievalSource;
}

export interface RetrievalStep {
  stepId: string;
  source: RetrievalSource;
  query: string;
  priority: number;
  maxResults: number;
  timeout: number;
  filters?: Record<string, any>;
}

export interface RetrievedDocument {
  id: string;
  source: RetrievalSource;
  content: string;
  metadata: Record<string, any>;
  relevanceScore: number;
  timestamp?: Date;
  url?: string;
  title?: string;
}

export interface RAGResult {
  queryId: string;
  analysis: QueryAnalysis;
  documents: RetrievedDocument[];
  fusedContext: string;
  sourcesUsed: RetrievalSource[];
  totalLatency: number;
  tokenCount: number;
  confidence: number;
}

export interface RouterConfig {
  vectorDbThreshold: number;
  webSearchThreshold: number;
  hybridThreshold: number;
  maxSources: number;
  maxDocumentsPerSource: number;
  timeoutMs: number;
}

class AdaptiveRAGService {
  // JRX-RAG-HEAP-CAP-001 (2026-04-30): cap unbounded request-driven Maps to prevent
  // the EC2 96% heap-pressure regression. Both maps were growing forever (one entry
  // per call), so heap usage scaled linearly with traffic until OOM.
  // Post-architect-review hardening: validate parsed env vars (raw Number() would
  // produce NaN for non-numeric strings, making `while (map.size >= cap)` false
  // forever and disabling eviction entirely — same class of bug as LMCache).
  private static readonly MAX_QUERY_HISTORY: number = (() => {
    const raw = process.env.JRX_RAG_MAX_HISTORY;
    if (raw === undefined || raw === '') return 500;
    const n = Number(raw);
    return (Number.isFinite(n) && n > 0 && Number.isInteger(n)) ? n : 500;
  })();
  private static readonly MAX_RETRIEVAL_PLANS: number = (() => {
    const raw = process.env.JRX_RAG_MAX_PLANS;
    if (raw === undefined || raw === '') return 500;
    const n = Number(raw);
    return (Number.isFinite(n) && n > 0 && Number.isInteger(n)) ? n : 500;
  })();

  private queryHistory: Map<string, QueryAnalysis> = new Map();
  private retrievalPlans: Map<string, RetrievalPlan> = new Map();
  private documentCache: Map<string, RetrievedDocument[]> = new Map();

  /** Insertion-order LRU eviction: Map preserves insertion order, so the first key
   *  is always the oldest. Drop one when at cap to make room for the new entry. */
  private evictIfFull<K, V>(map: Map<K, V>, cap: number): void {
    while (map.size >= cap) {
      const oldestKey = map.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }

  private config: RouterConfig = {
    vectorDbThreshold: 0.7,
    webSearchThreshold: 0.5,
    hybridThreshold: 0.6,
    maxSources: 3,
    maxDocumentsPerSource: 5,
    // NV-TIMEOUT-POLICY-001: 20s default (was 10s) — thin RAG → longer LLM fills
    timeoutMs: (() => {
      const n = Number(process.env.JRX_ADAPTIVE_RAG_TIMEOUT_MS);
      return Number.isFinite(n) && n >= 5_000 ? Math.min(60_000, Math.floor(n)) : 20_000;
    })(),
  };

  private readonly QUERY_TYPE_PATTERNS: Record<QueryType, RegExp[]> = {
    factual: [/what is/i, /who is/i, /when did/i, /where is/i, /how many/i, /define/i],
    analytical: [/why did/i, /how does/i, /explain/i, /analyze/i, /compare/i, /evaluate/i],
    creative: [/write/i, /create/i, /generate/i, /compose/i, /design/i, /imagine/i],
    conversational: [/tell me/i, /can you/i, /would you/i, /let's/i, /help me/i],
    procedural: [/how to/i, /steps to/i, /guide/i, /tutorial/i, /process/i, /instructions/i],
    comparative: [/difference between/i, /compare/i, /versus/i, /vs/i, /better/i, /which is/i]
  };

  private readonly SOURCE_ROUTING_RULES: Record<QueryType, RetrievalSource[]> = {
    factual: ['vector_db', 'web_search', 'llm_knowledge'],
    analytical: ['vector_db', 'document_store', 'llm_knowledge'],
    creative: ['llm_knowledge', 'memory'],
    conversational: ['memory', 'llm_knowledge'],
    procedural: ['document_store', 'vector_db', 'web_search'],
    comparative: ['vector_db', 'web_search', 'document_store']
  };

  async analyzeQuery(query: string, context?: Record<string, any>): Promise<QueryAnalysis> {
    const queryId = uuidv4();
    
    const queryType = this.detectQueryType(query);
    const complexity = this.assessComplexity(query);
    const keywords = this.extractKeywords(query);
    const entities = this.extractEntities(query);
    const temporalContext = this.detectTemporalContext(query);
    const domainHints = this.detectDomains(query);
    
    const requiredSources = this.determineRequiredSources(queryType, complexity, context);

    const analysis: QueryAnalysis = {
      queryId,
      originalQuery: query,
      queryType,
      complexity,
      requiredSources,
      estimatedTokens: Math.ceil(query.length / 4),
      keywords,
      entities,
      temporalContext,
      domainHints,
      confidence: this.calculateConfidence(queryType, keywords, entities)
    };

    this.evictIfFull(this.queryHistory, AdaptiveRAGService.MAX_QUERY_HISTORY);
    this.queryHistory.set(queryId, analysis);
    return analysis;
  }

  async createRetrievalPlan(analysis: QueryAnalysis): Promise<RetrievalPlan> {
    const planId = uuidv4();
    const steps: RetrievalStep[] = [];

    for (let i = 0; i < analysis.requiredSources.length; i++) {
      const source = analysis.requiredSources[i];
      
      const optimizedQuery = this.optimizeQueryForSource(analysis.originalQuery, source, analysis);
      
      steps.push({
        stepId: uuidv4(),
        source,
        query: optimizedQuery,
        priority: i + 1,
        maxResults: this.config.maxDocumentsPerSource,
        timeout: this.config.timeoutMs / analysis.requiredSources.length,
        filters: this.generateFilters(source, analysis)
      });
    }

    const plan: RetrievalPlan = {
      planId,
      queryId: analysis.queryId,
      steps,
      estimatedLatency: steps.length * 500,
      estimatedCost: this.estimateCost(steps),
      fallbackStrategy: 'llm_knowledge'
    };

    this.evictIfFull(this.retrievalPlans, AdaptiveRAGService.MAX_RETRIEVAL_PLANS);
    this.retrievalPlans.set(planId, plan);
    return plan;
  }

  async executeRetrieval(plan: RetrievalPlan): Promise<RAGResult> {
    const startTime = Date.now();
    const allDocuments: RetrievedDocument[] = [];
    const sourcesUsed: Set<RetrievalSource> = new Set();

    const analysis = this.queryHistory.get(plan.queryId);
    if (!analysis) {
      throw new Error(`Query analysis not found for ${plan.queryId}`);
    }

    for (const step of plan.steps) {
      try {
        const documents = await this.retrieveFromSource(step);
        allDocuments.push(...documents);
        sourcesUsed.add(step.source);
      } catch (error: any) {
        logger.warn(`Retrieval failed for source ${step.source}:`, error);
      }
    }

    if (allDocuments.length === 0 && plan.fallbackStrategy) {
      const fallbackDocs = await this.retrieveFromSource({
        stepId: uuidv4(),
        source: plan.fallbackStrategy,
        query: analysis.originalQuery,
        priority: 1,
        maxResults: this.config.maxDocumentsPerSource,
        timeout: this.config.timeoutMs
      });
      allDocuments.push(...fallbackDocs);
      sourcesUsed.add(plan.fallbackStrategy);
    }

    const rankedDocuments = this.rankDocuments(allDocuments, analysis);
    const topDocuments = rankedDocuments.slice(0, this.config.maxDocumentsPerSource * 2);
    const fusedContext = this.fuseDocuments(topDocuments, analysis);

    return {
      queryId: analysis.queryId,
      analysis,
      documents: topDocuments,
      fusedContext,
      sourcesUsed: Array.from(sourcesUsed),
      totalLatency: Date.now() - startTime,
      tokenCount: Math.ceil(fusedContext.length / 4),
      confidence: this.calculateResultConfidence(topDocuments)
    };
  }

  async adaptiveRetrieve(query: string, context?: Record<string, any>): Promise<RAGResult> {
    const analysis = await this.analyzeQuery(query, context);
    const plan = await this.createRetrievalPlan(analysis);
    return await this.executeRetrieval(plan);
  }

  private detectQueryType(query: string): QueryType {
    for (const [type, patterns] of Object.entries(this.QUERY_TYPE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return type as QueryType;
        }
      }
    }
    return 'conversational';
  }

  private assessComplexity(query: string): QueryComplexity {
    const wordCount = query.split(/\s+/).length;
    const hasMultipleClauses = /and|or|but|however|because|therefore/i.test(query);
    const hasNestedQuestions = (query.match(/\?/g) || []).length > 1;
    const hasTechnicalTerms = /algorithm|architecture|implementation|optimization|integration/i.test(query);

    let complexityScore = 0;
    if (wordCount > 20) complexityScore++;
    if (wordCount > 40) complexityScore++;
    if (hasMultipleClauses) complexityScore++;
    if (hasNestedQuestions) complexityScore++;
    if (hasTechnicalTerms) complexityScore++;

    if (complexityScore >= 4) return 'expert';
    if (complexityScore >= 3) return 'complex';
    if (complexityScore >= 1) return 'moderate';
    return 'simple';
  }

  private extractKeywords(query: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with',
      'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
      'while', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its', 'i', 'me', 'my']);
    
    return query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  private extractEntities(query: string): string[] {
    const entities: string[] = [];
    
    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const capitalizedMatches = query.match(capitalizedPattern) || [];
    entities.push(...capitalizedMatches);

    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    let match;
    while ((match = quotedPattern.exec(query)) !== null) {
      entities.push(match[1] || match[2]);
    }

    return Array.from(new Set(entities));
  }

  private detectTemporalContext(query: string): 'past' | 'present' | 'future' | 'timeless' {
    if (/was|were|did|had|ago|yesterday|last|previous|formerly/i.test(query)) return 'past';
    if (/will|going to|tomorrow|next|upcoming|future|soon/i.test(query)) return 'future';
    if (/is|are|currently|now|today|present/i.test(query)) return 'present';
    return 'timeless';
  }

  private detectDomains(query: string): string[] {
    const domainPatterns: Record<string, RegExp> = {
      technology: /software|hardware|code|programming|api|database|cloud|ai|ml|algorithm/i,
      business: /revenue|profit|market|customer|sales|strategy|company|startup/i,
      science: /research|experiment|hypothesis|data|analysis|study|scientific/i,
      legal: /law|legal|court|contract|regulation|compliance|attorney|lawsuit/i,
      medical: /health|medical|doctor|patient|treatment|diagnosis|symptom|disease/i,
      finance: /investment|stock|trading|banking|loan|mortgage|interest|portfolio/i,
      education: /learning|teaching|student|course|curriculum|education|school/i
    };

    const detectedDomains: string[] = [];
    for (const [domain, pattern] of Object.entries(domainPatterns)) {
      if (pattern.test(query)) {
        detectedDomains.push(domain);
      }
    }

    return detectedDomains;
  }

  private determineRequiredSources(
    queryType: QueryType,
    complexity: QueryComplexity,
    context?: Record<string, any>
  ): RetrievalSource[] {
    let sources = [...this.SOURCE_ROUTING_RULES[queryType]];

    if (complexity === 'expert' || complexity === 'complex') {
      if (!sources.includes('web_search')) {
        sources.push('web_search');
      }
    }

    if (context?.hasLocalDocuments) {
      sources.unshift('document_store');
    }

    if (context?.useMemory) {
      sources.unshift('memory');
    }

    return sources.slice(0, this.config.maxSources);
  }

  private optimizeQueryForSource(
    query: string,
    source: RetrievalSource,
    analysis: QueryAnalysis
  ): string {
    switch (source) {
      case 'vector_db':
        return analysis.keywords.join(' ') + ' ' + analysis.entities.join(' ');
      
      case 'web_search':
        const webQuery = query.replace(/\?/g, '').trim();
        if (analysis.temporalContext === 'present') {
          return webQuery + ' 2024 2025';
        }
        return webQuery;
      
      case 'document_store':
        return `"${analysis.keywords.slice(0, 3).join('" OR "')}"`;
      
      case 'memory':
        return analysis.entities.length > 0 
          ? analysis.entities.join(' ')
          : analysis.keywords.slice(0, 5).join(' ');
      
      default:
        return query;
    }
  }

  private generateFilters(source: RetrievalSource, analysis: QueryAnalysis): Record<string, any> {
    const filters: Record<string, any> = {};

    if (analysis.domainHints.length > 0) {
      filters.domains = analysis.domainHints;
    }

    if (analysis.temporalContext !== 'timeless') {
      const now = new Date();
      switch (analysis.temporalContext) {
        case 'past':
          filters.dateBefore = now;
          break;
        case 'present':
          filters.dateAfter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'future':
          filters.dateAfter = now;
          break;
      }
    }

    return filters;
  }

  private async retrieveFromSource(step: RetrievalStep): Promise<RetrievedDocument[]> {
    const cacheKey = `${step.source}:${step.query}`;
    if (this.documentCache.has(cacheKey)) {
      return this.documentCache.get(cacheKey)!;
    }

    const documents: RetrievedDocument[] = [];

    switch (step.source) {
      case 'vector_db':
        documents.push(...await this.vectorDBRetrieval(step.query, step.maxResults));
        break;
      
      case 'web_search':
        documents.push(...await this.webSearchRetrieval(step.query, step.maxResults));
        break;
      
      case 'document_store':
        documents.push(...await this.documentStoreRetrieval(step.query, step.maxResults));
        break;
      
      case 'memory':
        documents.push(...await this.memoryRetrieval(step.query, step.maxResults));
        break;
      
      case 'llm_knowledge':
        documents.push(...await this.llmKnowledgeRetrieval(step.query));
        break;
      
      case 'hybrid':
        const [vectorResults, webResults] = await Promise.all([
          this.vectorDBRetrieval(step.query, Math.ceil(step.maxResults / 2)),
          this.webSearchRetrieval(step.query, Math.floor(step.maxResults / 2)),
        ]);
        documents.push(...vectorResults, ...webResults);
        break;
    }

    this.documentCache.set(cacheKey, documents);
    setTimeout(() => this.documentCache.delete(cacheKey), 300000);

    return documents;
  }

  private async vectorDBRetrieval(query: string, maxResults: number): Promise<RetrievedDocument[]> {
    try {
      if (!db) throw new Error('DB not available');
      const { RAGService } = await import('./rag-service.js');
      const ragService = new RAGService();
      const results = await ragService.semanticSearch({
        query,
        userId: 'system',
        limit: maxResults,
        minSimilarity: 0.5,
      });
      if (results.length > 0) {
        logger.info(`[AdaptiveRAG] Vector DB returned ${results.length} results for: "${query.substring(0, 50)}"`);
        return results.map((r: any) => ({
          id: String(r.id ?? uuidv4()),
          source: 'vector_db' as RetrievalSource,
          content: r.text || r.content || '',
          metadata: { documentId: r.documentId, documentType: r.documentType, sourceFileName: r.sourceFileName, chunkIndex: r.chunkIndex, ...r.metadata },
          relevanceScore: r.similarity ?? 0.8,
        }));
      }
    } catch (err: any) {
      logger.debug(`[AdaptiveRAG] Vector DB fallback — ${err.message}`);
    }
    return this.fallbackRetrieval('vector_db', query, maxResults);
  }

  private async webSearchRetrieval(query: string, maxResults: number): Promise<RetrievedDocument[]> {
    try {
      // NV-LLM-001 (R3): wrap through safety ring.
      const { executeWithFullSafetyRing } = await import('../../orchestration/jrx-sdk-orchestration-wrapper.js');
      const response = await executeWithFullSafetyRing({
        id: uuidv4(),
        userId: 'system',
        prompt: `Search the web for: ${query}\n\nProvide factual, cited results.`,
        systemPrompt: 'You are a legal research assistant. Return concise, factual answers with citations.',
        maxTokens: 2048,
        temperature: 0.3,
        requirements: { complexity: 'moderate', domain: 'legal', priority: 'balanced', costBudget: 'low', responseTime: 'fast', qualityLevel: 'standard' },
      } as any, { sdkPlatform: 'rag-web', agentKey: 'auto', taskType: 'web_search', enableCitationVerification: true });
      if (response.content) {
        logger.info(`[AdaptiveRAG] Web search returned content for: "${query.substring(0, 50)}"`);
        return [{
          id: uuidv4(),
          source: 'web_search' as RetrievalSource,
          content: response.content,
          metadata: { searchEngine: response.provider || 'perplexity', model: response.model, isRealSearch: true },
          relevanceScore: 0.88,
        }];
      }
    } catch (err: any) {
      logger.debug(`[AdaptiveRAG] Web search fallback — ${err.message}`);
    }
    return this.fallbackRetrieval('web_search', query, maxResults);
  }

  private async documentStoreRetrieval(query: string, maxResults: number): Promise<RetrievedDocument[]> {
    try {
      if (!db) throw new Error('DB not available');
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      if (keywords.length === 0) throw new Error('No keywords');
      const likeClause = keywords.map(k => `text ILIKE '%${k.replace(/'/g, "''")}%'`).join(' OR ');
      const result = await db.execute(sql.raw(`
        SELECT id, text, document_type, source_file_name, chunk_index, metadata
        FROM nv_document_embeddings
        WHERE ${likeClause}
        ORDER BY created_at DESC
        LIMIT ${maxResults}
      `));
      const rows = (result.rows || result) as any[];
      if (rows.length > 0) {
        logger.info(`[AdaptiveRAG] Document store returned ${rows.length} results`);
        return rows.map((r: any, i: number) => ({
          id: String(r.id ?? uuidv4()),
          source: 'document_store' as RetrievalSource,
          content: r.content || r.text || '',
          metadata: { documentType: r.document_type, sourceFileName: r.source_file_name, chunkIndex: r.chunk_index },
          relevanceScore: 0.85 - (i * 0.05),
        }));
      }
    } catch (err: any) {
      logger.debug(`[AdaptiveRAG] Document store fallback — ${err.message}`);
    }
    return this.fallbackRetrieval('document_store', query, maxResults);
  }

  private async memoryRetrieval(query: string, maxResults: number): Promise<RetrievedDocument[]> {
    try {
      if (!db) throw new Error('DB not available');
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
      if (keywords.length === 0) throw new Error('No keywords');
      // value is JSONB — cast to text for ILIKE (plain `value ILIKE` throws on jsonb).
      const likeClause = keywords.map(k => `(key ILIKE '%${k.replace(/'/g, "''")}%' OR value::text ILIKE '%${k.replace(/'/g, "''")}%')`).join(' OR ');
      const result = await db.execute(sql.raw(`
        SELECT id, key, value, memory_type, importance, created_at
        FROM nv_schema.memory_entries
        WHERE ${likeClause}
        ORDER BY importance DESC, created_at DESC
        LIMIT ${maxResults}
      `));
      const rows = (result.rows || result) as any[];
      if (rows.length > 0) {
        logger.info(`[AdaptiveRAG] Memory returned ${rows.length} results`);
        return rows.map((r: any, i: number) => ({
          id: String(r.id ?? uuidv4()),
          source: 'memory' as RetrievalSource,
          content: `${r.key}: ${r.value}`,
          metadata: { memoryType: r.memory_type, importance: r.importance },
          relevanceScore: 0.88 - (i * 0.05),
          timestamp: r.created_at ? new Date(r.created_at) : new Date(),
        }));
      }
    } catch (err: any) {
      logger.debug(`[AdaptiveRAG] Memory retrieval fallback — ${err.message}`);
    }
    return this.fallbackRetrieval('memory', query, maxResults);
  }

  private async llmKnowledgeRetrieval(query: string): Promise<RetrievedDocument[]> {
    try {
      // NV-LLM-001 (R3): wrap through safety ring.
      const { executeWithFullSafetyRing } = await import('../../orchestration/jrx-sdk-orchestration-wrapper.js');
      const response = await executeWithFullSafetyRing({
        id: uuidv4(),
        userId: 'system',
        prompt: query,
        systemPrompt: 'You are a legal knowledge expert. Provide accurate, well-structured answers about Indian and international law. Cite relevant statutes and case law where applicable.',
        maxTokens: 2048,
        temperature: 0.4,
        requirements: { complexity: 'moderate', domain: 'legal', priority: 'balanced', costBudget: 'low', responseTime: 'fast', qualityLevel: 'professional' },
      } as any, { sdkPlatform: 'rag-llm', agentKey: 'auto', taskType: 'llm_knowledge', enableCitationVerification: true });
      if (response.content) {
        logger.info(`[AdaptiveRAG] LLM knowledge returned content via ${response.provider}/${response.model}`);
        return [{
          id: uuidv4(),
          source: 'llm_knowledge' as RetrievalSource,
          content: response.content,
          metadata: { type: 'llm_generated', model: response.model, provider: response.provider, isRealLLM: !response.content.includes('simulation') },
          relevanceScore: 0.82,
        }];
      }
    } catch (err: any) {
      logger.debug(`[AdaptiveRAG] LLM knowledge fallback — ${err.message}`);
    }
    return [{
      id: uuidv4(),
      source: 'llm_knowledge' as RetrievalSource,
      content: `Legal knowledge base response for: ${query}`,
      metadata: { type: 'llm_fallback' },
      relevanceScore: 0.6,
    }];
  }

  private fallbackRetrieval(source: RetrievalSource, query: string, maxResults: number): RetrievedDocument[] {
    const count = Math.min(maxResults, 2);
    return Array(count).fill(null).map((_, i) => ({
      id: uuidv4(),
      source,
      content: `[Fallback] ${source} result ${i + 1} for: ${query}`,
      metadata: { fallback: true, source },
      relevanceScore: 0.5 - (i * 0.05),
    }));
  }

  private rankDocuments(documents: RetrievedDocument[], analysis: QueryAnalysis): RetrievedDocument[] {
    return documents.sort((a, b) => {
      let scoreA = a.relevanceScore;
      let scoreB = b.relevanceScore;

      const sourceBoost: Record<RetrievalSource, number> = {
        'vector_db': 1.1,
        'document_store': 1.0,
        'web_search': 0.95,
        'memory': 1.05,
        'llm_knowledge': 0.9,
        'hybrid': 1.0
      };

      scoreA *= sourceBoost[a.source];
      scoreB *= sourceBoost[b.source];

      for (const keyword of analysis.keywords) {
        if (a.content.toLowerCase().includes(keyword)) scoreA += 0.05;
        if (b.content.toLowerCase().includes(keyword)) scoreB += 0.05;
      }

      return scoreB - scoreA;
    });
  }

  private fuseDocuments(documents: RetrievedDocument[], analysis: QueryAnalysis): string {
    if (documents.length === 0) {
      return '';
    }

    const sections: string[] = [];
    
    const bySource = new Map<RetrievalSource, RetrievedDocument[]>();
    for (const doc of documents) {
      if (!bySource.has(doc.source)) {
        bySource.set(doc.source, []);
      }
      bySource.get(doc.source)!.push(doc);
    }

    for (const [source, docs] of Array.from(bySource.entries())) {
      const sourceContent = (docs as RetrievedDocument[]).map((d: RetrievedDocument) => d.content).join('\n\n');
      sections.push(`[Source: ${source}]\n${sourceContent}`);
    }

    return sections.join('\n\n---\n\n');
  }

  private calculateConfidence(queryType: QueryType, keywords: string[], entities: string[]): number {
    let confidence = 0.5;
    
    if (keywords.length > 2) confidence += 0.1;
    if (keywords.length > 5) confidence += 0.1;
    if (entities.length > 0) confidence += 0.15;
    if (queryType !== 'conversational') confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  private calculateResultConfidence(documents: RetrievedDocument[]): number {
    if (documents.length === 0) return 0;
    
    const avgRelevance = documents.reduce((sum, d) => sum + d.relevanceScore, 0) / documents.length;
    const sourceCount = new Set(documents.map(d => d.source)).size;
    const sourceBonus = Math.min(sourceCount * 0.1, 0.3);
    
    return Math.min(avgRelevance + sourceBonus, 1.0);
  }

  private estimateCost(steps: RetrievalStep[]): number {
    let cost = 0;
    for (const step of steps) {
      switch (step.source) {
        case 'web_search': cost += 0.01; break;
        case 'vector_db': cost += 0.001; break;
        case 'llm_knowledge': cost += 0.005; break;
        default: cost += 0.0001;
      }
    }
    return cost;
  }

  updateConfig(newConfig: Partial<RouterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getStats(): {
    queriesAnalyzed: number;
    plansCreated: number;
    cachedDocuments: number;
    averageSourcesPerQuery: number;
  } {
    const analyses = Array.from(this.queryHistory.values());
    const avgSources = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + a.requiredSources.length, 0) / analyses.length
      : 0;

    return {
      queriesAnalyzed: this.queryHistory.size,
      plansCreated: this.retrievalPlans.size,
      cachedDocuments: this.documentCache.size,
      averageSourcesPerQuery: avgSources
    };
  }
}

export const adaptiveRAGService = new AdaptiveRAGService();
export default adaptiveRAGService;
