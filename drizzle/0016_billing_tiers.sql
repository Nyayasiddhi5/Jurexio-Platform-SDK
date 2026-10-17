-- 0016_billing_tiers.sql (renamed from 0015 — collision resolved 2026-05-14T11:43Z)
-- Two-tier billing/limits model for the SDK fabric.
--
-- TIER 0 (PLATFORM × NYAYAVIGYA): every Nyayasiddhi ecosystem platform
--   (NSP, NSPM, NSI, NSA, NSM, NYM, JRX) signs a billing contract with
--   Nyayavigya for SDK access. That contract is recorded as a
--   `platform_tier` on the platform's sdk_applications row and resolves
--   to a hardcoded entry in src/config/nv-billing-tiers.ts (so we can
--   ship without a separate billing table for v1).
--
-- TIER 2 (CUSTOMER ORG × PLATFORM): each platform onboards downstream
--   customer firms and assigns them a tier of its own. The platform
--   already passes `tier` into POST /api/nv/sdk/customer-orgs (added
--   by task #343/#368). We now also persist optional per-customer
--   overrides for rate limit, daily / monthly token budgets, and
--   allowed agents — so a platform can either (a) rely on the named
--   tier's defaults, or (b) override individual values for a specific
--   firm without needing a custom tier.
--
-- Effective enforcement = min(PLATFORM tier limit, CUSTOMER_ORG limit).
-- See src/services/nv-billing-tier-service.ts.
--
-- All steps are additive + idempotent (NV-API-CONTRACT-001).

BEGIN;

-- ── Tier-0: platform's billing tier with Nyayavigya ──────────────────
ALTER TABLE sdk_applications
  ADD COLUMN IF NOT EXISTS platform_tier VARCHAR(50) NOT NULL DEFAULT 'standard';

-- ── Tier-2: per-customer-org limit overrides ─────────────────────────
ALTER TABLE nv_customer_organizations
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS daily_token_budget    INTEGER,
  ADD COLUMN IF NOT EXISTS monthly_token_budget  INTEGER,
  ADD COLUMN IF NOT EXISTS allowed_agents        JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS sdk_applications_platform_tier_idx
  ON sdk_applications (platform_tier);

CREATE INDEX IF NOT EXISTS nv_customer_organizations_tier_idx
  ON nv_customer_organizations (tier);

COMMIT;

-- Reversal (manual):
--   ALTER TABLE sdk_applications DROP COLUMN platform_tier;
--   ALTER TABLE nv_customer_organizations
--     DROP COLUMN rate_limit_per_minute,
--     DROP COLUMN daily_token_budget,
--     DROP COLUMN monthly_token_budget,
--     DROP COLUMN allowed_agents;
