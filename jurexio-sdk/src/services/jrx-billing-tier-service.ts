/**
 * Jurexio billing-tier resolution service.
 *
 * Single source of truth for "what limits apply to this caller right
 * now". Reads the platform tier from sdk_applications.platform_tier,
 * the customer-org tier (+ optional per-row overrides) from
 * nv_customer_organizations, and returns a merged EffectiveLimits
 * object that is the min() of both sides on every numeric dimension.
 *
 * Consumers:
 *   - GET /api/jrx/sdk/platform/limits          (this platform's allotment)
 *   - GET /api/jrx/sdk/customer-orgs/:id/limits (one customer-firm's slice)
 *   - src/middleware/jrx-sdk-gateway.ts         (enforcement at request entry)
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  PLATFORM_TIERS,
  CUSTOMER_ORG_TIERS,
  isPlatformTier,
  isCustomerOrgTier,
  type BillingTierLimits,
} from '../config/jrx-billing-tiers.js';

export interface PlatformLimitsView {
  platformId: number;
  appName: string | null;
  tierName: string;
  tier: BillingTierLimits;
  source: 'sdk_applications.platform_tier';
}

export interface CustomerOrgLimitsView {
  customerOrgId: number;
  platformId: number;
  externalRef: string;
  displayName: string | null;
  tierName: string;
  tier: BillingTierLimits;
  /** Per-row overrides applied on top of the named tier (null = inherit). */
  overrides: {
    rateLimitPerMinute: number | null;
    dailyTokenBudget: number | null;
    monthlyTokenBudget: number | null;
    allowedAgents: string[] | null;
  };
  /** Final values after overrides. Same shape as BillingTierLimits but post-override. */
  resolved: BillingTierLimits;
}

export interface EffectiveLimits extends BillingTierLimits {
  reasons: {
    rateLimitPerMinute: 'platform' | 'customer_org';
    dailyTokenBudget:   'platform' | 'customer_org';
    monthlyTokenBudget: 'platform' | 'customer_org';
    maxConcurrent:      'platform' | 'customer_org';
  };
}

function pickMinNumeric<K extends 'rateLimitPerMinute' | 'dailyTokenBudget' | 'monthlyTokenBudget' | 'maxConcurrent'>(
  platform: BillingTierLimits,
  customerOrg: BillingTierLimits | null,
  key: K,
): { value: number; source: 'platform' | 'customer_org' } {
  const p = platform[key];
  if (!customerOrg) return { value: p, source: 'platform' };
  const c = customerOrg[key];
  // For `maxConcurrent` ONLY, 0 has the documented meaning "uncapped",
  // so we let the other side win when one is 0. For every other
  // dimension a 0 is a real, contractual hard-cap (e.g. emergency stop
  // / paid-tier-revoked) and MUST NOT be silently overridden by a
  // non-zero side — that would violate the declared min(...) contract.
  if (key === 'maxConcurrent') {
    if (p === 0) return { value: c, source: 'customer_org' };
    if (c === 0) return { value: p, source: 'platform' };
  }
  return c < p ? { value: c, source: 'customer_org' } : { value: p, source: 'platform' };
}

function intersectStringList(platform: string[], customerOrg: string[]): string[] {
  // [] on customerOrg means "inherit", [*] means "all".
  if (!customerOrg.length || (customerOrg.length === 1 && customerOrg[0] === '*')) return platform;
  if (platform.length === 1 && platform[0] === '*') return customerOrg;
  const set = new Set(platform);
  return customerOrg.filter(x => set.has(x));
}

export function resolvePlatformTier(tierName: string | null | undefined): { name: string; tier: BillingTierLimits } {
  const name = isPlatformTier(tierName) ? tierName : 'standard';
  return { name, tier: PLATFORM_TIERS[name] };
}

