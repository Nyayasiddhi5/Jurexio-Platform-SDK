// @ts-nocheck
// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { db } from '../db/index.js';
import { cases, caseDocuments, caseInsights, documentParsing } from '../../shared/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { RealLLMService, type LLMRequest } from './real-llm-service.js';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('case-management-service');

function buildLLMRequest(opts: { prompt: string; systemPrompt: string; model?: string; maxTokens?: number; temperature?: number; provider?: string; userId?: string }): LLMRequest {
  return {
    id: crypto.randomUUID(),
    userId: opts.userId || 'system',
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    model: opts.model || 'openai/gpt-4.1',
    maxTokens: opts.maxTokens || 2000,
    temperature: opts.temperature || 0.2,
    provider: opts.provider || 'openrouter',
    requirements: {
      complexity: 'complex',
      domain: 'analytical',
      priority: 'high',
      costBudget: 'balanced',
      responseTime: 'balanced',
      qualityLevel: 'professional',
    },
    fallbackLevels: 3,
    timestamp: new Date(),
  };
}

export class CaseManagementService {
  private llmService: RealLLMService;

  constructor() {
    this.llmService = new RealLLMService();
  }

  async createCase(data: {
    title: string;
    description?: string;
    caseType?: string;
    jurisdiction: string;
    courtName?: string;
    applicableSections?: string[];
    parties?: any[];
    userId: string;
    organizationId?: number;
    lawyerId?: string;
    clientDetails?: any;
    caseNumber?: string;
    priority?: string;
    tags?: string[];
  }): Promise<any> {
    const [newCase] = await db!.insert(cases).values({
      title: data.title,
      description: data.description,
      caseType: data.caseType,
      caseNumber: data.caseNumber,
      jurisdiction: data.jurisdiction,
      courtName: data.courtName,
      applicableSections: data.applicableSections || [],
      parties: data.parties || [],
      userId: data.userId,
      organizationId: data.organizationId,
      lawyerId: data.lawyerId,
      clientDetails: data.clientDetails || {},
      priority: data.priority || 'normal',
      tags: data.tags || [],
    }).returning();
    return newCase;
  }

  async getCase(caseId: number): Promise<any> {
    const caseData = await db!.query.cases.findFirst({
      where: eq(cases.id, caseId),
    });
    if (!caseData) return null;

    const documents = await db!.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).orderBy(desc(caseDocuments.createdAt));
    const insights = await db!.select().from(caseInsights).where(eq(caseInsights.caseId, caseId)).orderBy(desc(caseInsights.createdAt));

