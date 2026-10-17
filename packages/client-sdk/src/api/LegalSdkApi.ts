/**
 * Partner legal SDK — /api/jrx/sdk/legal/*
 */

import type { NyvHttpClient } from '../NyvClient.js';
import type { NyvJurisdiction } from '../types/index.js';

export interface CaseAnalysisRequest {
  caseType?: string;
  facts: string;
  jurisdiction?: NyvJurisdiction;
  matterId?: string;
  orgId?: string;
  [key: string]: unknown;
}

export class LegalSdkApi {
  constructor(private readonly http: NyvHttpClient) {}

  /** Fact-pattern case analysis with reasoning + citations. */
  caseAnalysis(req: CaseAnalysisRequest): Promise<unknown> {
    return this.http.post('/api/jrx/sdk/legal/case-analysis', req);
  }
}