export function resolveCustomerOrgTier(
  tierName: string | null | undefined,
  overrides: {
    rateLimitPerMinute: number | null;
    dailyTokenBudget: number | null;
    monthlyTokenBudget: number | null;
    allowedAgents: string[] | null;
  },
): { name: string; tier: BillingTierLimits; resolved: BillingTierLimits } {
  const name = isCustomerOrgTier(tierName) ? tierName : 'standard';
  const tier = CUSTOMER_ORG_TIERS[name];
  const resolved: BillingTierLimits = {
    ...tier,
    rateLimitPerMinute: overrides.rateLimitPerMinute ?? tier.rateLimitPerMinute,
    dailyTokenBudget:   overrides.dailyTokenBudget   ?? tier.dailyTokenBudget,
    monthlyTokenBudget: overrides.monthlyTokenBudget ?? tier.monthlyTokenBudget,
    allowedAgents:      overrides.allowedAgents      ?? tier.allowedAgents,
  };
  return { name, tier, resolved };
}

export function computeEffectiveLimits(
  platform: BillingTierLimits,
  customerOrg: BillingTierLimits | null,
): EffectiveLimits {
  const rl = pickMinNumeric(platform, customerOrg, 'rateLimitPerMinute');
  const dt = pickMinNumeric(platform, customerOrg, 'dailyTokenBudget');
  const mt = pickMinNumeric(platform, customerOrg, 'monthlyTokenBudget');
  const mc = pickMinNumeric(platform, customerOrg, 'maxConcurrent');
  const allowedAgents = customerOrg
    ? intersectStringList(platform.allowedAgents, customerOrg.allowedAgents)
    : platform.allowedAgents;
  const allowedScopes = customerOrg
    ? intersectStringList(platform.allowedScopes, customerOrg.allowedScopes)
    : platform.allowedScopes;
  return {
    rateLimitPerMinute: rl.value,
    dailyTokenBudget:   dt.value,
    monthlyTokenBudget: mt.value,
    maxConcurrent:      mc.value,
    allowedAgents,
    allowedScopes,
    label:              customerOrg
      ? `effective(${platform.label} ∩ ${customerOrg.label})`
      : platform.label,
    description:        'Effective limits = min(platform tier, customer-org tier+overrides) per dimension.',
    reasons: {
      rateLimitPerMinute: rl.source,
      dailyTokenBudget:   dt.source,
      monthlyTokenBudget: mt.source,
      maxConcurrent:      mc.source,
    },
  };
}

// ── DB-backed lookups ───────────────────────────────────────────────

export async function loadPlatformLimits(applicationId: number): Promise<PlatformLimitsView | null> {
  if (!db) throw new Error('db not initialized');
  const r = await db.execute<{
    id: number;
    app_name: string | null;
    platform_tier: string | null;
  }>(sql`SELECT id, app_name, platform_tier FROM sdk_applications WHERE id = ${applicationId} LIMIT 1`);
  const row = r.rows?.[0];
  if (!row) return null;
  const { name, tier } = resolvePlatformTier(row.platform_tier);
  return {
    platformId: row.id,
    appName: row.app_name,
    tierName: name,
    tier,
    source: 'sdk_applications.platform_tier',
  };
}

export async function loadCustomerOrgLimits(customerOrgId: number, expectedPlatformId?: number): Promise<CustomerOrgLimitsView | null> {
  if (!db) throw new Error('db not initialized');
  const r = await db.execute<{
    id: number;
    platform_id: number;
    external_ref: string;
    display_name: string | null;
    tier: string | null;
    rate_limit_per_minute: number | null;
    daily_token_budget: number | null;
    monthly_token_budget: number | null;
    allowed_agents: string[] | null;
  }>(sql`
    SELECT id, platform_id, external_ref, display_name, tier,
           rate_limit_per_minute, daily_token_budget, monthly_token_budget,
           allowed_agents
      FROM nv_customer_organizations
     WHERE id = ${customerOrgId}
     LIMIT 1`);
  const row = r.rows?.[0];
  if (!row) return null;
  if (expectedPlatformId != null && row.platform_id !== expectedPlatformId) return null;
  const overrides = {
    rateLimitPerMinute: row.rate_limit_per_minute,
    dailyTokenBudget:   row.daily_token_budget,
    monthlyTokenBudget: row.monthly_token_budget,
    allowedAgents:      Array.isArray(row.allowed_agents) && row.allowed_agents.length > 0 ? row.allowed_agents : null,
  };
  const { name, tier, resolved } = resolveCustomerOrgTier(row.tier, overrides);
  return {
    customerOrgId: row.id,
    platformId: row.platform_id,
    externalRef: row.external_ref,
    displayName: row.display_name,
    tierName: name,
    tier,
    overrides,
    resolved,
  };
}

