/**
 * UsageApi — Token + cost usage ledger for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/usage/summary, /api/jrx/usage/tokens
 *
 * Surfaces the per-user / per-org token + cost ledger (the same rows that back
 * the console dashboards). All endpoints require authentication.
 */

import type { NyvHttpClient } from '../NyvClient.js';

export interface UsageSummaryOptions {
  startDate?: string;
  endDate?: string;
  orgId?: string;
}

export interface UsageSummary {
  endpointBreakdown: Array<{ agent_key: string; requests: number | string; tokens: number | string }>;
  period: { start: string; end: string };
  userId: string;
  orgId?: string;
  [k: string]: unknown;
}

export interface UsageTokens {
  applicationId: string | null;
  appName: string;
  daily: {
    tokensUsed: number;
    budget: number;
    remaining: number;
    requestCount: number;
    estimatedCost: number;
    [k: string]: unknown;
  };
  modelBreakdown?: Array<{ model: string; tokens: number | string; requests: number; cost: number | string }>;
  [k: string]: unknown;
}

export class UsageApi {
  constructor(private readonly http: NyvHttpClient) {}

  /**
   * Token/cost usage summary with per-endpoint breakdown for the current period.
   * `GET /api/jrx/usage/summary`.
   */
  getSummary(options: UsageSummaryOptions = {}): Promise<UsageSummary> {
    const params = new URLSearchParams();
    if (options.startDate) params.set('startDate', options.startDate);
    if (options.endDate) params.set('endDate', options.endDate);
    if (options.orgId) params.set('orgId', options.orgId);
    const qs = params.toString();
    return this.http.get(`/api/jrx/usage/summary${qs ? `?${qs}` : ''}`);
  }

  /**
   * Daily token/cost usage with per-model breakdown + budget status.
   * `GET /api/jrx/usage/tokens`.
   */
  getTokens(): Promise<UsageTokens> {
    return this.http.get('/api/jrx/usage/tokens');
  }
}
