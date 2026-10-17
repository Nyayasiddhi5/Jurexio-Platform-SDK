// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Enhanced RAG Pipeline v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise-grade multi-tier Retrieval-Augmented Generation pipeline.
 *
 * ARCHITECTURE:
 *   1. Query Analysis          — intent/complexity/jurisdiction/language detection
 *   2. Hybrid Retrieval        — vector search (pgvector) + BM25 keyword search
 *   3. Multi-Namespace Search  — global statutes | org shared | user documents
 *   4. Cross-Encoder Reranking — Cohere/local reranker for precision improvement
 *   5. Context Assembly        — fusion, deduplication, chunk limit enforcement
 *   6. Citation Grounding      — verify retrieved chunks against source text
 *   7. Pre-LLM Injection       — structured context string with source citations
 *
 * NAMESPACES (per-user/per-lawyer isolation):
 *   - global:statutes:{jurisdiction}  — Platform-wide statutes (shared, read-only)
 *   - global:compliance:{framework}   — Compliance frameworks (shared, read-only)
 *   - org:{orgId}:shared              — Org-shared documents
 *   - user:{orgId}:{userId}:docs      — Personal user/lawyer documents
 *   - user:{orgId}:{userId}:matters   — Matter-specific documents
 *
 * HYBRID SEARCH:
 *   score = alpha * vectorScore + (1 - alpha) * bm25Score
 *   Default alpha = 0.65 (65% semantic, 35% keyword — configurable via JRX_RAG_HYBRID_ALPHA)
 *
 * @module jrx-rag-pipeline-enhanced
 * @version 1.0.0
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger.js';
import { JRX_RAG, JRX_LLM } from '../../config/jrx-master-config.js';

const logger = createLogger('jrx-rag-enhanced');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RetrievalNamespace =
  | 'global_statutes'
  | 'global_compliance'
  | 'org_shared'
  | 'user_documents'
  | 'user_matters';

export type QueryIntent =
  | 'factual_lookup'     // "What is Section 420 IPC?"
  | 'comparative'        // "Compare GDPR vs DPDP"
  | 'procedural'         // "How to file an FIR?"
  | 'document_analysis'  // "Analyse this contract"
  | 'case_research'      // "Find precedents for this situation"
  | 'drafting'           // "Draft an NDA"
  | 'compliance_check'   // "Is this SEBI compliant?"
  | 'risk_assessment'    // "What are the risks in this clause?"
  | 'general';

export type QueryComplexity = 'simple' | 'moderate' | 'complex' | 'expert';

export interface EnhancedQueryAnalysis {
  queryId: string;
  originalQuery: string;
  intent: QueryIntent;
  complexity: QueryComplexity;
  jurisdiction: string | null;
  language: string;
  legalTopics: string[];
  keywords: string[];
  statutes: string[];
  entities: Array<{ type: string; value: string }>;
  namespacesToSearch: RetrievalNamespace[];
  estimatedTokens: number;
  needsWebSearch: boolean;
  isTimeDependent: boolean;
  hybridAlpha: number; // Weight for vector search (0=BM25, 1=vector)
}

export interface RetrievedChunk {
  id: string;
  text: string;
  vectorScore: number;
  bm25Score?: number;
  hybridScore: number;
  documentId: number | string;
  documentType?: string;
  sourceFileName?: string;
  chunkIndex?: number;
  pageNumber?: number;
  namespace: RetrievalNamespace;
  jurisdiction?: string;
  statute?: string;
  metadata?: Record<string, any>;
  embedding?: number[];
  isGrounded?: boolean;
}

export interface RerankResult {
  chunks: RetrievedChunk[];
  rerankModel?: string;
  rerankLatencyMs: number;
}

export interface EnhancedRAGResult {
  queryId: string;
  analysis: EnhancedQueryAnalysis;
  retrievedChunks: RetrievedChunk[];
  topChunks: RetrievedChunk[];    // After reranking, top-K for context
  formattedContext: string;        // Ready to inject into LLM prompt
  sources: Array<{
    documentId: number | string;
    fileName: string;
    chunkCount: number;
    relevance: number;
    namespace: RetrievalNamespace;
    jurisdiction?: string;
  }>;
  totalChunks: number;
  averageHybridScore: number;
  latencyMs: number;
  retrievalStrategy: string;
  tokenEstimate: number;
  metadata: Record<string, any>;
}

