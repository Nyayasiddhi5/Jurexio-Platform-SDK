import type { JrxHttpClient } from '../JrxClient.js';
import type {
  JrxPrecedentSearchResult,
  JrxRegulatoryDigest,
  JrxComplianceCalendar,
  JrxSecureSession,
  JrxContractAnalysis,
  JrxReadabilityScore,
  JrxLegalNerResult,
  JrxJurisdiction,
  JrxLegalDomain,
  JrxConflictDetectResult,
  JrxAmendmentImpactResult,
  JrxStatuteHistoryResult,
  JrxLitigationRiskResult,
} from '../types/index.js';

export interface PrecedentSearchOptions {
  maxResults?: number;
  crossJurisdiction?: boolean;
  domains?: JrxLegalDomain[];
}

export interface SecureSessionOptions {
  privilegeProtected?: boolean;
  expiresInHours?: number;
}

export class IntelligenceApi {
  constructor(private http: JrxHttpClient) {}

  async findPrecedents(
    caseDescription: string,
    jurisdiction: JrxJurisdiction,
    options?: PrecedentSearchOptions
  ): Promise<JrxPrecedentSearchResult> {
    return this.http.post('/api/jrx/intelligence/precedent-similarity', {
      caseDescription,
      jurisdiction,
      ...options,
    });
  }

  async getRegulatoryDigest(jurisdiction: JrxJurisdiction, days?: number): Promise<JrxRegulatoryDigest> {
    return this.http.post('/api/jrx/intelligence/regulatory-digest', {
      jurisdiction,
      days: days || 30,
    });
  }

  async getComplianceCalendar(jurisdiction: JrxJurisdiction): Promise<JrxComplianceCalendar> {
    return this.http.get(`/api/jrx/intelligence/compliance-calendar?jurisdiction=${jurisdiction}`);
  }

  async createSecureSession(
    participants: { userId: string; role: string }[],
    options?: SecureSessionOptions
  ): Promise<JrxSecureSession> {
    return this.http.post('/api/jrx/intelligence/secure-session/create', {
      participants,
      options: options || { privilegeProtected: false },
    });
  }

  async analyzeContract(text: string, jurisdiction: JrxJurisdiction): Promise<JrxContractAnalysis> {
    return this.http.post('/api/jrx/intelligence/contract-analysis', {
      text,
      jurisdiction,
    });
  }

  async scoreReadability(text: string): Promise<JrxReadabilityScore> {
    return this.http.post('/api/jrx/intelligence/readability', { text });
  }

  async extractEntities(text: string, jurisdiction: JrxJurisdiction): Promise<JrxLegalNerResult> {
    return this.http.post('/api/jrx/intelligence/legal-ner', { text, jurisdiction });
  }

  async conflictDetect(
    parties: { name: string; role: string }[],
    matterId?: string
  ): Promise<JrxConflictDetectResult> {
    return this.http.post('/api/jrx/intelligence/conflict-detect', { parties, matterId });
  }

  async amendmentImpact(
    amendmentId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxAmendmentImpactResult> {
    return this.http.post('/api/jrx/intelligence/amendment-impact', { amendmentId, jurisdiction });
  }

  async statuteHistory(
    statuteId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxStatuteHistoryResult> {
    return this.http.post('/api/jrx/intelligence/statute-history', { statuteId, jurisdiction });
  }

  async litigationRiskV2(
    caseDescription: string,
    jurisdiction: JrxJurisdiction,
    domain?: JrxLegalDomain
  ): Promise<JrxLitigationRiskResult> {
    return this.http.post('/api/jrx/intelligence/litigation-risk-v2', {
      caseDescription,
      jurisdiction,
      domain,
    });
  }

  async getRegulatoryFeed(
    jurisdiction: JrxJurisdiction,
    limit?: number
  ): Promise<JrxRegulatoryDigest> {
    return this.http.get(`/api/jrx/intelligence/regulatory-feed?jurisdiction=${jurisdiction}&limit=${limit || 50}`);
  }

  /** Live Legal Intelligence digest (own RSS → S3/RDS/RAG — no Tavily). */
  getLegalFeed(opts?: { jurisdiction?: JrxJurisdiction | string; digestDate?: string }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (opts?.jurisdiction) qs.set('jurisdiction', String(opts.jurisdiction));
    if (opts?.digestDate) qs.set('digestDate', opts.digestDate);
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/v1/sdk/legal-intelligence/feed${suffix}`);
  }

  getLegalFeedHistory(opts?: { jurisdiction?: string; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (opts?.jurisdiction) qs.set('jurisdiction', opts.jurisdiction);
    if (opts?.limit !== undefined) qs.set('limit', String(opts.limit));
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/v1/sdk/legal-intelligence/feed/history${suffix}`);
  }

  generateLegalFeed(body?: { jurisdiction?: string; topN?: number }): Promise<unknown> {
    return this.http.post('/api/jrx/v1/sdk/legal-intelligence/feed/generate', body || {});
  }
}
