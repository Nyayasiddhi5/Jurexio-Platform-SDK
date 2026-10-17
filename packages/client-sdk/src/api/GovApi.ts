/**
 * GovApi — Typed wrappers for the Batch D `/api/nv5/gov/*` governance admin
 * surface (Session-10, 2026-05-10). All routes require an SDK key with
 * `admin` scope and the matching `JRX_F_GOV_*` flag = 1; otherwise 404.
 * Bearer-as-JWT is rejected with `401 BEARER_NOT_SDK_KEY`.
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 14
 */

import type { NyvHttpClient } from '../NyvClient.js';

export type HitlPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface MakerCheckerReviewSummary {
  requestId: string;
  sessionId: string;
  priority: HitlPriority;
  reason: string;
  iterations: number;
  createdAt: number;
  deadline: number;
}

/**
 * Server returns the full pending-review record (not the trimmed summary
 * shape) inside a `{ success, review }` envelope.
 */
export interface MakerCheckerReviewRecord {
  requestId: string;
  sessionId: string;
  priority: HitlPriority;
  reason: string;
  iterations: Array<Record<string, unknown>>;
  createdAt: number;
  deadline: number;
  [k: string]: unknown;
}

export interface MakerCheckerReviewDetailResponse {
  success: boolean;
  review: MakerCheckerReviewRecord;
}

/** @deprecated Kept for backwards compatibility — use `MakerCheckerReviewRecord`. */
export interface MakerCheckerReviewDetail extends MakerCheckerReviewSummary {
  iterationsHistory: Array<Record<string, unknown>>;
}

export interface SecurityMonitorStatus {
  service: string;
  middlewareLoaded: boolean;
  mountedGlobally: boolean;
  thresholds: { maxExecDepth: number; attackWindowMs: number; attackThreshold: number };
}

export interface CostOptimizerStatus {
  service: string;
  promptCacheStats: { size: number; hits: number; misses: number; hitRate: string };
  globalUsage: { tokensIn: number; tokensOut: number; estimatedUsd: string };
  topUsers: Array<{ userId: string; tokens: number; usd: string }>;
}

export interface ConcurrencySnapshot {
  capturedAt: string;
  tenants: Array<{ tenantId: string; inFlight: number; queued: number; limit: number }>;
  providers: Array<{ providerId: string; inFlight: number; queued: number; limit: number }>;
  summary: { activeTenants: number; activeProviders: number; totalInFlight: number; totalQueued: number };
}

export interface OrgRateLimitDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  windowMs?: number;
  retryAfterMs?: number;
  reason?: string;
}

class MakerCheckerSubApi {
  constructor(private http: NyvHttpClient) {}
  queue(opts?: { priority?: HitlPriority }): Promise<{ count: number; reviews: MakerCheckerReviewSummary[] }> {
    const q = opts?.priority ? `?priority=${encodeURIComponent(opts.priority)}` : '';
    return this.http.get(`/api/nv5/gov/maker-checker/queue${q}`);
  }
  getReview(requestId: string): Promise<MakerCheckerReviewDetailResponse> {
    return this.http.get(`/api/nv5/gov/maker-checker/queue/${encodeURIComponent(requestId)}`);
  }
}

class SecurityMonitorSubApi {
  constructor(private http: NyvHttpClient) {}
  status(): Promise<SecurityMonitorStatus> {
    return this.http.get('/api/nv5/gov/security-monitor/status');
  }
}

class CostOptimizerSubApi {
  constructor(private http: NyvHttpClient) {}
  status(): Promise<CostOptimizerStatus> {
    return this.http.get('/api/nv5/gov/cost-optimizer/status');
  }
}

class ConcurrencySubApi {
  constructor(private http: NyvHttpClient) {}
  snapshot(): Promise<ConcurrencySnapshot> {
    return this.http.get('/api/nv5/gov/concurrency/snapshot');
  }
}

class OrgRateLimitSubApi {
  constructor(private http: NyvHttpClient) {}
  check(orgId: string, userId: string): Promise<OrgRateLimitDecision> {
    return this.http.get(
      `/api/nv5/gov/org-ratelimit/check/${encodeURIComponent(orgId)}/${encodeURIComponent(userId)}`,
    );
  }
  invalidateCache(orgId: string): Promise<{ success: boolean; orgId: string; cacheInvalidated: boolean }> {
    return this.http.post(
      `/api/nv5/gov/org-ratelimit/cache/${encodeURIComponent(orgId)}/invalidate`,
      {},
    );
  }
}

export class GovApi {
  public readonly makerChecker: MakerCheckerSubApi;
  public readonly securityMonitor: SecurityMonitorSubApi;
  public readonly costOptimizer: CostOptimizerSubApi;
  public readonly concurrency: ConcurrencySubApi;
  public readonly orgRateLimit: OrgRateLimitSubApi;

  constructor(http: NyvHttpClient) {
    this.makerChecker = new MakerCheckerSubApi(http);
    this.securityMonitor = new SecurityMonitorSubApi(http);
    this.costOptimizer = new CostOptimizerSubApi(http);
    this.concurrency = new ConcurrencySubApi(http);
    this.orgRateLimit = new OrgRateLimitSubApi(http);
  }
}
