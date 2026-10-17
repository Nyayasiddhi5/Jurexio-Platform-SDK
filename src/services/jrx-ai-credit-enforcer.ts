// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NV AI Credit Cap Enforcer — Token Budget Enforcement (NV-B2 Fix)
 * @version 5.2.0
 *
 * Wires AI token budget enforcement directly into the request path.
 * Previously: usage was tracked but cap was never enforced → silent overuse.
 * Now:        enforce() is called BEFORE any LLM call; throws 429 if exceeded.
 *
 * Budget tiers (default — overridden by org.ai_rate_limit in DB):
 *   solo:       50,000 tokens/day
 *   plus:      200,000 tokens/day
 *   pro:       800,000 tokens/day
 *   enterprise: 5,000,000 tokens/day (effectively unlimited for most orgs)
 *   government: 10,000,000 tokens/day
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai-credit-enforcer');

// ── Default per-tier daily budgets (tokens) ──────────────────────────────────
const TIER_BUDGETS: Record<string, number> = {
  solo:        50_000,
  free:        10_000,
  plus:       200_000,
  pro:        800_000,
  elite:    2_000_000,
  enterprise: 5_000_000,
  government: 10_000_000,
};

const HOURLY_RATE_LIMITS: Record<string, number> = {
  solo:   50,
  free:   20,
  plus:  200,
  pro:   500,
  elite: 1_000,
  enterprise: 5_000,
  government: 10_000,
};

/**
 * NV-CREDIT-COST-DIM-001 — blended USD/1k-token rate used to DERIVE each tier's
 * daily money budget from its existing token budget.
 *
 * Deriving rather than inventing matters: 13 paid surfaces (embeddings, STT, TTS,
 * off-ring vision) spend money without consuming chat tokens, so they cannot be
 * metered by TIER_BUDGETS at all. A second, independently-chosen money number
 * would be a second policy nobody agreed to. Pricing the tier's own token budget
 * at the platform's default model rate keeps one policy expressed in two units,
 * so an embedding call and a completion call draw down the same wallet.
 *
 * 0.00475 = gpt-4o at a 70/30 input/output split
 * (0.7 × $0.0025 + 0.3 × $0.0100 per 1k), from nv-llm-pricing.ts.
 */
const BLENDED_USD_PER_1K_TOKENS = Number(
  process.env.NYV_CREDIT_BLENDED_USD_PER_1K || 0.00475,
);

/** Micro-USD (1e-6 USD) is the resolution `ai_credit_usage.cost_usd` already stores. */
export const MICRO_USD_PER_USD = 1_000_000;

function tierCostBudgetMicroUsd(tier: string): number {
  const tokens = TIER_BUDGETS[tier] ?? TIER_BUDGETS.solo;
  return Math.round((tokens / 1000) * BLENDED_USD_PER_1K_TOKENS * MICRO_USD_PER_USD);
}

/** Which limit produced a refusal. Lets an observe-mode log line name the lever. */
export type CreditLimitKind = 'daily_tokens' | 'daily_cost' | 'hourly_requests';

export interface CreditCheckResult {
  allowed: boolean;
  reason?: string;
  budgetLimit: number;
  usedToday: number;
  remainingToday: number;
  tier: string;
  retryAfterSeconds?: number;
  /**
   * Set only on a refusal. A token overage and an hourly-request overage are not
   * the same event and must not be counted together when tuning budgets; the
   * `reason` string is prose and cannot be aggregated.
   */
  limit?: CreditLimitKind;
  /** Populated for `limit === 'hourly_requests'`. */
  hourlyRequests?: number;
  hourlyLimit?: number;
  /**
   * NV-CREDIT-COST-DIM-001 — money dimension. Present only when the caller asked
   * for it by passing `estimatedCostMicroUsd`, so every pre-existing token-only
   * call site is byte-for-byte unchanged.
   */
  costBudgetMicroUsd?: number;
  costUsedTodayMicroUsd?: number;
  costRemainingMicroUsd?: number;
}

export interface UsageRecord {
  userId: string;
  orgId?: string;
  tier: string;
  tokensUsed: number;
  agentKey: string;
  jurisdiction?: string;
  model?: string;
  requestId: string;
  costUsd?: number;
}

// ── Ensure credit tables exist ────────────────────────────────────────────────
let tablesEnsured = false;
async function ensureCreditTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    const { ensureNvSchemaTables } = await import('../db/jrx-ensure-schema.js');
    await ensureNvSchemaTables(db as any);
    tablesEnsured = true;
    logger.info('credit_tables_ensured');
  } catch (e: any) {
    logger.warn('credit_tables_ensure_failed', { error: e.message });
  }
}

