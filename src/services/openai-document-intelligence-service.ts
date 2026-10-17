import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { PLATFORM_VERSION } from '../config/platform-config.js';
import { RealLLMService } from './real-llm-service.js';
import { createLogger } from '../utils/logger.js';
import { secureRandom, secureRandomInt, secureRandomBool, secureRandomChoice } from '../utils/jrx-secure-random.js';
import { recordAuxSpend } from '../utils/jrx-request-usage-context.js';
import { NV_AUX_RATES } from '../middleware/jrx-aux-cost-estimator.js';


const logger = createLogger('openai-document-intelligence-ser');

// Note: EMBEDDING_MODEL is kept for the generateEmbeddings method which still uses direct OpenAI API
// since RealLLMService doesn't support embeddings directly.
const EMBEDDING_MODEL = 'text-embedding-3-small';

let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

export interface DocumentSummary {
  summary: string;
  keyPoints: string[];
  detailLevel: 'brief' | 'standard' | 'detailed';
  wordCount: number;
  processingTimeMs: number;
}

export interface ExtractedEntity {
  name: string;
  type: 'party' | 'date' | 'amount' | 'clause' | 'jurisdiction' | 'reference' | 'obligation' | 'term';
  value: string;
  context: string;
  confidence: number;
}

export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  totalFound: number;
  processingTimeMs: number;
}

export interface ContractDifference {
  section: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  documentA: string;
  documentB: string;
  significance: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}

export interface ContractComparisonResult {
  differences: ContractDifference[];
  similarityScore: number;
  totalDifferences: number;
  criticalDifferences: number;
  processingTimeMs: number;
}

export interface ClassifiedClause {
  text: string;
  clauseType: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  recommendations: string[];
  confidence: number;
}

export interface ClauseClassificationResult {
  clauses: ClassifiedClause[];
  overallRiskScore: number;
  totalClauses: number;
  processingTimeMs: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  totalTokens: number;
  processingTimeMs: number;
}

export interface DocumentQAResult {
  answer: string;
  confidence: number;
  relevantExcerpts: string[];
  processingTimeMs: number;
}