export async function loadEffectiveLimitsFor(
  applicationId: number,
  customerOrgId: number | null,
): Promise<{
  platform: PlatformLimitsView;
  customerOrg: CustomerOrgLimitsView | null;
  effective: EffectiveLimits;
} | null> {
  const platform = await loadPlatformLimits(applicationId);
  if (!platform) return null;
  let customerOrgView: CustomerOrgLimitsView | null = null;
  if (customerOrgId != null) {
    customerOrgView = await loadCustomerOrgLimits(customerOrgId, platform.platformId);
  }
  const effective = computeEffectiveLimits(platform.tier, customerOrgView?.resolved ?? null);
  return { platform, customerOrg: customerOrgView, effective };
}

// ── Today's usage (for UI / enforcement context) ───────────────────

export interface UsageSnapshot {
  windowStart: string;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  requestCount: number;
}

export async function loadTodaysUsageForPlatform(applicationId: number): Promise<UsageSnapshot> {
  if (!db) throw new Error('db not initialized');
  const r = await db.execute<{ tokens_in: string | null; tokens_out: string | null; req_count: string | null }>(sql`
    SELECT COALESCE(SUM(tokens_in),0)::bigint  AS tokens_in,
           COALESCE(SUM(tokens_out),0)::bigint AS tokens_out,
           COALESCE(SUM(request_count),0)::bigint AS req_count
      FROM sdk_usage_metering
     WHERE application_id = ${applicationId}
       AND recorded_at >= date_trunc('day', NOW())`);
  const row = r.rows?.[0] ?? { tokens_in: '0', tokens_out: '0', req_count: '0' };
  const tIn = Number(row.tokens_in ?? 0);
  const tOut = Number(row.tokens_out ?? 0);
  return {
    windowStart: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString(),
    tokensIn: tIn,
    tokensOut: tOut,
    tokensTotal: tIn + tOut,
    requestCount: Number(row.req_count ?? 0),
  };
}

export async function loadTodaysUsageForCustomerOrg(applicationId: number, customerOrgId: number): Promise<UsageSnapshot> {
  if (!db) throw new Error('db not initialized');
  // Two-source rollup so we still capture metering rows that don't yet
  // carry customer_org_id (best-effort backfill ran in 0012 + 0013).
  const r = await db.execute<{ tokens_in: string | null; tokens_out: string | null; req_count: string | null }>(sql`
    SELECT COALESCE(SUM(tokens_in),0)::bigint  AS tokens_in,
           COALESCE(SUM(tokens_out),0)::bigint AS tokens_out,
           COALESCE(SUM(request_count),0)::bigint AS req_count
      FROM sdk_usage_metering
     WHERE application_id = ${applicationId}
       AND customer_org_id = ${customerOrgId}
       AND recorded_at >= date_trunc('day', NOW())`);
  const row = r.rows?.[0] ?? { tokens_in: '0', tokens_out: '0', req_count: '0' };
  const tIn = Number(row.tokens_in ?? 0);
  const tOut = Number(row.tokens_out ?? 0);
  return {
    windowStart: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString(),
    tokensIn: tIn,
    tokensOut: tOut,
    tokensTotal: tIn + tOut,
    requestCount: Number(row.req_count ?? 0),
  };
}
