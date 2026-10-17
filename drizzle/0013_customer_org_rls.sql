-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0013_customer_org_rls — Task #355 (2026-05-13)
--
-- Defence-in-depth phase 2: enable Postgres Row Level Security on the seven
-- TENANT-SCOPED hot-path tables, keyed off the two-tier identity asserted by
-- the SDK gateway:
--
--   • nv.platform_id      — sdk_applications.id     (the SDK customer)
--   • nv.customer_org_id  — nv_customer_organizations.id (their downstream tenant)
--
-- Application code already filters by these two columns; this migration makes
-- the database itself the second line of defence so a single forgotten WHERE
-- clause becomes an EMPTY RESULT set instead of a cross-tenant leak.
--
-- Tables covered (the only ones with the (platform_id, customer_org_id) pair
-- backfilled by 0012_customer_organizations.sql):
--
--   sdk_api_request_logs    application_id + customer_org_id
--   sdk_usage_metering      application_id + customer_org_id
--   sdk_workflows           application_id + customer_org_id
--   sdk_workflow_executions application_id + customer_org_id
--   nv_hitl_queue           org_id         + customer_org_id   (no app id col)
--   nv_hitl_decisions       customer_org_id only (joined to queue for org)
--   nv_cam_actions          org_id         + customer_org_id
--
-- For the four sdk_* tables the policy is a strict AND of both GUCs. For the
-- HITL/CAM tables we filter on customer_org_id alone — its id space is
-- disjoint per platform by construction (synthetic default = platform_id ×
-- 1_000_000, see 0012_customer_organizations.sql), so a customer_org_id match
-- already implies a unique platform.
--
-- Phased rollout (mirrors 0004_enable_rls_for_tenant_tables.sql):
--   • Policies are ALWAYS installed (idempotent). They sit dormant on tables
--     that do not have RLS enabled.
--   • ENABLE / FORCE ROW LEVEL SECURITY is gated on the session GUC
--     `app.nyv_rls_enforce = 'true'`. The migration runner
--     (`scripts/jrx-migrate.ts`) sets this from `process.env.JRX_RLS_ENFORCE`,
--     so operators flip enforcement ON only after every DB call site has
--     been wired through `req.withSdkTenant(fn)` / `withSdkTenantTx(...)`.
--   • Default (flag unset / 'false'): policies installed, RLS NOT enabled,
--     existing app behaviour unchanged. Safe to deploy.
--   • Enforce ('true'): strict RLS kicks in; un-bound sessions see zero rows.
--
-- The empty-string default initialised by `attachTenantContextDefault()` in
-- src/db/index.ts evaluates to `<int>::text = ''` → false → zero rows visible
-- on any table. This is the intentional fail-closed behaviour.
--
-- Maintenance jobs (cron, migrations, BI exports) MUST connect as a dedicated
-- Postgres role with the `BYPASSRLS` attribute (see task #42 follow-up), OR
-- explicitly bind a tenant via `withSdkTenantTx(platformId, customerOrgId, fn)`.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sentinel table for the live cross-tenant test
-- (tests/unit/security/rls.test.ts). Mirrors `nv_rls_sentinel` from 0004 but
-- carries the two-tier (platform_id, customer_org_id) shape so the new policy
-- is exercisable end-to-end against a real Postgres.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nv_rls_sentinel_v2 (
  id              SERIAL PRIMARY KEY,
  platform_id     INTEGER NOT NULL,
  customer_org_id BIGINT  NOT NULL,
  payload         TEXT    NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP POLICY IF EXISTS tenant_isolation_v2 ON nv_rls_sentinel_v2;
CREATE POLICY tenant_isolation_v2 ON nv_rls_sentinel_v2
  USING      (platform_id::text     = current_setting('nv.platform_id', true)
         AND customer_org_id::text = current_setting('nv.customer_org_id', true))
  WITH CHECK (platform_id::text     = current_setting('nv.platform_id', true)
         AND customer_org_id::text = current_setting('nv.customer_org_id', true));

DO $$
BEGIN
  IF coalesce(current_setting('app.nyv_rls_enforce', true), 'false') = 'true' THEN
    ALTER TABLE nv_rls_sentinel_v2 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nv_rls_sentinel_v2 FORCE  ROW LEVEL SECURITY;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies on the four sdk_* tables — strict AND of (application_id, customer_org_id).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  enforce boolean := coalesce(current_setting('app.nyv_rls_enforce', true), 'false') = 'true';
  rec     RECORD;
BEGIN
  FOR rec IN
    SELECT tname FROM (VALUES
      ('sdk_api_request_logs'),
      ('sdk_usage_metering'),
      ('sdk_workflows'),
      ('sdk_workflow_executions')
    ) AS t(tname)
  LOOP
    IF to_regclass('public.' || rec.tname) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS customer_org_isolation ON %I', rec.tname);
    EXECUTE format($q$
      CREATE POLICY customer_org_isolation ON %I
        USING      (application_id::text   = current_setting('nv.platform_id', true)
               AND customer_org_id::text = current_setting('nv.customer_org_id', true))
        WITH CHECK (application_id::text   = current_setting('nv.platform_id', true)
               AND customer_org_id::text = current_setting('nv.customer_org_id', true))
    $q$, rec.tname);

    IF enforce THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tname);
      EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', rec.tname);
      RAISE NOTICE 'customer_org RLS ENFORCED on %', rec.tname;
    ELSE
      RAISE NOTICE 'customer_org RLS policy installed (dormant — set app.nyv_rls_enforce=true to enforce) on %', rec.tname;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies on HITL queue / decisions and CAM actions.
-- These tables key off legacy `org_id` (which IS the platform tenant in the
-- single-tier world) plus the new `customer_org_id`. We filter on
-- customer_org_id alone because the synthetic default (= platform_id × 1e6)
-- guarantees the id space is disjoint per platform — a customer_org_id match
-- implies the platform too. nv_hitl_decisions has no `org_id` column; it
-- inherits scope from its parent queue row.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  enforce boolean := coalesce(current_setting('app.nyv_rls_enforce', true), 'false') = 'true';
  rec     RECORD;
BEGIN
  FOR rec IN
    SELECT tname FROM (VALUES
      ('nv_hitl_queue'),
      ('nv_hitl_decisions'),
      ('nv_cam_actions')
    ) AS t(tname)
  LOOP
    IF to_regclass('public.' || rec.tname) IS NULL THEN
      RAISE NOTICE 'skipping % — table not present in this env', rec.tname;
      CONTINUE;
    END IF;

    -- The customer_org_id column is added defensively by 0012 but may not
    -- exist on a partially-migrated env; skip gracefully if absent.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = rec.tname
        AND column_name  = 'customer_org_id'
    ) THEN
      RAISE NOTICE 'skipping % — customer_org_id column missing (run migration 0012 first)', rec.tname;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS customer_org_isolation ON %I', rec.tname);
    EXECUTE format($q$
      CREATE POLICY customer_org_isolation ON %I
        USING      (customer_org_id::text = current_setting('nv.customer_org_id', true))
        WITH CHECK (customer_org_id::text = current_setting('nv.customer_org_id', true))
    $q$, rec.tname);

    IF enforce THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.tname);
      EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', rec.tname);
      RAISE NOTICE 'customer_org RLS ENFORCED on %', rec.tname;
    ELSE
      RAISE NOTICE 'customer_org RLS policy installed (dormant — set app.nyv_rls_enforce=true to enforce) on %', rec.tname;
    END IF;
  END LOOP;
END $$;

COMMIT;