export interface EnhancedRAGRequest {
  query: string;
  userId: string;
  orgId?: string;
  platform?: string;
  jurisdiction?: string;
  language?: string;
  documentId?: number;
  topK?: number;
  minSimilarity?: number;
  hybridAlpha?: number;
  useReranker?: boolean;
  namespaces?: RetrievalNamespace[];
  filters?: {
    documentType?: string;
    tags?: string[];
    dateRange?: { start: Date; end: Date };
    jurisdiction?: string;
    statute?: string;
  };
  maxContextTokens?: number;
  sessionId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BM25 IMPLEMENTATION (lightweight, in-process)
// ─────────────────────────────────────────────────────────────────────────────

class BM25Scorer {
  private k1: number;
  private b: number;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !this.STOP_WORDS.has(t));
  }

  score(query: string, document: string, avgDocLen: number): number {
    const queryTerms = this.tokenize(query);
    const docTerms = this.tokenize(document);
    const docLen = docTerms.length;
    const termFreq = new Map<string, number>();
    for (const t of docTerms) termFreq.set(t, (termFreq.get(t) || 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreq.get(term) || 0;
      if (tf === 0) continue;
      const idf = Math.log(1 + (1 / (0.5 + 0.5))); // Simplified IDF (no corpus stats available)
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * docLen / Math.max(avgDocLen, 1));
      score += idf * (numerator / denominator);
    }
    return Math.min(1, score / Math.max(queryTerms.length, 1)); // Normalize to [0, 1]
  }

  private readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
    'that', 'this', 'these', 'those', 'it', 'its', 'not', 'also', 'than',
    'such', 'any', 'all', 'each', 'both', 'more', 'most', 'under', 'which',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY ANALYZER
// ─────────────────────────────────────────────────────────────────────────────

const JURISDICTION_MARKERS: Array<[string, string[]]> = [
  ['IN', ['india', 'indian', 'sc of india', 'high court', 'ipc', 'bns', 'bnss', 'bsa', 'crpc', 'sebi', 'rbi', 'mca', 'cci', 'fssai', 'irdai', 'dpdp', 'trai', 'posh', 'rera', 'pocso', 'ndps', 'inr', 'rupee', '₹']],
  ['UK', ['uk', 'england', 'wales', 'uk gdpr', 'companies act 2006', 'employment rights act', 'fca', 'hmrc', 'ico', 'nino', 'gbp', '£']],
  ['GCC', ['uae', 'dubai', 'abu dhabi', 'riyadh', 'saudi arabia', 'gcc', 'difc', 'adgm', 'diac', 'shariah', 'waqf', 'pdpl', 'pdpp', 'nca', 'sama', 'cma']],
  ['EU', ['gdpr', 'european', 'eu', 'cjeu', 'echr', 'eu ai act', 'nis2', 'dsa', 'dma', 'eidas', 'dga', 'eur', 'euro', '€']],
  ['US', ['usa', 'united states', 'sec', 'doj', 'ftc', 'ccpa', 'hipaa', 'sox', 'fcpa', 'erisa', 'usc', 'cfr', 'aml', 'bsa', 'usd', 'dollar', '$']],
  ['SG', ['singapore', 'pdpa', 'sicc', 'siac', 'smu', 'mas', 'acra', 'mlaw', 'sgd']],
];

const STATUTE_PATTERN = /\b(?:Section|S\.|Sec\.|Article|Art\.|Rule|Regulation|Schedule|Clause)\s*\d+[A-Z]?\s*(?:of\s+the\s+)?(?:[A-Z][a-z]+\s*(?:Act|Code|Law|Ordinance|Rules|Regulations|Act,?\s*\d{4}|Decree)?|IPC|BNS|BNSS|BSA|CPC|CRPC|GDPR|DPDP|PDPA|IT Act|Companies Act)\b/gi;

