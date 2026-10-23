/**
 * Jurexio Enterprise Platform SDK billing tier registry (v1, file-backed).
 *
 * Two independent tier sets:
 *   PLATFORM_TIERS   — Jurexio ↔ Jurexio-ecosystem platforms
 *                      (NSP, NSPM, NSI, NSA, NSM, NYM, JRX, partner)
 *                      controls how much SDK traffic the platform
 *                      itself may send to Jurexio.
 *   CUSTOMER_ORG_TIERS — Platform ↔ its downstream customer firms,
 *                      *projected to Jurexio* so we can also cap a
 *                      single customer-org's slice of the platform's
 *                      allotment.
 *
 * Effective enforcement at the gateway = min(platform tier, customer-org
 * tier, per-row override). See jrx-billing-tier-service.ts.
 *
 * Everything here is intentionally a plain TypeScript constant so the
 * agent / operator can review the matrix at code-review time. A future
 * task can move this into a `nv_billing_tiers` table without changing
 * any consumer (tier name → BillingTierLimits is the only contract).
 */

export interface BillingTierLimits {
  /** Calls per minute against the SDK gateway. */
  rateLimitPerMinute: number;
  /** Tokens (in + out) per UTC day across all SDK calls. */
  dailyTokenBudget: number;
  /** Tokens per UTC month. */
  monthlyTokenBudget: number;
  /** Optional cap on concurrent in-flight SDK requests (0 = uncapped). */
  maxConcurrent: number;
  /** Optional explicit list of allowed agent keys ([] = inherit, ['*'] = all). */
  allowedAgents: string[];
  /** Optional explicit list of allowed scopes ([] = inherit, ['*'] = all). */
  allowedScopes: string[];
  /** Human-readable label for Console / billing surfaces. */
  label: string;
  /** Free-form description (Console hover help). */
  description: string;
}

// ────────────────────────────────────────────────────────────────────
// TIER 0: Jurexio ↔ Platform contract
// ────────────────────────────────────────────────────────────────────
export const PLATFORM_TIERS: Record<string, BillingTierLimits> = {
  // Internal default for legacy rows where platform_tier was not set.
  // Keep generous so existing UAT traffic is unaffected.
  standard: {
    rateLimitPerMinute: 600,
    dailyTokenBudget:   2_000_000,
    monthlyTokenBudget: 40_000_000,
    maxConcurrent:      0,
    allowedAgents:      ['*'],
    allowedScopes:      ['*'],
    label:              'Standard',
    description:        'Default tier carried over from pre-tier rows; generous limits suitable for ongoing UAT.',
  },
  starter: {
    rateLimitPerMinute: 60,
    dailyTokenBudget:   200_000,
    monthlyTokenBudget: 4_000_000,
    maxConcurrent:      4,
    allowedAgents:      ['legal-research-*', 'contract-drafting-*', 'compliance-audit-*'],
    allowedScopes:      ['agents:run', 'orchestrate', 'rag:read'],
    label:              'Starter',
    description:        'For platforms in pilot — small daily allotment, restricted agent shelf.',
  },
  growth: {
    rateLimitPerMinute: 240,
    dailyTokenBudget:   800_000,
    monthlyTokenBudget: 16_000_000,
    maxConcurrent:      16,
    allowedAgents:      ['*'],
    allowedScopes:      ['agents:run', 'orchestrate', 'rag:*', 'governance:read'],
    label:              'Growth',
    description:        'Production tier for platforms with active paying customers.',
  },
  scale: {
    rateLimitPerMinute: 1200,
    dailyTokenBudget:   5_000_000,
    monthlyTokenBudget: 100_000_000,
    maxConcurrent:      64,
    allowedAgents:      ['*'],
    allowedScopes:      ['*'],
    label:              'Scale',
    description:        'High-volume platforms with dozens of customer firms.',
  },
  enterprise: {
    rateLimitPerMinute: 6000,
    dailyTokenBudget:   25_000_000,
    monthlyTokenBudget: 500_000_000,
    maxConcurrent:      256,
    allowedAgents:      ['*'],
    allowedScopes:      ['*'],
    label:              'Enterprise',
    description:        'Negotiated capacity for large ecosystem platforms (NSP/NSI scale).',
  },
};

// ────────────────────────────────────────────────────────────────────
// TIER 2: Platform ↔ Customer-org contract
// ────────────────────────────────────────────────────────────────────
export const CUSTOMER_ORG_TIERS: Record<string, BillingTierLimits> = {
  standard: {
    rateLimitPerMinute: 60,
    dailyTokenBudget:   100_000,
    monthlyTokenBudget: 2_000_000,
    maxConcurrent:      4,
    allowedAgents:      [],
    allowedScopes:      [],
    label:              'Standard',
    description:        'Default tier for newly-onboarded customer firms.',
  },
  trial: {
    rateLimitPerMinute: 20,
    dailyTokenBudget:   25_000,
    monthlyTokenBudget: 250_000,
    maxConcurrent:      2,
    allowedAgents:      [],
    allowedScopes:      [],
    label:              'Trial',
    description:        'Time-boxed evaluation tier with very low headroom.',
  },
  professional: {
    rateLimitPerMinute: 120,
    dailyTokenBudget:   400_000,
    monthlyTokenBudget: 8_000_000,
    maxConcurrent:      8,
    allowedAgents:      [],
    allowedScopes:      [],
    label:              'Professional',
    description:        'Standard paid tier for working law firms.',
  },
  business: {
    rateLimitPerMinute: 360,
    dailyTokenBudget:   1_500_000,
    monthlyTokenBudget: 30_000_000,
    maxConcurrent:      24,
    allowedAgents:      [],
    allowedScopes:      [],
    label:              'Business',
    description:        'Mid-market firms with multiple practice groups.',
  },
  enterprise: {
    rateLimitPerMinute: 1200,
    dailyTokenBudget:   8_000_000,
    monthlyTokenBudget: 160_000_000,
    maxConcurrent:      96,
    allowedAgents:      [],
    allowedScopes:      [],
    label:              'Enterprise',
    description:        'Top tier — large practices, captive in-house departments.',
  },
};

export type PlatformTierName = keyof typeof PLATFORM_TIERS;
export type CustomerOrgTierName = keyof typeof CUSTOMER_ORG_TIERS;

export function isPlatformTier(name: string | null | undefined): name is PlatformTierName {
  return !!name && Object.prototype.hasOwnProperty.call(PLATFORM_TIERS, name);
}

export function isCustomerOrgTier(name: string | null | undefined): name is CustomerOrgTierName {
  return !!name && Object.prototype.hasOwnProperty.call(CUSTOMER_ORG_TIERS, name);
}

export function listPlatformTierNames(): string[] {
  return Object.keys(PLATFORM_TIERS);
}

export function listCustomerOrgTierNames(): string[] {
  return Object.keys(CUSTOMER_ORG_TIERS);
}