// ── Get org-level budget override from DB ─────────────────────────────────────
async function getOrgBudget(orgId: string): Promise<number | null> {
  try {
    const result = await db.execute(sql`
      SELECT daily_token_budget FROM nv_schema.ai_credit_overrides WHERE org_id = ${orgId} LIMIT 1
    `);
    const row = result.rows?.[0] as any;
    return row?.daily_token_budget ? Number(row.daily_token_budget) : null;
  } catch {
    return null;
  }
}

// ── Get tokens used today (UTC day) — Redis L1 → process Map → PG (ms hot-path) ─
const usedTodayL1 = new Map<string, { value: number; at: number }>();
const USED_TODAY_TTL_MS = Math.max(5_000, Number(process.env.NYV_CREDIT_CACHE_TTL_MS || 15_000));

function creditCacheKey(userId: string, orgId?: string): string {
  return orgId ? `org:${orgId}` : `user:${userId}`;
}

function redisCreditKey(userId: string, orgId?: string): string {
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const scope = orgId ? `org:${orgId}` : `user:${userId}`;
  return `nyv:credit:used:${scope}:${day}`;
}

function secondsUntilUtcMidnight(): number {
  const now = Date.now();
  const end = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1,
    0, 0, 0, 0,
  );
  return Math.max(60, Math.ceil((end - now) / 1000));
}

async function getRedisCreditClient(): Promise<{
  get(key: string): Promise<string | null>;
  incrby(key: string, n: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>;
} | null> {
  if (process.env.NYV_CREDIT_REDIS_L1 === '0') return null;
  try {
    const { resolveRedisTcpUrl, logRedisDisabledOnce } = await import('../utils/redis-tcp-url.js');
    const r = resolveRedisTcpUrl();
    if (!r.enabled || !r.url) {
      logRedisDisabledOnce('ai-credit-l1', r.reason ?? 'no TCP url');
      return null;
    }
    const ioredisMod = await import('ioredis');
    const IORedis = (ioredisMod as { default?: unknown }).default ?? ioredisMod;
    const Ctor = IORedis as unknown as new (url: string, opts: Record<string, unknown>) => any;
    if (!(getRedisCreditClient as any)._client) {
      (getRedisCreditClient as any)._client = new Ctor(r.url, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: true,
        connectTimeout: 3000,
      });
      (getRedisCreditClient as any)._client.on('error', () => { /* non-fatal */ });
    }
    return (getRedisCreditClient as any)._client;
  } catch {
    return null;
  }
}

async function getUsedToday(userId: string, orgId?: string): Promise<number> {
  const key = creditCacheKey(userId, orgId);
  const l1 = usedTodayL1.get(key);
  if (l1 && Date.now() - l1.at < USED_TODAY_TTL_MS) return l1.value;

  // NV-CREDIT-REDIS-L1-001 — shared multi-pod hot counter (PG remains SoT)
  try {
    const redis = await getRedisCreditClient();
    if (redis) {
      const rk = redisCreditKey(userId, orgId);
      const raw = await redis.get(rk);
      if (raw != null && Number.isFinite(Number(raw))) {
        const n = Number(raw);
        usedTodayL1.set(key, { value: n, at: Date.now() });
        return n;
      }
    }
  } catch { /* fall through to PG */ }

  try {
    await ensureCreditTables();
    const scope = orgId
      ? sql`org_id = ${orgId}`
      : sql`user_id = ${userId}`;

    const result = await db.execute(sql`
      SELECT COALESCE(SUM(tokens_used), 0)::BIGINT AS total
      FROM nv_schema.ai_credit_usage
      WHERE ${scope}
        AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    `);
    const n = Number((result.rows?.[0] as any)?.total || 0);
    usedTodayL1.set(key, { value: n, at: Date.now() });
    // Seed Redis from PG so all pods share the same L1
    try {
      const redis = await getRedisCreditClient();
      if (redis) {
        const rk = redisCreditKey(userId, orgId);
        await redis.set(rk, String(n), 'EX', secondsUntilUtcMidnight());
      }
    } catch { /* non-fatal */ }
    return n;
  } catch {
    return 0;
  }
}

