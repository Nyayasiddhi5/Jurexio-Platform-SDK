/**
 * Partner gateway — /api/jrx/gateway/* (SDK-key auth).
 */

import type { JrxHttpClient } from '../JrxClient.js';
import type { JrxJurisdiction } from '../types/index.js';
import { JrxError } from '../types/index.js';
import {
  assertSdkMethodSignature,
  guardDocumentTextForReview,
  mapReviewEnvelope,
  normalizeAgentId,
} from '../utils/sdkMethodSignatureGuard.js';

export interface GatewayResearchQueryRequest {
  query: string;
  jurisdiction?: JrxJurisdiction;
  sources?: string[];
}

export interface GatewayDraftRequest {
  template: string;
  jurisdiction?: JrxJurisdiction;
  parameters?: Record<string, unknown>;
  instructions?: string;
  /** Canonical: concise | detailed | comprehensive */
  depth?: 'concise' | 'detailed' | 'comprehensive';
  documentType?: string;
  instruction?: string;
}

export interface GatewayAgentExecuteRequest {
  prompt: string;
  jurisdiction?: JrxJurisdiction;
  context?: Record<string, unknown>;
  content?: string;
  documentText?: string;
  status?: string;
  [key: string]: unknown;
}

export class GatewayApi {
  constructor(private readonly http: JrxHttpClient) {}

  listAgents(): Promise<unknown> {
    return this.http.get('/api/jrx/gateway/agents');
  }

  /**
   * Execute a gateway agent. Aliases `contract-review-deep` → routing id,
   * maps snake_case review envelopes, and keeps the signature guardrail
   * (exempts deep review; still rejects unknown methods).
   */
  async executeAgent(agentId: string, body: GatewayAgentExecuteRequest): Promise<unknown> {
    const rawId = String(agentId || '').trim();
    const resolved = normalizeAgentId(rawId) || rawId;
    const text =
      body.documentText ??
      body.content ??
      (typeof body.context?.documentText === 'string' ? body.context.documentText : undefined) ??
      (typeof body.context?.content === 'string' ? body.context.content : undefined);
    if (/contract|document.?review|review/i.test(rawId)) {
      const guard = guardDocumentTextForReview({
        text,
        status: body.status ?? (typeof body.context?.status === 'string' ? body.context.status : null),
      });
      if (guard.ok === false) {
        throw new JrxError({
          code: String(guard.body.code || 'DOCUMENT_TEXT_PENDING_OR_EMPTY'),
          message: String(guard.body.error || 'Document text pending or empty'),
          status: 400,
          details: guard.body,
        });
      }
    }

    const path = `/api/jrx/gateway/agents/${encodeURIComponent(rawId)}/execute`;
    const raw = await this.http.post<unknown>(path, {
      ...body,
      agentId: resolved,
    });

    // Guardrail kept: assert/map envelope; deep path is exempt.
    const checked = assertSdkMethodSignature({
      envelope: raw,
      path,
      agentId: rawId,
    });
    const mapped = checked.mapped || mapReviewEnvelope(raw);
    if (mapped && raw && typeof raw === 'object') {
      return {
        ...(raw as Record<string, unknown>),
        method: checked.method,
        envelope: checked.method,
        camel: mapped.camel,
      };
    }
    return raw;
  }

  getPracticeAreas(): Promise<unknown> {
    return this.http.get('/api/jrx/gateway/practice-areas');
  }

  researchQuery(req: GatewayResearchQueryRequest): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/research/query', req);
  }

  researchPrecedent(caseDescription: string, jurisdiction?: JrxJurisdiction): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/research/precedent', { caseDescription, jurisdiction });
  }

  draftDocument(req: GatewayDraftRequest): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/documents/draft', req);
  }

  summarizeDocument(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/documents/summarize', body);
  }

  async analyzeDocument(body: Record<string, unknown>): Promise<unknown> {
    const guard = guardDocumentTextForReview({
      text: body.content ?? body.documentText ?? body.text,
      status: typeof body.status === 'string' ? body.status : null,
      fieldName: 'content',
    });
    if (guard.ok === false) {
      throw new JrxError({
        code: String(guard.body.code || 'DOCUMENT_TEXT_PENDING_OR_EMPTY'),
        message: String(guard.body.error || 'Document text pending or empty'),
        status: 400,
        details: guard.body,
      });
    }
    return this.http.post('/api/jrx/gateway/documents/analyze', body);
  }

  translate(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/translate', body);
  }

  translateDetect(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/translate/detect-language', body);
  }

  translateBatch(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/translate/batch', body);
  }

  transliterate(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/translate/transliterate', body);
  }

  ocrProcess(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/ocr/process', body);
  }

  classifyClauses(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/documents/classify-clauses', body);
  }

  getUsage(): Promise<unknown> {
    return this.http.get('/api/jrx/gateway/usage');
  }

  getUsageTokens(): Promise<unknown> {
    return this.http.get('/api/jrx/gateway/usage/tokens');
  }

  verifyCitations(outputText: string, jurisdiction?: JrxJurisdiction): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/citations/verify', { outputText, jurisdiction });
  }

  checkHallucination(
    outputText: string,
    options?: { inputText?: string; agentKey?: string; jurisdiction?: JrxJurisdiction },
  ): Promise<unknown> {
    return this.http.post('/api/jrx/gateway/hallucination/check', {
      outputText,
      inputText: options?.inputText,
      agentKey: options?.agentKey,
      jurisdiction: options?.jurisdiction,
    });
  }
}