    return { ...caseData, documents, insights };
  }

  async listCases(userId: string, organizationId?: number | string | null): Promise<any[]> {
    // NYV-UAT-FIX-002: organizationId arrives from JWT and may be undefined,
    // null, an empty string, or a non-numeric tenant slug. Only filter on it
    // when it parses to a positive integer (matches the cases.organization_id
    // schema, which is integer-typed). Otherwise drop the filter entirely
    // instead of letting drizzle pass NaN to Postgres (→ "invalid input syntax
    // for type integer: \"NaN\"" 500).
    const orgInt =
      organizationId === undefined || organizationId === null || organizationId === ''
        ? null
        : Number.isFinite(Number(organizationId))
          ? Number(organizationId)
          : null;
    if (orgInt !== null) {
      return db!.select().from(cases).where(and(eq(cases.userId, userId), eq(cases.organizationId, orgInt))).orderBy(desc(cases.createdAt));
    }
    return db!.select().from(cases).where(eq(cases.userId, userId)).orderBy(desc(cases.createdAt));
  }

  async updateCase(caseId: number, updates: any): Promise<any> {
    const [updated] = await db!.update(cases).set({ ...updates, updatedAt: new Date() }).where(eq(cases.id, caseId)).returning();
    return updated;
  }

  async addDocumentToCase(caseId: number, documentId: number, addedBy: string, documentRole?: string, source?: string, notes?: string): Promise<any> {
    const document = await db!.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });

    if (!document) throw new Error('Document not found');

    let summary = '';
    let extractedEntities: any = {};

    if (document.extractedText) {
      try {
        const summaryResponse = await this.llmService.executeRequest(buildLLMRequest({
          prompt: `Summarize this legal document in 3-5 sentences, highlighting key facts, parties, dates, and legal implications:\n\n${document.extractedText.substring(0, 10000)}`,
          systemPrompt: 'You are a legal document analysis agent for Nyayavigya Legal Platform. Provide concise, accurate summaries focused on legally relevant information.',
          maxTokens: 500,
        }));
        summary = summaryResponse.content;

        const entityResponse = await this.llmService.executeRequest(buildLLMRequest({
          prompt: `Extract legal entities from this document as JSON: { "parties": [], "dates": [], "amounts": [], "references": [], "jurisdictions": [], "clauses": [] }\n\nDocument:\n${document.extractedText.substring(0, 8000)}`,
          systemPrompt: 'You are an entity extraction agent for Nyayavigya. Return only valid JSON.',
          maxTokens: 1500,
          temperature: 0.1,
        }));
        try { extractedEntities = JSON.parse(entityResponse.content); } catch { extractedEntities = { raw: entityResponse.content }; }
      } catch (err: any) {
        logger.error('[CaseManagement] AI processing error:', err);
      }
    }

    const [caseDoc] = await db!.insert(caseDocuments).values({
      caseId,
      documentId,
      addedBy,
      documentRole: documentRole || 'supporting',
      summary,
      extractedEntities,
      source: source || 'upload',
      notes,
      version: 1,
    }).returning();

    return caseDoc;
  }

  async generateCaseInsights(caseId: number): Promise<any[]> {
    const caseData = await this.getCase(caseId);
    if (!caseData) throw new Error('Case not found');

    const allDocTexts: string[] = [];
    for (const doc of caseData.documents || []) {
      const docData = await db!.query.documentParsing.findFirst({
        where: eq(documentParsing.id, doc.documentId),
      });
      if (docData?.extractedText) {
        allDocTexts.push(`[${docData.originalFileName || docData.fileName}]: ${docData.extractedText.substring(0, 5000)}`);
      }
    }

    const contextText = allDocTexts.join('\n\n---\n\n').substring(0, 30000);

    const insightTypes = [
      { type: 'case_summary', title: 'Case Summary & Key Facts', prompt: `Analyze all documents for this legal case and provide a comprehensive case summary including: key facts timeline, parties involved and their roles, main legal issues, and current status. Case: ${caseData.title}, Jurisdiction: ${caseData.jurisdiction}, Type: ${caseData.caseType || 'General'}` },
      { type: 'legal_analysis', title: 'Legal Analysis & Applicable Laws', prompt: `Based on the case documents, identify: applicable laws and sections, relevant precedents, potential legal arguments for both sides, and risk assessment. Jurisdiction: ${caseData.jurisdiction}` },
      { type: 'action_items', title: 'Recommended Actions & Next Steps', prompt: `Based on the case analysis, provide: immediate action items, filing deadlines, documents still needed, witnesses to interview, and strategic recommendations.` },
    ];

    const generatedInsights: any[] = [];

    for (const insight of insightTypes) {
      try {
        const response = await this.llmService.executeRequest(buildLLMRequest({
          prompt: `${insight.prompt}\n\nCase Documents:\n${contextText}`,
          systemPrompt: `You are a senior legal analyst agent for Nyayavigya Legal Platform specializing in ${caseData.jurisdiction} jurisdiction law. Provide thorough, actionable analysis. Always cite specific documents and facts from the provided materials.`,
          temperature: 0.3,
        }));

        const [saved] = await db!.insert(caseInsights).values({
          caseId,
          insightType: insight.type,
          title: insight.title,
          content: response.content,
          confidence: 0.85,
          sources: caseData.documents.map((d: any) => d.documentId),
          agentId: `case-analysis-agent-${caseData.jurisdiction}`,
          orchestrationMetadata: {
            model: response.model,
            provider: response.provider,
            tokensUsed: response.tokens?.total || 0,
            responseTime: response.responseTime,
          },
        }).returning();

        generatedInsights.push(saved);
      } catch (err: any) {
        logger.error(`[CaseManagement] Insight generation error for ${insight.type}:`, err);
      }
    }

    await db!.update(cases).set({ insightsGeneratedAt: new Date(), updatedAt: new Date() }).where(eq(cases.id, caseId));

    return generatedInsights;
  }

  async getCaseDocuments(caseId: number): Promise<any[]> {
    return db!.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).orderBy(desc(caseDocuments.createdAt));
  }

  async getCaseInsights(caseId: number): Promise<any[]> {
    return db!.select().from(caseInsights).where(eq(caseInsights.caseId, caseId)).orderBy(desc(caseInsights.createdAt));
  }
}

export const caseManagementService = new CaseManagementService();
