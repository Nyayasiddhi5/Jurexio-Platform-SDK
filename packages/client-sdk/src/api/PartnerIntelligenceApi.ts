/**
 * NSP intelligence suite — /api/jrx/v1/sdk/intelligence/* (E1–E10, D7).
 */

import type { NyvHttpClient } from '../NyvClient.js';
import type { NyvJurisdiction } from '../types/index.js';

export interface ClassifyDocumentRequest {
  document_id?: string;
  text: string;
  jurisdiction?: NyvJurisdiction;
  org_id?: string;
}

export class PartnerIntelligenceApi {
  constructor(private readonly http: NyvHttpClient) {}

  capabilities(): Promise<unknown> {
    return this.http.get('/api/jrx/v1/sdk/intelligence/capabilities');
  }

  dashboardInsights(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/dashboard-insights', body);
  }

  caseRiskAnalysis(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/case-risk-analysis', body);
  }

  predictOutcome(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/predict-outcome', body);
  }

  suggestInvoiceItems(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/suggest-invoice-items', body);
  }

  hearingPrepChecklist(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/hearing-prep-checklist', body);
  }

  classifyDocument(req: ClassifyDocumentRequest): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/classify-document', req);
  }

  sentimentAnalysis(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/sentiment-analysis', body);
  }

  legalResearch(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/legal-research', body);
  }

  translateLegal(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/translate-legal', body);
  }

  portfolioRiskAnalysis(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/intelligence/portfolio-risk-analysis', body);
  }

  clientHealth(clientId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/v1/sdk/intelligence/client-health/${encodeURIComponent(clientId)}`);
  }
}