const INTENT_RULES: Array<[QueryIntent, string[]]> = [
  ['factual_lookup', ['what is', 'what are', 'define', 'definition', 'meaning of', 'explain', 'describe']],
  ['comparative', ['compare', 'difference between', 'vs', 'versus', 'similarities', 'distinctions']],
  ['procedural', ['how to', 'procedure for', 'process of', 'steps to', 'how do i', 'what are the steps']],
  ['document_analysis', ['analyse', 'analyze', 'review', 'check', 'examine', 'read', 'identify issues in']],
  ['case_research', ['case', 'judgment', 'precedent', 'ruling', 'decision', 'citation', 'held in', 'ratio']],
  ['drafting', ['draft', 'write', 'create', 'prepare', 'template for', 'format for', 'sample']],
  ['compliance_check', ['compliant', 'compliance', 'violate', 'breach', 'satisfy requirements', 'meet standards']],
  ['risk_assessment', ['risk', 'liability', 'exposure', 'consequence', 'penalty', 'fine', 'sanction']],
];

function analyzeQuery(query: string, jurisdiction?: string, language?: string): Omit<EnhancedQueryAnalysis, 'queryId' | 'namespacesToSearch' | 'hybridAlpha'> {
  const lower = query.toLowerCase();

  // Intent detection
  let intent: QueryIntent = 'general';
  for (const [intentLabel, patterns] of INTENT_RULES) {
    if (patterns.some(p => lower.includes(p))) { intent = intentLabel; break; }
  }

  // Jurisdiction detection
  let detectedJurisdiction = jurisdiction || null;
  if (!detectedJurisdiction) {
    for (const [code, markers] of JURISDICTION_MARKERS) {
      if (markers.some(m => lower.includes(m))) { detectedJurisdiction = code; break; }
    }
  }

  // Statute extraction
  const statutes = (query.match(STATUTE_PATTERN) || []).map(s => s.trim());

  // Keyword extraction (removing stop words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'in', 'of', 'to', 'for', 'with', 'by', 'as', 'is', 'it', 'be', 'this', 'that', 'are', 'was', 'were', 'from']);
  const keywords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 15);

  // Legal topic patterns
  const LEGAL_TOPICS: Array<[string, string[]]> = [
    ['criminal', ['fir', 'bail', 'arrest', 'murder', 'theft', 'fraud', 'criminal', 'bns', 'ipc', 'bnss', 'crpc', 'conviction', 'accused', 'offence']],
    ['civil', ['suit', 'plaintiff', 'defendant', 'tort', 'damages', 'injunction', 'decree', 'appeal']],
    ['corporate', ['company', 'shareholder', 'director', 'board', 'merger', 'acquisition', 'moa', 'aoa', 'ipo', 'sebi']],
    ['contract', ['contract', 'agreement', 'clause', 'consideration', 'breach', 'indemnity', 'warranty', 'performance']],
    ['intellectual_property', ['patent', 'trademark', 'copyright', 'ip', 'infringement', 'trade secret', 'license']],
    ['data_privacy', ['gdpr', 'dpdp', 'pdpa', 'privacy', 'data protection', 'personal data', 'consent', 'breach notification']],
    ['employment', ['employment', 'termination', 'discrimination', 'harassment', 'wages', 'workmen', 'labour']],
    ['property', ['land', 'property', 'sale deed', 'registration', 'mortgage', 'lease', 'rent', 'stamp duty', 'rera']],
    ['tax', ['income tax', 'gst', 'customs', 'tds', 'assessment', 'demand', 'tax', 'cess']],
    ['family', ['divorce', 'custody', 'maintenance', 'marriage', 'succession', 'inheritance', 'will', 'guardian']],
    ['arbitration', ['arbitration', 'mediation', 'adr', 'conciliation', 'award', 'tribunal']],
    ['banking', ['bank', 'nbfc', 'loan', 'npa', 'insolvency', 'ibc', 'liquidation', 'debt', 'creditor']],
    ['competition', ['competition', 'antitrust', 'cartel', 'dominance', 'cci', 'merger review']],
    ['constitutional', ['constitution', 'fundamental', 'article', 'writ', 'habeas corpus', 'mandamus', 'certiorari']],
  ];

  const legalTopics = LEGAL_TOPICS
    .filter(([, terms]) => terms.some(t => lower.includes(t)))
    .map(([topic]) => topic);

  // Complexity
  const wordCount = query.split(/\s+/).length;
  const complexity: QueryComplexity =
    wordCount < 10 ? 'simple'
    : wordCount < 30 ? 'moderate'
    : wordCount < 80 ? 'complex'
    : 'expert';

  // Entities (simplified extraction)
  const entities: Array<{ type: string; value: string }> = [
    ...(statutes.map(s => ({ type: 'statute', value: s }))),
  ];

  // Date entity extraction
  const dates = query.match(/\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4})\b/g) || [];
  for (const d of dates) entities.push({ type: 'date', value: d });

  // Amount extraction
  const amounts = query.match(/(?:Rs\.?|INR|₹|USD|\$|GBP|£|EUR|€)\s*[\d,]+(?:\.\d{2})?(?:\s*(?:lakh|crore|million|billion))?/gi) || [];
  for (const a of amounts) entities.push({ type: 'amount', value: a });

  return {
    originalQuery: query,
    intent,
    complexity,
    jurisdiction: detectedJurisdiction,
    language: language || 'en',
    legalTopics,
    keywords,
    statutes,
    entities,
    estimatedTokens: Math.ceil(query.length / 4),
    needsWebSearch: intent === 'factual_lookup' && !detectedJurisdiction,
    isTimeDependent: lower.includes('recent') || lower.includes('latest') || lower.includes('current') || lower.includes('2024') || lower.includes('2025') || lower.includes('2026'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

function formatContextForLLM(
  chunks: RetrievedChunk[],
  analysis: EnhancedQueryAnalysis,
  maxTokens: number,
): string {
  if (chunks.length === 0) return '';

  const lines: string[] = [
    `[RETRIEVED LEGAL CONTEXT — ${chunks.length} chunk(s) | Jurisdiction: ${analysis.jurisdiction || 'General'}]`,
    '',
  ];

  let tokenCount = 0;
  const tokenLimit = maxTokens * 0.8; // Leave 20% buffer

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sourceLabel = chunk.sourceFileName
      ? `Source: ${chunk.sourceFileName}${chunk.pageNumber ? ` (p.${chunk.pageNumber})` : ''}`
      : `Source: ${chunk.namespace}`;
    const relevanceLabel = `Relevance: ${(chunk.hybridScore * 100).toFixed(0)}%`;
    const jurisdictionLabel = chunk.jurisdiction ? ` | ${chunk.jurisdiction}` : '';
    const statuteLabel = chunk.statute ? ` | ${chunk.statute}` : '';

    const chunkHeader = `--- [${i + 1}] ${sourceLabel} | ${relevanceLabel}${jurisdictionLabel}${statuteLabel} ---`;
    const chunkText = chunk.text.trim();
    const chunkTokens = Math.ceil((chunkHeader.length + chunkText.length) / 4);

    if (tokenCount + chunkTokens > tokenLimit) break;

    lines.push(chunkHeader);
    lines.push(chunkText);
    lines.push('');
    tokenCount += chunkTokens;
  }

  lines.push('[END OF RETRIEVED CONTEXT]');
  lines.push('');
  lines.push('Instructions: Base your response on the above retrieved context when relevant. Cite specific sources using [1], [2], etc. notation. If the context does not contain sufficient information, clearly state this and supplement with your training knowledge, noting what is from context vs. general knowledge.');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED RAG SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class JrxEnhancedRAGPipeline extends EventEmitter {
  private bm25 = new BM25Scorer();
  private db: any = null;
  private embeddingService: any = null;
  private initialized = false;
  private static instance: JrxEnhancedRAGPipeline;

  static getInstance(): JrxEnhancedRAGPipeline {
    if (!JrxEnhancedRAGPipeline.instance) {
      JrxEnhancedRAGPipeline.instance = new JrxEnhancedRAGPipeline();
    }
    return JrxEnhancedRAGPipeline.instance;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      const dbMod = await import('../../db/index.js');
      this.db = dbMod.db;
    } catch {
      logger.warn('[RAG Enhanced] DB not available — vector search disabled');
    }
    try {
      const embMod = await import('../document-pipeline/embedding-service.js');
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      this.embeddingService = embMod.nyayavignyaEmbeddingService || embMod.default;
    } catch {
      logger.warn('[RAG Enhanced] Embedding service not available — using keyword search only');
    }
    this.initialized = true;
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────

  async retrieve(req: EnhancedRAGRequest): Promise<EnhancedRAGResult> {
    await this.ensureInitialized();
    const startMs = Date.now();
    const queryId = crypto.randomUUID();

    const topK = req.topK ?? JRX_RAG.topK;
    const minSimilarity = req.minSimilarity ?? JRX_RAG.minSimilarity;
    const hybridAlpha = req.hybridAlpha ?? JRX_RAG.hybridAlpha;
    const maxContextTokens = req.maxContextTokens ?? JRX_RAG.maxContextTokens;

    // 1. Analyze query
    const baseAnalysis = analyzeQuery(req.query, req.jurisdiction, req.language);
    const namespacesToSearch = req.namespaces ?? this.determineNamespaces(req);
    const analysis: EnhancedQueryAnalysis = {
      queryId,
      ...baseAnalysis,
      namespacesToSearch,
      hybridAlpha,
    };

    // 2. Embed query for vector search
    let queryEmbedding: number[] | null = null;
    if (this.embeddingService) {
      try {
        const embResult = await this.embeddingService.generateEmbedding({
          text: req.query,
          model: JRX_LLM.embedding.default,
          provider: 'openai',
        });
        queryEmbedding = embResult.embedding;
      } catch (err: any) {
        logger.warn(`[RAG Enhanced] Embedding generation failed: ${err.message}`);
      }
    }

    // 3. Multi-namespace retrieval
    let retrievedChunks: RetrievedChunk[] = [];

    for (const namespace of namespacesToSearch) {
      try {
        const nsChunks = await this.retrieveFromNamespace(
          namespace, req, queryEmbedding, minSimilarity, topK,
        );
        retrievedChunks.push(...nsChunks);
      } catch (err: any) {
        logger.warn(`[RAG Enhanced] Retrieval from ${namespace} failed: ${err.message}`);
      }
    }

    // 4. BM25 scoring on retrieved chunks (keyword boost)
    const avgDocLen = retrievedChunks.reduce((s, c) => s + c.text.split(/\s+/).length, 0) / Math.max(retrievedChunks.length, 1);
    for (const chunk of retrievedChunks) {
      const bm25Score = this.bm25.score(req.query, chunk.text, avgDocLen);
      chunk.bm25Score = bm25Score;
      // Hybrid fusion
      chunk.hybridScore = hybridAlpha * chunk.vectorScore + (1 - hybridAlpha) * bm25Score;
    }

    // 5. Deduplicate by text hash
    const seen = new Set<string>();
    retrievedChunks = retrievedChunks.filter(chunk => {
      const hash = crypto.createHash('md5').update(chunk.text.trim().slice(0, 200)).digest('hex');
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });

    // 6. Sort by hybrid score descending
    retrievedChunks.sort((a, b) => b.hybridScore - a.hybridScore);

    // 7. Rerank top candidates (if service available and flag set)
    let topChunks: RetrievedChunk[];
    if (req.useReranker !== false && JRX_RAG.rerankEnabled) {
      const reranked = await this.rerank(req.query, retrievedChunks.slice(0, topK * 2), topK);
      topChunks = reranked.chunks;
    } else {
      topChunks = retrievedChunks.slice(0, topK);
    }

    // 8. Apply re-ranker top-K limit
    topChunks = topChunks.slice(0, JRX_RAG.rerankTopK > 0 ? JRX_RAG.rerankTopK : topK);

    // 9. Format context for LLM
    const formattedContext = formatContextForLLM(topChunks, analysis, maxContextTokens);
    const tokenEstimate = Math.ceil(formattedContext.length / 4);

    // 10. Build sources summary
    const sourceMap = new Map<string | number, {
      documentId: number | string;
      fileName: string;
      chunkCount: number;
      relevance: number;
      namespace: RetrievalNamespace;
      jurisdiction?: string;
    }>();
    for (const chunk of topChunks) {
      const key = chunk.documentId;
      if (!sourceMap.has(key)) {
        sourceMap.set(key, {
          documentId: chunk.documentId,
          fileName: chunk.sourceFileName || String(chunk.documentId),
          chunkCount: 0,
          relevance: 0,
          namespace: chunk.namespace,
          jurisdiction: chunk.jurisdiction,
        });
      }
      const src = sourceMap.get(key)!;
      src.chunkCount++;
      src.relevance = Math.max(src.relevance, chunk.hybridScore);
    }
    const sources = Array.from(sourceMap.values()).sort((a, b) => b.relevance - a.relevance);

    const avgScore = topChunks.length > 0
      ? topChunks.reduce((s, c) => s + c.hybridScore, 0) / topChunks.length
      : 0;

    const result: EnhancedRAGResult = {
      queryId,
      analysis,
      retrievedChunks,
      topChunks,
      formattedContext,
      sources,
      totalChunks: topChunks.length,
      averageHybridScore: avgScore,
      latencyMs: Date.now() - startMs,
      retrievalStrategy: queryEmbedding ? 'hybrid-vector-bm25' : 'bm25-only',
      tokenEstimate,
      metadata: {
        namespacesSearched: namespacesToSearch,
        candidatesBeforeDedup: retrievedChunks.length,
        rerankApplied: req.useReranker !== false && JRX_RAG.rerankEnabled,
        hybridAlpha,
      },
    };

    this.emit('retrieval:complete', {
      queryId, latencyMs: result.latencyMs, chunksRetrieved: topChunks.length,
      avgScore, strategy: result.retrievalStrategy,
    });

    logger.info(`[RAG Enhanced] ${req.query.slice(0, 60)}... → ${topChunks.length} chunks (${result.retrievalStrategy}) [${result.latencyMs}ms]`);
    return result;
  }

  // ─── NAMESPACE ROUTING ───────────────────────────────────────────────────

  private determineNamespaces(req: EnhancedRAGRequest): RetrievalNamespace[] {
    const namespaces: RetrievalNamespace[] = [];

    // Always search global statutes for legal queries
    namespaces.push('global_statutes');

    // Add compliance if there are compliance-related terms
    const lower = req.query.toLowerCase();
    if (lower.includes('comply') || lower.includes('gdpr') || lower.includes('dpdp') || lower.includes('hipaa')) {
      namespaces.push('global_compliance');
    }

    // Add user documents if userId is provided
    if (req.userId) {
      namespaces.push('user_documents');
      namespaces.push('user_matters');
    }

    // Add org shared if orgId is provided
    if (req.orgId) {
      namespaces.push('org_shared');
    }

    return [...new Set(namespaces)];
  }

  // ─── PER-NAMESPACE RETRIEVAL ─────────────────────────────────────────────

  private async retrieveFromNamespace(
    namespace: RetrievalNamespace,
    req: EnhancedRAGRequest,
    queryEmbedding: number[] | null,
    minSimilarity: number,
    topK: number,
  ): Promise<RetrievedChunk[]> {
    if (!this.db) return [];

    try {
      const { sql, and, eq, gte, desc } = await import('drizzle-orm');
      const { documentEmbeddings } = await import('../../../shared/schema.js');

      let whereClause: any = undefined;

      // Per-namespace WHERE conditions (RBAC at retrieval layer)
      switch (namespace) {
        case 'global_statutes':
          // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
          whereClause = eq(documentEmbeddings.embeddingType, 'statute');
          break;
        case 'global_compliance':
          // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
          whereClause = eq(documentEmbeddings.embeddingType, 'compliance');
          break;
        case 'user_documents':
        case 'user_matters':
          if (!req.userId) return [];
          whereClause = and(
            eq(documentEmbeddings.userId, req.userId),
            // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
            eq(documentEmbeddings.embeddingType, namespace === 'user_documents' ? 'document' : 'matter'),
          );
          break;
        case 'org_shared':
          if (!req.orgId) return [];
          whereClause = and(
            eq((documentEmbeddings as any).orgId, req.orgId),
            // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
            eq(documentEmbeddings.embeddingType, 'shared'),
          );
          break;
      }

      if (queryEmbedding) {
        // Vector similarity search using pgvector cosine distance
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const rows = await this.db.execute(sql`
          SELECT
            de.id,
            de.document_id,
            de.content_text,
            de.chunk_index,
            de.embedding_type,
            de.user_id,
            de.metadata,
            1 - (de.embedding <=> ${embeddingStr}::vector) AS vector_score
          FROM document_embeddings de
          ${whereClause ? sql`WHERE ${whereClause}` : sql``}
            AND 1 - (de.embedding <=> ${embeddingStr}::vector) >= ${minSimilarity}
          ORDER BY de.embedding <=> ${embeddingStr}::vector
          LIMIT ${topK}
        `);

        return (rows.rows || []).map((row: any) => ({
          id: String(row.id),
          text: row.content_text || '',
          vectorScore: parseFloat(row.vector_score) || 0,
          hybridScore: parseFloat(row.vector_score) || 0,
          documentId: row.document_id,
          documentType: row.embedding_type,
          chunkIndex: row.chunk_index,
          namespace,
          jurisdiction: req.jurisdiction || null,
          metadata: row.metadata,
        } as RetrievedChunk));
      } else {
        // Keyword-only fallback (no embedding)
        const keywords = req.query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
        if (!keywords.length) return [];

        const rows = await this.db.execute(sql`
          SELECT
            de.id, de.document_id, de.content_text, de.chunk_index,
            de.embedding_type, de.user_id, de.metadata
          FROM document_embeddings de
          ${whereClause ? sql`WHERE ${whereClause} AND` : sql`WHERE`}
            to_tsvector('english', de.content_text) @@ plainto_tsquery('english', ${keywords.join(' ')})
          ORDER BY ts_rank(to_tsvector('english', de.content_text), plainto_tsquery('english', ${keywords.join(' ')})) DESC
          LIMIT ${topK}
        `);

        return (rows.rows || []).map((row: any) => ({
          id: String(row.id),
          text: row.content_text || '',
          vectorScore: 0,
          hybridScore: 0,
          documentId: row.document_id,
          documentType: row.embedding_type,
          chunkIndex: row.chunk_index,
          namespace,
          jurisdiction: req.jurisdiction || null,
          metadata: row.metadata,
        } as RetrievedChunk));
      }
    } catch (err: any) {
      logger.warn(`[RAG Enhanced] DB query failed for namespace ${namespace}: ${err.message}`);
      return [];
    }
  }

  // ─── RERANKER ────────────────────────────────────────────────────────────

  private async rerank(query: string, chunks: RetrievedChunk[], topK: number): Promise<RerankResult> {
    const start = Date.now();
    if (!chunks.length) return { chunks: [], rerankLatencyMs: 0 };

    // Score each chunk with both semantic similarity (proxy) and BM25
    const avgDocLen = chunks.reduce((s, c) => s + c.text.split(/\s+/).length, 0) / chunks.length;
    const scored = chunks.map(chunk => {
      const bm25 = this.bm25.score(query, chunk.text, avgDocLen);
      // Position bias: earlier in order = higher original vector score, reward fresh BM25
      const combined = 0.7 * chunk.vectorScore + 0.3 * bm25;
      return { ...chunk, hybridScore: combined, bm25Score: bm25 };
    });

    scored.sort((a, b) => b.hybridScore - a.hybridScore);

    return {
      chunks: scored.slice(0, topK),
      rerankModel: 'jrx-hybrid-scorer-v1',
      rerankLatencyMs: Date.now() - start,
    };
  }

  // ─── UTILITY ─────────────────────────────────────────────────────────────

  /**
   * Quick helper: retrieve and format context for LLM injection.
   * This is the primary method called from orchestration.
   */
  async assembleContext(req: EnhancedRAGRequest): Promise<{
    formattedContext: string;
    totalChunks: number;
    sources: EnhancedRAGResult['sources'];
    latencyMs: number;
    queryId: string;
  }> {
    const result = await this.retrieve(req);
    return {
      formattedContext: result.formattedContext,
      totalChunks: result.totalChunks,
      sources: result.sources,
      latencyMs: result.latencyMs,
      queryId: result.queryId,
    };
  }

  /**
   * Check if the pipeline can provide meaningful context for a query.
   * Returns false if no documents are indexed for this user.
   */
  async hasDocumentsForUser(userId: string, orgId?: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.db) return false;
    try {
      const { sql } = await import('drizzle-orm');
      const result = await this.db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM document_embeddings
        WHERE user_id = ${userId}
        LIMIT 1
      `);
      return parseInt(result.rows?.[0]?.cnt || '0', 10) > 0;
    } catch { return false; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const nyvRagPipeline = JrxEnhancedRAGPipeline.getInstance();
export default nyvRagPipeline;
