// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * DB-Configurable Per-Org Rate Limiter — Algorithm P1
 * @version 5.2.0
 *
 * Replaces the hardcoded in-memory checkAIRateLimit with per-organisation
 * limits stored in the database (ns_schema.organisations.ai_rate_limit column).
 *
 * Falls back to a safe default (30 req/min) when the DB cannot be reached.
 *
 * Usage (drop-in for checkAIRateLimit):
 *   const allowed = await orgRateLimiter.check(orgId, userId);
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { shouldSkipPartnerProductRateLimits } from '../utils/jrx-partner-platform.js';

const logger = createLogger('org-rate-limiter');

/* ── Configuration ─────────────────────────────────────────── */

const DEFAULT_RPM     = 30;      // requests per minute fallback
const WINDOW_MS       = 60_000;  // 1 minute rolling window
const CACHE_TTL_MS    = 300_000; // cache org limit for 5 minutes

/* ── In-memory stores ──────────────────────────────────────── */

interface RateEntry { count: number; resetAt: number }
const requestStore = new Map<string, RateEntry>();

interface OrgLimit  { rpm: number; cachedAt: number }
const orgLimitCache = new Map<string, OrgLimit>();

/* ── DB lookup ─────────────────────────────────────────────── */

async function fetchOrgLimit(orgId: string): Promise<number> {
  const cached = orgLimitCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.rpm;

  try {
    const rows = await db.execute(
      sql`SELECT ai_rate_limit FROM ns_schema.organisations WHERE id = ${orgId} LIMIT 1`
    );
    const row  = (rows as any)?.rows?.[0] ?? (rows as any)?.[0];
    const rpm  = typeof row?.ai_rate_limit === 'number' ? row.ai_rate_limit : DEFAULT_RPM;
    orgLimitCache.set(orgId, { rpm, cachedAt: Date.now() });
    return rpm;
  } catch (err: any) {
    logger.warn('org_rate_limit_db_fallback', { orgId, err: String(err) });
    return DEFAULT_RPM;
  }
}

/* ── Public API ────────────────────────────────────────────── */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export const orgRateLimiter = {
  /**
   * Check whether `userId` within `orgId` may make an AI request.
   * Returns { allowed, remaining, resetAt, limit }.
   */
  async check(orgId: string, userId: string): Promise<RateLimitResult> {
    const limit  = await fetchOrgLimit(orgId);
    const key    = `${orgId}:${userId}`;
    const now    = Date.now();
    const entry  = requestStore.get(key);

    if (!entry || now > entry.resetAt) {
      requestStore.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS, limit };
    }

    if (entry.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt, limit };
    }

    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt, limit };
  },

  /**
   * Invalidate cached limit for an org (call after admin updates the limit).
   */
  invalidateCache(orgId: string): void {
    orgLimitCache.delete(orgId);
    logger.info('org_rate_limit_cache_invalidated', { orgId });
  },

  /**
   * Express middleware that reads orgId from req.user or req.headers.
   * Attaches rate-limit headers and returns 429 on exceeded.
   */
  middleware() {
    return async (req: any, res: any, next: any) => {
      if (shouldSkipPartnerProductRateLimits(req)) {
        res.setHeader('X-NSP-Unlimited', '1');
        res.setHeader('X-RateLimit-Limit', 'unlimited');
        res.setHeader('X-RateLimit-Remaining', 'unlimited');
        return next();
      }
      const user  = req.user as any;
      const orgId = user?.orgId || user?.tenantId || req.headers['x-org-id'] || 'default';
      const userId = String(user?.userId || user?.id || req.ip || 'anon');

      const result = await this.check(orgId, userId);

      res.setHeader('X-RateLimit-Limit',     result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset',     Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        res.status(429).json({
          success: false,
          error: `AI rate limit exceeded (${result.limit} req/min). Please wait.`,
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
        return;
      }

      next();
    };
  },
};
