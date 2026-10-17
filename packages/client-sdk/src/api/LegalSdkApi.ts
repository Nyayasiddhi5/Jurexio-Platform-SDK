/**
 * Partner legal SDK — /api/jrx/sdk/legal/*
 */

import type { JrxHttpClient } from '../JrxClient.js';
import type { JrxJurisdiction } from '../types/index.js';

export interface CaseAnalysisRequest {
  caseType?: string;
  facts: string;
  jurisdiction?: JrxJurisdiction;
  matterId?: string;
  orgId?: string;
  [key: string]: unknown;
}

export class LegalSdkApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** Fact-pattern case analysis with reasoning + citations. */
  caseAnalysis(req: CaseAnalysisRequest): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/legal/case-analysis', req);
  }
}
