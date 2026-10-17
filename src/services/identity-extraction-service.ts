// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { db } from '../db/index.js';
import { identityExtractions, documentParsing } from '../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import type { LLMRequest } from './real-llm-service.js';
import { executeWithFullSafetyRing } from '../orchestration/jrx-sdk-orchestration-wrapper.js';
import crypto from 'crypto';
import { encryptedExpr } from './field-encryption-service.js';
import { createLogger } from '../utils/logger.js';

const fieldEncLogger = createLogger('identity-extraction-fieldenc');

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

export class IdentityExtractionService {
  // NV-LLM-001 (R2): direct RealLLMService removed; all calls go through
  // executeWithFullSafetyRing.
  constructor() {}

  async extractIdentityFields(documentId: number, userId: string, documentType: string, organizationId?: number): Promise<any> {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const document = await db!.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });

    if (!document || !document.extractedText) {
      throw new Error('Document not found or text not extracted yet');
    }

    const fieldSchemas: Record<string, string[]> = {
      'aadhaar': ['fullName', 'dateOfBirth', 'gender', 'aadhaarNumber', 'address', 'fatherName', 'motherName'],
      'pan': ['fullName', 'panNumber', 'dateOfBirth', 'fatherName'],
      'passport': ['fullName', 'passportNumber', 'dateOfBirth', 'nationality', 'placeOfBirth', 'dateOfIssue', 'dateOfExpiry', 'placeOfIssue', 'address'],
      'bar_certificate': ['lawyerName', 'enrollmentNumber', 'barCouncil', 'dateOfEnrollment', 'practiceAreas', 'courtJurisdiction'],
      'voter_id': ['fullName', 'voterId', 'fatherName', 'dateOfBirth', 'gender', 'address', 'constituency'],
      'driving_license': ['fullName', 'licenseNumber', 'dateOfBirth', 'dateOfIssue', 'dateOfExpiry', 'address', 'vehicleClasses'],
      'business_registration': ['companyName', 'registrationNumber', 'dateOfIncorporation', 'registeredAddress', 'directors', 'companyType'],
      'court_order': ['caseNumber', 'courtName', 'judgeName', 'parties', 'orderDate', 'orderSummary', 'nextHearingDate'],
    };

    const fields = fieldSchemas[documentType] || ['fullName', 'documentNumber', 'dateOfBirth', 'address'];

    const systemPrompt = `You are a specialized document intelligence agent for the Jurexio Legal Platform. Your task is to extract structured identity/document fields from the provided text. Extract ONLY factual data found in the document. Return a JSON object with the following fields: ${fields.join(', ')}. For each field, provide the extracted value and a confidence score (0.0 to 1.0). If a field is not found, set value to null and confidence to 0. Format: { "fields": { "fieldName": { "value": "extracted value", "confidence": 0.95 } }, "documentLanguage": "detected language", "overallConfidence": 0.9 }`;

    const userPrompt = `Extract identity fields from this ${documentType} document:\n\n${document.extractedText.substring(0, 8000)}`;

    // NV-LLM-001: PII-critical identity extraction MUST traverse full safety
    // ring (P18 GUARDIAN PII redaction + HITL gate + hallucination check).
    const response = await executeWithFullSafetyRing(
      buildLLMRequest({ prompt: userPrompt, systemPrompt, temperature: 0.1, userId }),
      {
        ctx: { userId, organizationId },
        sdkPlatform: 'identity-extraction',
        agentKey: 'auto',
        taskType: 'identity_extraction',
        domainContext: `PII-critical identity extraction: ${documentType}`,
        riskCategory: 'pii_high',
        enableHITL: true,
        enableHallucinationCheck: true,
      },
    );

    let extractedFields: any = {};
    let overallConfidence = 0;
    try {
      const parsed = JSON.parse(response.content);
      extractedFields = parsed.fields || parsed;
      overallConfidence = parsed.overallConfidence || 0.5;
    } catch {
      extractedFields = { rawExtraction: response.content };
      overallConfidence = 0.3;
    }

    // Task #29 — fail-closed field encryption: insert + encrypted-mirror
    // UPDATE in one transaction. Encryption failure rolls back the plaintext
    // insert; no row escapes without an encrypted companion.
    if (!db) throw new Error('[IdentityExtractionService] db handle missing');
    const extraction = await db.transaction(async (tx) => {
      const [row] = await tx.insert(identityExtractions).values({
        // @ts-expect-error NV-TS230 legacy typing gap (TS2769)
        userId,
        organizationId,
        documentId,
        documentType,
        extractedFields,
        confidence: overallConfidence,
        status: 'extracted',
        agentId: 'identity-extraction-agent',
        orchestrationMetadata: {
          model: response.model,
          provider: response.provider,
          tokensUsed: response.tokens?.total || 0,
          responseTime: response.responseTime,
        },
      }).returning();
      const extractionId = (row as { id?: number }).id;
      if (!extractionId) {
        throw new Error('[FieldEnc] insertExtraction returned no id; aborting transaction');
      }
      await tx.execute(sql`
        UPDATE nv_identity_extractions
        SET extracted_fields_enc = ${encryptedExpr(JSON.stringify(extractedFields))}
        WHERE id = ${extractionId}
      `);
      return row;
    });

    return extraction;
  }

  async getExtraction(extractionId: number): Promise<any> {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    return db!.query.identityExtractions.findFirst({
      where: eq(identityExtractions.id, extractionId),
    });
  }

  async getUserExtractions(userId: string): Promise<any[]> {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2769)
    return db!.select().from(identityExtractions).where(eq(identityExtractions.userId, userId)).orderBy(desc(identityExtractions.createdAt));
  }

  async reviewExtraction(extractionId: number, reviewedBy: string, correctedFields?: any): Promise<any> {
    const updates: any = {
      status: 'reviewed',
      reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    };
    if (correctedFields) {
      updates.extractedFields = correctedFields;
    }
    if (!db) throw new Error('[IdentityExtractionService] db handle missing');
    // Task #29 — fail-closed: when correctedFields is present, the plaintext
    // UPDATE and the encrypted-mirror UPDATE happen in one transaction so a
    // mirror failure rolls the corrected plaintext back too.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(identityExtractions).set(updates).where(eq(identityExtractions.id, extractionId)).returning();
      if (correctedFields) {
        await tx.execute(sql`
          UPDATE nv_identity_extractions
          SET extracted_fields_enc = ${encryptedExpr(JSON.stringify(correctedFields))}
          WHERE id = ${extractionId}
        `);
      }
      return row;
    });

    return updated;
  }

  async applyToProfile(extractionId: number): Promise<any> {
    const [updated] = await db!.update(identityExtractions).set({
      // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
      appliedToProfile: true,
      appliedAt: new Date(),
      status: 'applied',
      updatedAt: new Date(),
    }).where(eq(identityExtractions.id, extractionId)).returning();
    return updated;
  }
}

export const identityExtractionService = new IdentityExtractionService();