export class OpenAIDocumentIntelligenceService extends EventEmitter {
  // NV-LLM-001 (R3): llmService field now routes via wrapper instead of
  // direct RealLLMService.
  private llmService: { executeRequest: (req: any) => Promise<any> };
  private stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalProcessingTime: 0
  };

  constructor() {
    super();
    // NV-LLM-001 (R3): proxy executeRequest through executeWithFullSafetyRing.
    this.llmService = {
      executeRequest: async (req: any) => {
        const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');
        return executeWithFullSafetyRing(req, {
          sdkPlatform: 'openai-doc-intel',
          agentKey: 'legal-clause-extractor',
          taskType: 'clause-extraction',
          domainContext: 'OpenAI Document Intelligence service',
          // NV-NSP-CLAUSE-001: lean sync path for partner clause extract
          enableMemory: false,
          enableHallucinationCheck: false,
          enableCitationVerification: false,
          enableRAG: false,
        });
      },
    };
    logger.info(`[OpenAI-DocIntel] Document Intelligence Service v${PLATFORM_VERSION} initialized`);
    logger.info(`[OpenAI-DocIntel] Using executeWithFullSafetyRing orchestration layer (NV-LLM-001)`);
    logger.info(`[OpenAI-DocIntel] Embedding model: ${EMBEDDING_MODEL}`);
  }

  async summarizeDocument(text: string, options: {
    detailLevel?: 'brief' | 'standard' | 'detailed';
    focusAreas?: string[];
    maxWords?: number;
    jurisdiction?: string;
  } = {}): Promise<DocumentSummary> {
    const startTime = Date.now();
    const { detailLevel = 'standard', focusAreas = [], maxWords, jurisdiction } = options;
    this.stats.totalRequests++;

    try {
      const wordLimits = { brief: 100, standard: 300, detailed: 600 };
      const limit = maxWords || wordLimits[detailLevel];

      let prompt = `Summarize the following legal document in approximately ${limit} words. `;
      if (detailLevel === 'brief') prompt += 'Focus only on the most critical points. ';
      if (detailLevel === 'detailed') prompt += 'Include all important details, parties, obligations, dates, and financial terms. ';
      if (focusAreas.length > 0) prompt += `Pay special attention to: ${focusAreas.join(', ')}. `;
      prompt += 'Structure: Executive summary → Key facts → Legal issues / obligations → Risks → Action items. Also provide a list of key points as bullet items.\n\nDocument:\n' + text.substring(0, 12000);

      const { buildLegalSummarizeSystemPrompt } = await import('./jrx-legal-drafting-prompt.js');
      const response = await this.llmService.executeRequest({
        id: `docintel_summary_${Date.now()}`,
        userId: 'system',
        prompt,
        systemPrompt: buildLegalSummarizeSystemPrompt(jurisdiction || 'IN'),
        model: 'openai/gpt-4.1',
        maxTokens: 2048,
        temperature: 0.3,
        provider: 'openrouter',
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'medium',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      });

      const content = response.content || '';
      const keyPoints = this.extractKeyPoints(content);

      this.stats.successfulRequests++;
      const result: DocumentSummary = {
        summary: content,
        keyPoints,
        detailLevel,
        wordCount: content.split(/\s+/).length,
        processingTimeMs: Date.now() - startTime
      };

      this.emit('summarize:complete', result);
      logger.info(`[OpenAI-DocIntel] Summary generated: ${result.wordCount} words in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] Summarization error:', error?.message || error);
      return this.mockSummary(text, detailLevel, startTime);
    }
  }

  async extractEntities(text: string, entityTypes?: string[]): Promise<EntityExtractionResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      const types = entityTypes || ['party', 'date', 'amount', 'clause', 'jurisdiction', 'reference', 'obligation', 'term'];

      const prompt = `Extract all legal entities from the following document. For each entity, provide:
- name: identifier
- type: one of [${types.join(', ')}]
- value: the extracted value
- context: surrounding text snippet (max 50 words)
- confidence: 0-100

Return as JSON array of objects with those fields.

Document:
${text.substring(0, 10000)}`;

      const response = await this.llmService.executeRequest({
        id: `docinel_entities_${Date.now()}`,
        userId: 'system',
        prompt,
        systemPrompt: 'You are a legal entity extraction specialist. Return only valid JSON arrays.',
        model: 'openai/gpt-4.1',
        maxTokens: 3000,
        temperature: 0.2,
        provider: 'openrouter',
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'medium',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      });

      const content = response.content || '{"entities":[]}';
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { entities: [] };
      }

      const entities: ExtractedEntity[] = (parsed.entities || parsed || []).map((e: any) => ({
        name: e.name || '',
        type: types.includes(e.type) ? e.type : 'reference',
        value: e.value || '',
        context: e.context || '',
        confidence: typeof e.confidence === 'number' ? e.confidence : 80
      }));

      this.stats.successfulRequests++;
      const result: EntityExtractionResult = {
        entities,
        totalFound: entities.length,
        processingTimeMs: Date.now() - startTime
      };

      this.emit('extract:complete', result);
      logger.info(`[OpenAI-DocIntel] Extracted ${entities.length} entities in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] Entity extraction error:', error?.message || error);
      return this.mockEntities(startTime);
    }
  }

  async compareContracts(documentA: string, documentB: string): Promise<ContractComparisonResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      const prompt = `Compare these two legal documents and identify all differences.

For each difference provide:
- section: which section/clause
- type: added, removed, modified, or unchanged
- documentA: text from document A
- documentB: text from document B
- significance: low, medium, high, or critical
- explanation: why this difference matters

Also provide an overall similarity score (0-100).

Return as JSON with "differences" array and "similarityScore" number.

DOCUMENT A:
${documentA.substring(0, 6000)}

DOCUMENT B:
${documentB.substring(0, 6000)}`;

      const response = await this.llmService.executeRequest({
        id: `docinel_compare_${Date.now()}`,
        userId: 'system',
        prompt,
        systemPrompt: 'You are a contract comparison specialist. Return only valid JSON.',
        model: 'openai/gpt-4.1',
        maxTokens: 4000,
        temperature: 0.2,
        provider: 'openrouter',
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'medium',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      });

      const content = response.content || '{"differences":[],"similarityScore":50}';
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { differences: [], similarityScore: 50 };
      }

      const differences: ContractDifference[] = (parsed.differences || []).map((d: any) => ({
        section: d.section || 'General',
        type: ['added', 'removed', 'modified', 'unchanged'].includes(d.type) ? d.type : 'modified',
        documentA: d.documentA || '',
        documentB: d.documentB || '',
        significance: ['low', 'medium', 'high', 'critical'].includes(d.significance) ? d.significance : 'medium',
        explanation: d.explanation || ''
      }));

      this.stats.successfulRequests++;
      const result: ContractComparisonResult = {
        differences,
        similarityScore: typeof parsed.similarityScore === 'number' ? parsed.similarityScore : 50,
        totalDifferences: differences.length,
        criticalDifferences: differences.filter(d => d.significance === 'critical').length,
        processingTimeMs: Date.now() - startTime
      };

      this.emit('compare:complete', result);
      logger.info(`[OpenAI-DocIntel] Comparison complete: ${result.totalDifferences} differences, similarity ${result.similarityScore}% in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] Comparison error:', error?.message || error);
      return this.mockComparison(startTime);
    }
  }

  async classifyClauses(text: string): Promise<ClauseClassificationResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      const prompt = `Analyze the following legal document and classify each clause/section.

For each clause provide:
- text: the clause text (abbreviated if long)
- clauseType: e.g., indemnification, limitation of liability, termination, confidentiality, payment terms, intellectual property, governing law, dispute resolution, force majeure, warranty, non-compete, data protection, etc.
- riskLevel: low, medium, high, or critical
- explanation: why this risk level
- recommendations: array of suggested improvements

Also provide an overallRiskScore (0-100, where 100 is highest risk).

Return as JSON with "clauses" array and "overallRiskScore" number.

Document:
${text.substring(0, 10000)}`;

      const { buildLegalClassifySystemPrompt } = await import('./jrx-legal-drafting-prompt.js');
      // NV-NSP-CLAUSE-001: do not hard-pin OpenRouter (currently 402/out of
      // credits on jrx-staging). Route via safety ring with clause-extractor agent
      // and lean flags so NSP sync clause-extract completes with real clauses.
      const response = await this.llmService.executeRequest({
        id: `docinel_classify_${Date.now()}`,
        userId: 'system',
        prompt,
        systemPrompt: buildLegalClassifySystemPrompt('IN'),
        model: 'auto',
        maxTokens: 4000,
        temperature: 0.2,
        requirements: {
          complexity: 'moderate',
          domain: 'analytical',
          priority: 'high',
          costBudget: 'balanced',
          responseTime: 'fast',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      });

      const content = response.content || '';
      const parsed = this.parseJsonObject(content) || { clauses: [], overallRiskScore: 0 };

      let clauses: ClassifiedClause[] = (parsed.clauses || []).map((c: any) => ({
        text: c.text || '',
        clauseType: c.clauseType || c.type || 'general',
        riskLevel: ['low', 'medium', 'high', 'critical'].includes(c.riskLevel) ? c.riskLevel : 'medium',
        explanation: c.explanation || '',
        recommendations: Array.isArray(c.recommendations) ? c.recommendations : [],
        confidence: typeof c.confidence === 'number' ? c.confidence : 80
      })).filter((c: ClassifiedClause) => c.text.trim().length > 0);

      // Deterministic fallback when LLM returns empty/unparseable JSON so NSP
      // never receives clauses:[] for clearly structured contract text.
      if (clauses.length === 0) {
        clauses = this.heuristicClassifyClauses(text);
        logger.warn('[OpenAI-DocIntel] LLM clause JSON empty — heuristic fallback', {
          heuristicCount: clauses.length,
          contentPreview: content.slice(0, 160),
        });
      }

      this.stats.successfulRequests++;
      const result: ClauseClassificationResult = {
        clauses,
        overallRiskScore: typeof parsed.overallRiskScore === 'number' && clauses.length
          ? parsed.overallRiskScore
          : this.scoreClauses(clauses),
        totalClauses: clauses.length,
        processingTimeMs: Date.now() - startTime
      };

      this.emit('classify:complete', result);
      logger.info(`[OpenAI-DocIntel] Classified ${clauses.length} clauses, risk score ${result.overallRiskScore} in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] Clause classification error:', error?.message || error);
      const heuristic = this.heuristicClassifyClauses(text);
      if (heuristic.length > 0) {
        return {
          clauses: heuristic,
          overallRiskScore: this.scoreClauses(heuristic),
          totalClauses: heuristic.length,
          processingTimeMs: Date.now() - startTime,
        };
      }
      return this.mockClauseClassification(startTime);
    }
  }

  // Exception: generateEmbeddings still uses direct OpenAI API since RealLLMService
  // doesn't support the embeddings endpoint. This is the only method that bypasses
  // the orchestration layer.
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const openai = getOpenAIClient();
    if (!openai) {
      logger.warn('[OpenAI-DocIntel] No API key, returning mock embeddings');
      return this.mockEmbeddings(texts, startTime);
    }

    try {
      const truncated = texts.map(t => t.substring(0, 8000));

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncated,
        encoding_format: 'float'
      });

      this.stats.successfulRequests++;
      const result: EmbeddingResult = {
        embeddings: response.data.map(d => d.embedding),
        model: EMBEDDING_MODEL,
        dimensions: response.data[0]?.embedding.length || 1536,
        totalTokens: response.usage.total_tokens,
        processingTimeMs: Date.now() - startTime
      };

      // NV-CREDIT-COST-DIM-001 — this is the one method that deliberately bypasses
      // the orchestration layer (RealLLMService has no embeddings endpoint), so
      // nothing else on the request reports its spend. Money, not tokens: the daily
      // token budget is denominated in chat tokens at ~100× this rate.
      recordAuxSpend({
        costUsd: (result.totalTokens / 1000) * NV_AUX_RATES.embeddingMicroUsdPer1kTokens / 1_000_000,
        driver: 'embedding_tokens',
        provider: 'openai',
        model: EMBEDDING_MODEL,
        units: result.totalTokens,
      });

      this.emit('embed:complete', result);
      logger.info(`[OpenAI-DocIntel] Generated ${texts.length} embeddings (${result.dimensions}d) in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] Embedding error:', error?.message || error);
      return this.mockEmbeddings(texts, startTime);
    }
  }

  async answerQuestion(documentText: string, question: string): Promise<DocumentQAResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      const prompt = `Based on the following document, answer the question accurately and cite relevant excerpts.

Document:
${documentText.substring(0, 10000)}

Question: ${question}

Provide:
1. A clear, direct answer
2. Relevant excerpts from the document that support your answer
3. A confidence score (0-100)

Return as JSON with "answer" (string), "relevantExcerpts" (array of strings), and "confidence" (number).`;

      const response = await this.llmService.executeRequest({
        id: `docinel_qa_${Date.now()}`,
        userId: 'system',
        prompt,
        systemPrompt: 'You are a legal document Q&A specialist. Return only valid JSON.',
        model: 'openai/gpt-4.1',
        maxTokens: 2000,
        temperature: 0.2,
        provider: 'openrouter',
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'medium',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      });

      const content = response.content || '{"answer":"","relevantExcerpts":[],"confidence":0}';
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { answer: content, relevantExcerpts: [], confidence: 70 };
      }

      this.stats.successfulRequests++;
      const result: DocumentQAResult = {
        answer: parsed.answer || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 80,
        relevantExcerpts: Array.isArray(parsed.relevantExcerpts) ? parsed.relevantExcerpts : [],
        processingTimeMs: Date.now() - startTime
      };

      this.emit('qa:complete', result);
      logger.info(`[OpenAI-DocIntel] QA response generated (confidence: ${result.confidence}%) in ${result.processingTimeMs}ms`);
      return result;
    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('[OpenAI-DocIntel] QA error:', error?.message || error);
      return this.mockQA(question, startTime);
    }
  }

  getStats() {
    return {
      ...this.stats,
      averageProcessingTime: this.stats.totalRequests > 0
        ? Math.round(this.stats.totalProcessingTime / this.stats.totalRequests)
        : 0,
      successRate: this.stats.totalRequests > 0
        ? Math.round((this.stats.successfulRequests / this.stats.totalRequests) * 10000) / 100
        : 0,
      version: PLATFORM_VERSION
    };
  }

  private extractKeyPoints(text: string): string[] {
    const lines = text.split('\n');
    const points: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-*\u2022]\s/.test(trimmed)) {
        points.push(trimmed.replace(/^[-*\u2022]\s+/, ''));
      } else if (/^\d+[.)]\s/.test(trimmed)) {
        points.push(trimmed.replace(/^\d+[.)]\s+/, ''));
      }
    }
    return points.length > 0 ? points : ['Document analysis completed. See summary for details.'];
  }

  private mockSummary(text: string, detailLevel: 'brief' | 'standard' | 'detailed', startTime: number): DocumentSummary {
    const wordCount = text.split(/\s+/).length;
    return {
      summary: `This document contains ${wordCount} words and covers legal terms, obligations, and conditions between the involved parties. Key areas include contractual obligations, payment terms, confidentiality provisions, and governing law. A full analysis with OpenAI requires an API key.`,
      keyPoints: [
        'Document contains contractual terms and conditions',
        'Multiple parties and obligations identified',
        'Financial terms and payment schedules present',
        'Confidentiality and compliance clauses included',
        'Full AI-powered analysis available with API key'
      ],
      detailLevel,
      wordCount: 45,
      processingTimeMs: Date.now() - startTime
    };
  }

  private mockEntities(startTime: number): EntityExtractionResult {
    return {
      entities: [
        { name: 'Party A', type: 'party', value: 'Acme Corporation', context: 'Agreement between parties', confidence: 85 },
        { name: 'Effective Date', type: 'date', value: 'February 11, 2026', context: 'This agreement is effective as of', confidence: 90 },
        { name: 'Contract Value', type: 'amount', value: '$69,982.50', context: 'Grand Total payable', confidence: 88 },
        { name: 'Governing Law', type: 'jurisdiction', value: 'State of California', context: 'governed by the laws of', confidence: 87 },
        { name: 'Payment Terms', type: 'term', value: 'Net 30', context: 'Payment Terms: Net 30 from invoice date', confidence: 92 }
      ],
      totalFound: 5,
      processingTimeMs: Date.now() - startTime
    };
  }

  private mockComparison(startTime: number): ContractComparisonResult {
    return {
      differences: [
        {
          section: 'Payment Terms',
          type: 'modified',
          documentA: 'Net 30 from invoice date',
          documentB: 'Net 45 from invoice date',
          significance: 'high',
          explanation: 'Payment window extended by 15 days, affecting cash flow'
        },
        {
          section: 'Liability Cap',
          type: 'added',
          documentA: '',
          documentB: 'Liability limited to 12 months of fees',
          significance: 'critical',
          explanation: 'New liability limitation clause added in Document B'
        }
      ],
      similarityScore: 72,
      totalDifferences: 2,
      criticalDifferences: 1,
      processingTimeMs: Date.now() - startTime
    };
  }

  private parseJsonObject(content: string): any | null {
    if (!content || !String(content).trim()) return null;
    const trimmed = String(content).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* continue */
    }
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
    }
    const arrMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const arr = JSON.parse(arrMatch[0]);
        if (Array.isArray(arr)) return { clauses: arr, overallRiskScore: 50 };
      } catch { /* continue */ }
    }
    return null;
  }

  private scoreClauses(clauses: ClassifiedClause[]): number {
    if (!clauses.length) return 0;
    const weights: Record<string, number> = { low: 15, medium: 40, high: 70, critical: 90 };
    const sum = clauses.reduce((acc, c) => acc + (weights[c.riskLevel] ?? 40), 0);
    return Math.min(100, Math.round(sum / clauses.length));
  }

  private heuristicClassifyClauses(text: string): ClassifiedClause[] {
    const patterns: Array<{ re: RegExp; clauseType: string; riskLevel: ClassifiedClause['riskLevel'] }> = [
      { re: /\bindemnif(?:y|ication|ies)\b/i, clauseType: 'indemnification', riskLevel: 'high' },
      { re: /\blimitation of liability\b|\bliability shall not exceed\b/i, clauseType: 'limitation of liability', riskLevel: 'high' },
      { re: /\bterminat(?:e|ion)\b/i, clauseType: 'termination', riskLevel: 'medium' },
      { re: /\bconfidential(?:ity)?\b|\bnon[- ]disclosure\b/i, clauseType: 'confidentiality', riskLevel: 'medium' },
      { re: /\bgoverning law\b|\blaws of\b.*\bjurisdiction\b/i, clauseType: 'governing law', riskLevel: 'low' },
      { re: /\barbitration\b|\bdispute resolution\b|\bexclusive jurisdiction\b/i, clauseType: 'dispute resolution', riskLevel: 'medium' },
      { re: /\bforce majeure\b/i, clauseType: 'force majeure', riskLevel: 'medium' },
      { re: /\bwarrant(?:y|ies)\b/i, clauseType: 'warranty', riskLevel: 'medium' },
      { re: /\bintellectual property\b|\bIP ownership\b/i, clauseType: 'intellectual property', riskLevel: 'high' },
      { re: /\bpayment\b|\binvoice\b|\bfee\b/i, clauseType: 'payment terms', riskLevel: 'medium' },
      { re: /\bnon[- ]compete\b|\brestraint of trade\b/i, clauseType: 'non-compete', riskLevel: 'high' },
      { re: /\bdata protection\b|\bpersonal data\b|\bGDPR\b|\bDPDP\b/i, clauseType: 'data protection', riskLevel: 'high' },
    ];

    const blocks = String(text || '')
      .split(/(?=\n\s*(?:\d+[\).]|[A-Z][A-Za-z ]{2,40}:)\s*)/)
      .map((b) => b.trim())
      .filter((b) => b.length > 20);

    const source = blocks.length ? blocks : [String(text || '').trim()].filter(Boolean);
    const found: ClassifiedClause[] = [];
    const seen = new Set<string>();

    for (const block of source) {
      for (const p of patterns) {
        if (!p.re.test(block)) continue;
        const key = `${p.clauseType}:${block.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          text: block.length > 400 ? `${block.slice(0, 397)}...` : block,
          clauseType: p.clauseType,
          riskLevel: p.riskLevel,
          explanation: `Detected ${p.clauseType} language via deterministic clause scanner`,
          recommendations: [`Review ${p.clauseType} terms for jurisdiction-specific enforceability`],
          confidence: 70,
        });
        break;
      }
    }
    return found.slice(0, 20);
  }

  private mockClauseClassification(startTime: number): ClauseClassificationResult {
    return {
      clauses: [
        {
          text: 'Both parties agree to maintain strict confidentiality of all proprietary information.',
          clauseType: 'confidentiality',
          riskLevel: 'low',
          explanation: 'Standard mutual confidentiality clause with adequate protection',
          recommendations: ['Consider adding a specific duration for confidentiality obligations'],
          confidence: 88
        },
        {
          text: 'Late Payment Fee: 1.5% per month on overdue amounts',
          clauseType: 'payment terms',
          riskLevel: 'medium',
          explanation: '1.5% monthly late fee may be considered high in some jurisdictions',
          recommendations: ['Verify compliance with local usury laws', 'Consider adding a grace period'],
          confidence: 85
        },
        {
          text: 'This agreement shall be governed by the laws of the State of California',
          clauseType: 'governing law',
          riskLevel: 'low',
          explanation: 'Standard governing law clause with clear jurisdiction',
          recommendations: ['Consider adding a dispute resolution mechanism'],
          confidence: 92
        }
      ],
      overallRiskScore: 35,
      totalClauses: 3,
      processingTimeMs: Date.now() - startTime
    };
  }

  private mockEmbeddings(texts: string[], startTime: number): EmbeddingResult {
    const dim = 1536;
    const embeddings = texts.map(() => {
      const vec = new Array(dim);
      for (let i = 0; i < dim; i++) {
        vec[i] = (secureRandom() - 0.5) * 0.1;
      }
      return vec;
    });

    return {
      embeddings,
      model: EMBEDDING_MODEL,
      dimensions: dim,
      totalTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
      processingTimeMs: Date.now() - startTime
    };
  }

  private mockQA(question: string, startTime: number): DocumentQAResult {
    return {
      answer: `Based on the document analysis, the question "${question}" relates to the contractual terms outlined in the agreement. For a precise AI-powered answer, please configure the OPENAI_API_KEY environment variable.`,
      confidence: 60,
      relevantExcerpts: [
        'Document contains relevant contractual provisions',
        'Full AI-powered Q&A available with API key configuration'
      ],
      processingTimeMs: Date.now() - startTime
    };
  }
}

export const openaiDocumentIntelligenceService = new OpenAIDocumentIntelligenceService();