async function invalidateUsedTodayCache(userId: string, orgId?: string, addTokens = 0): Promise<void> {
  const key = creditCacheKey(userId, orgId);
  const cur = usedTodayL1.get(key);
  if (cur && addTokens > 0) {
    usedTodayL1.set(key, { value: cur.value + addTokens, at: Date.now() });
  } else {
    usedTodayL1.delete(key);
  }
  if (addTokens > 0) {
    try {
      const redis = await getRedisCreditClient();
      if (redis) {
        const rk = redisCreditKey(userId, orgId);
        const next = await redis.incrby(rk, addTokens);
        if (next === addTokens) {
          // First write of the day — set TTL to UTC midnight
          await redis.expire(rk, secondsUntilUtcMidnight());
        }
      }
    } catch { /* non-fatal — PG SoT */ }
  }
}

// ── Get micro-USD spent today (UTC day) — NV-CREDIT-COST-DIM-001 ─────────────
/**
 * Sums the `cost_usd` column the recorder already writes, so the money dimension
 * needs no new table and no new writer. Deliberately NOT Redis-cached: the token
 * counter has a hot L1 because `enforce()` is on every LLM request's critical
 * path, whereas the cost dimension is consulted only by the non-token surfaces.
 * A second cache would be a second place for the two dimensions to disagree.
 */
async function getCostUsedTodayMicroUsd(userId: string, orgId?: string): Promise<number> {
  try {
    await ensureCreditTables();
    const scope = orgId ? sql`org_id = ${orgId}` : sql`user_id = ${userId}`;
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(cost_usd), 0)::NUMERIC AS total
      FROM nv_schema.ai_credit_usage
      WHERE ${scope}
        AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    `);
    const usd = Number((result.rows?.[0] as any)?.total || 0);
    return Math.max(0, Math.round(usd * MICRO_USD_PER_USD));
  } catch {
    return 0;
  }
}

// ── Get request count in last hour ───────────────────────────────────────────
async function getHourlyRequests(userId: string): Promise<number> {  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM nv_schema.ai_credit_usage
      WHERE user_id = ${userId}
        AND created_at >= NOW() - INTERVAL '1 hour'
    `);
    return Number((result.rows?.[0] as any)?.cnt || 0);
  } catch {
    return 0;
  }
}

// ── Main Enforcer Class ───────────────────────────────────────────────────────

export class NVAICreditEnforcer {
  /**
   * Check if a user/org is within their AI token budget before making an LLM call.
   * Throws a structured error if budget is exceeded.
   */
  async enforce(params: {
    userId: string;
    orgId?: string;
    tier: string;
    estimatedTokens: number;
    agentKey?: string;
    /** When true (NSP/NYM demo), skip daily/hourly product caps. */
    bypassCaps?: boolean;
    /**
     * NV-CREDIT-COST-DIM-001 — money cost of this call in integer micro-USD, for
     * the paid surfaces that consume no chat tokens (embeddings, STT, TTS, OCR).
     * Omit it and this method behaves exactly as before.
     *
     * Pass 0 — not a guess — when the real cost is genuinely unknowable before the
     * call (an OCR page count, an audio duration we have not decoded). A wrong
     * estimate that refuses a lawful request is worse than no estimate; the
     * post-spend recorder still writes the true cost, so the *next* request is
     * metered honestly.
     */
    estimatedCostMicroUsd?: number;
  }): Promise<CreditCheckResult> {
    await ensureCreditTables();
    const { userId, orgId, tier, estimatedTokens } = params;
    const wantsCostDimension = typeof params.estimatedCostMicroUsd === 'number';
    const estimatedCostMicroUsd = Math.max(0, Math.floor(Number(params.estimatedCostMicroUsd) || 0));

    // Global escape: NYV_CREDIT_ENFORCE=0 | NYV_PARTNER_DEMO_UNLIMITED handled by callers via bypassCaps.
    const enforceOff = String(process.env.NYV_CREDIT_ENFORCE ?? '1').trim().toLowerCase();
    if (enforceOff === '0' || enforceOff === 'false' || enforceOff === 'off' || params.bypassCaps) {
      const budgetLimit = TIER_BUDGETS.government;
      const bypassed: CreditCheckResult = {
        allowed: true,
        budgetLimit,
        usedToday: 0,
        remainingToday: budgetLimit,
        tier: params.bypassCaps ? 'demo_unlimited' : tier,
      };
      if (wantsCostDimension) {
        const costBudgetMicroUsd = tierCostBudgetMicroUsd('government');
        bypassed.costBudgetMicroUsd = costBudgetMicroUsd;
        bypassed.costUsedTodayMicroUsd = 0;
        bypassed.costRemainingMicroUsd = costBudgetMicroUsd;
      }
      return bypassed;
    }

    const baseBudget = TIER_BUDGETS[tier] ?? TIER_BUDGETS.solo;
    const orgOverride = orgId ? await getOrgBudget(orgId) : null;
    const budgetLimit = orgOverride ?? baseBudget;

    const usedToday = await getUsedToday(userId, orgId);
    const remainingToday = Math.max(0, budgetLimit - usedToday);

    const costBudgetMicroUsd = wantsCostDimension
      ? Math.round((budgetLimit / 1000) * BLENDED_USD_PER_1K_TOKENS * MICRO_USD_PER_USD)
      : 0;
    const costUsedTodayMicroUsd = wantsCostDimension
      ? await getCostUsedTodayMicroUsd(userId, orgId)
      : 0;
    const costRemainingMicroUsd = Math.max(0, costBudgetMicroUsd - costUsedTodayMicroUsd);
    const costFields = wantsCostDimension
      ? { costBudgetMicroUsd, costUsedTodayMicroUsd, costRemainingMicroUsd }
      : {};

    // Check daily budget
    if (usedToday + estimatedTokens > budgetLimit) {
      logger.warn('credit_budget_exceeded', { userId, orgId, tier, usedToday, budgetLimit, estimatedTokens });
      return {
        allowed: false,
        reason: `Daily token budget exceeded. Used: ${usedToday.toLocaleString()}, Limit: ${budgetLimit.toLocaleString()}. Resets at midnight UTC.`,
        budgetLimit,
        usedToday,
        remainingToday,
        tier,
        limit: 'daily_tokens',
        retryAfterSeconds: Math.ceil((new Date().setHours(24,0,0,0) - Date.now()) / 1000),
        ...costFields,
      };
    }

    // NV-CREDIT-COST-DIM-001 — money dimension for the non-token surfaces.
    // Checked only when the caller supplied a cost; a zero estimate (cost not
    // measurable pre-spend) can still refuse once the day's recorded spend has
    // already passed the budget, which is honest: that overage is measured, not
    // guessed.
    if (wantsCostDimension && costUsedTodayMicroUsd + estimatedCostMicroUsd > costBudgetMicroUsd) {
      logger.warn('credit_cost_budget_exceeded', {
        userId, orgId, tier, costUsedTodayMicroUsd, costBudgetMicroUsd, estimatedCostMicroUsd,
      });
      return {
        allowed: false,
        reason: `Daily AI cost budget exceeded. Used: $${(costUsedTodayMicroUsd / MICRO_USD_PER_USD).toFixed(4)}, Limit: $${(costBudgetMicroUsd / MICRO_USD_PER_USD).toFixed(4)}. Resets at midnight UTC.`,
        budgetLimit,
        usedToday,
        remainingToday,
        tier,
        limit: 'daily_cost',
        retryAfterSeconds: secondsUntilUtcMidnight(),
        ...costFields,
      };
    }

    // Check hourly rate limit
    const hourlyLimit = HOURLY_RATE_LIMITS[tier] ?? 50;
    const hourlyRequests = await getHourlyRequests(userId);
    if (hourlyRequests >= hourlyLimit) {
      logger.warn('credit_rate_limit_exceeded', { userId, tier, hourlyRequests, hourlyLimit });
      return {
        allowed: false,
        reason: `Hourly request limit exceeded (${hourlyRequests}/${hourlyLimit}). Please wait before making more AI requests.`,
        budgetLimit,
        usedToday,
        remainingToday,
        tier,
        limit: 'hourly_requests',
        hourlyRequests,
        hourlyLimit,
        retryAfterSeconds: 3600,
        ...costFields,
      };
    }

    return {
      allowed: true,
      budgetLimit,
      usedToday,
      remainingToday,
      tier,
      ...costFields,
    };
  }

  /**
   * Record actual token usage AFTER a successful LLM call.
   */
  async record(record: UsageRecord): Promise<void> {
    await ensureCreditTables();
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.ai_credit_usage
          (user_id, org_id, tier, tokens_used, agent_key, jurisdiction, model, request_id, cost_usd)
        VALUES
          (${record.userId}, ${record.orgId || null}, ${record.tier}, ${record.tokensUsed},
           ${record.agentKey || null}, ${record.jurisdiction || null}, ${record.model || null},
           ${record.requestId}, ${record.costUsd || 0})
      `);
      await invalidateUsedTodayCache(record.userId, record.orgId, record.tokensUsed);
    } catch (e: any) {
      logger.warn('credit_record_failed', { error: e.message, userId: record.userId });
    }
  }

  /**
   * Get usage summary for a user/org — daily + monthly breakdown.
   */
  async getSummary(userId: string, orgId?: string, startDate?: string, endDate?: string): Promise<{
    daily: { tokensUsed: number; requestCount: number; estimatedCostUsd: string };
    monthly: { tokensUsed: number; requestCount: number; estimatedCostUsd: string };
    hourly: { requestCount: number };
    budgetStatus: { tier: string; budgetLimit: number; usedToday: number; remainingToday: number; percentUsed: number };
  }> {
    await ensureCreditTables();
    const scope = orgId ? sql`org_id = ${orgId}` : sql`user_id = ${userId}`;

    const [dailyResult, monthlyResult, hourlyResult] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(SUM(tokens_used),0)::BIGINT as tokens,
               COUNT(*)::INT as cnt,
               COALESCE(SUM(cost_usd),0)::NUMERIC as cost
        FROM nv_schema.ai_credit_usage
        WHERE ${scope}
          AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
      `).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT COALESCE(SUM(tokens_used),0)::BIGINT as tokens,
               COUNT(*)::INT as cnt,
               COALESCE(SUM(cost_usd),0)::NUMERIC as cost
        FROM nv_schema.ai_credit_usage
        WHERE ${scope}
          AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
      `).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT COUNT(*)::INT as cnt
        FROM nv_schema.ai_credit_usage
        WHERE user_id = ${userId}
          AND created_at >= NOW() - INTERVAL '1 hour'
      `).catch(() => ({ rows: [] })),
    ]);

    const daily = (dailyResult.rows?.[0] as any) || {};
    const monthly = (monthlyResult.rows?.[0] as any) || {};
    const hourly = (hourlyResult.rows?.[0] as any) || {};

    const usedToday = Number(daily.tokens || 0);
    const budgetLimit = TIER_BUDGETS['pro'];  // default — real tier passed by caller
    const percentUsed = budgetLimit > 0 ? Math.round((usedToday / budgetLimit) * 100) : 0;

    return {
      daily: {
        tokensUsed: usedToday,
        requestCount: Number(daily.cnt || 0),
        estimatedCostUsd: Number(daily.cost || 0).toFixed(4),
      },
      monthly: {
        tokensUsed: Number(monthly.tokens || 0),
        requestCount: Number(monthly.cnt || 0),
        estimatedCostUsd: Number(monthly.cost || 0).toFixed(4),
      },
      hourly: {
        requestCount: Number(hourly.cnt || 0),
      },
      budgetStatus: {
        tier: 'pro',
        budgetLimit,
        usedToday,
        remainingToday: Math.max(0, budgetLimit - usedToday),
        percentUsed,
      },
    };
  }

  /**
   * Set org-level budget override.
   */
  async setOrgBudget(orgId: string, dailyBudget: number, hourlyLimit: number = 500): Promise<void> {
    await ensureCreditTables();
    await db.execute(sql`
      INSERT INTO nv_schema.ai_credit_overrides (org_id, daily_token_budget, hourly_request_limit, updated_at)
      VALUES (${orgId}, ${dailyBudget}, ${hourlyLimit}, NOW())
      ON CONFLICT (org_id) DO UPDATE
        SET daily_token_budget = ${dailyBudget},
            hourly_request_limit = ${hourlyLimit},
            updated_at = NOW()
    `);
    logger.info('org_budget_set', { orgId, dailyBudget, hourlyLimit });
  }

  /**
   * Get top consumers for an org (analytics).
   */
  async getTopConsumers(orgId: string, limit: number = 10): Promise<Array<{
    userId: string; tokensUsed: number; requestCount: number; avgTokensPerRequest: number;
  }>> {
    try {
      await ensureCreditTables();
      const result = await db.execute(sql`
        SELECT user_id,
               SUM(tokens_used)::BIGINT as tokens_used,
               COUNT(*)::INT as request_count,
               (SUM(tokens_used) / NULLIF(COUNT(*), 0))::INT as avg_tokens
        FROM nv_schema.ai_credit_usage
        WHERE org_id = ${orgId}
          AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
        GROUP BY user_id
        ORDER BY tokens_used DESC
        LIMIT ${limit}
      `);
      return (result.rows || []).map((r: any) => ({
        userId: r.user_id,
        tokensUsed: Number(r.tokens_used),
        requestCount: Number(r.request_count),
        avgTokensPerRequest: Number(r.avg_tokens),
      }));
    } catch {
      return [];
    }
  }
}

export const nvAICreditEnforcer = new NVAICreditEnforcer();
