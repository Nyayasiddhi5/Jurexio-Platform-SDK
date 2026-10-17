-- Multi-tenant sub-org model — Task #343 (2026-05-13)
-- ─────────────────────────────────────────────────────────────────────────────
-- Splits the single-tenant identity (`organizationId` on `sdk_applications`)
-- into a TWO-tier identity:
--
--   1. PLATFORM      — the SDK application (NSP, NSPM, NSI, NSA, NSM, NYM, JRX)
--   2. CUSTOMER ORG  — the downstream tenant of that platform
--                      (e.g. "Sharma & Co Law Firm" inside NSP)
--
-- Asserted by the platform on every SDK call via the new
-- `X-Customer-Org-Id` header. Auto-provisioned on first sighting.
--
-- This migration is ADDITIVE only (NV-API-CONTRACT-001):
--   • New table:  nv_customer_organizations
--   • New column: customer_org_id BIGINT NULL on every tenant-scoped table
--   • New backfill: per-platform synthetic default
--                   (platform_id × 1_000_000) so historical rows are not
--                   orphaned when the strict (platform_id, customer_org_id)
--                   filter goes live.
--
-- Nothing is dropped. Old `org_id` columns and policies remain operational.
-- The cutover to (platform_id, customer_org_id) RLS happens in a follow-up
-- once task #42 ships the non-superuser app role.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. The customer-org registry. One row per downstream tenant of a platform.
--    `external_ref` is the platform's own opaque tenant id (firm code, etc).
CREATE TABLE IF NOT EXISTS nv_customer_organizations (
  id              BIGSERIAL PRIMARY KEY,
  platform_id     INTEGER  NOT NULL,           -- FK → sdk_applications.id
  external_ref    VARCHAR(128) NOT NULL,       -- platform-asserted opaque id
  display_name    VARCHAR(255),
  jurisdiction    VARCHAR(10)  DEFAULT 'IN',
  tier            VARCHAR(50)  DEFAULT 'standard',
  data_residency  VARCHAR(20)  DEFAULT 'IN',
  status          VARCHAR(20)  DEFAULT 'active',
  metadata        JSONB        DEFAULT '{}'::jsonb,
  created_at      TIMESTAMP    DEFAULT NOW(),
  updated_at      TIMESTAMP    DEFAULT NOW(),
  CONSTRAINT nv_customer_organizations_platform_ref_uniq
    UNIQUE (platform_id, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_nv_customer_orgs_platform
  ON nv_customer_organizations (platform_id);
CREATE INDEX IF NOT EXISTS idx_nv_customer_orgs_status
  ON nv_customer_organizations (status);

-- 2. Backfill: insert a synthetic per-platform default customer org so
--    legacy rows have a stable target. The id is forced to
--    `platform_id * 1_000_000` to keep it predictable + outside the
--    BIGSERIAL range of real onboardings for the next ~9 quintillion rows.
INSERT INTO nv_customer_organizations
  (id, platform_id, external_ref, display_name, jurisdiction, tier, status, metadata)
SELECT
  (a.id::bigint * 1000000)         AS id,
  a.id                              AS platform_id,
  '__default__'                    AS external_ref,
  COALESCE(a.app_name, 'Platform Default') || ' — Default Customer Org',
  COALESCE(a.jurisdiction, 'IN'),
  'system',
  'active',
  jsonb_build_object('synthetic', true, 'reason', 'task-343-backfill')
FROM sdk_applications a
ON CONFLICT (platform_id, external_ref) DO NOTHING;

-- Bump the BIGSERIAL so future inserts don't collide with the synthetic ids.
SELECT setval(
  pg_get_serial_sequence('nv_customer_organizations', 'id'),
  GREATEST(
    (SELECT COALESCE(MAX(id), 1) FROM nv_customer_organizations),
    1000000
  )
);

-- 3. Tenant-scoping column on the hot-path tables. NULL means "use the
--    per-platform synthetic default at read time" — no orphans.
ALTER TABLE sdk_api_request_logs    ADD COLUMN IF NOT EXISTS customer_org_id BIGINT;
ALTER TABLE sdk_usage_metering      ADD COLUMN IF NOT EXISTS customer_org_id BIGINT;
ALTER TABLE sdk_workflows           ADD COLUMN IF NOT EXISTS customer_org_id BIGINT;
ALTER TABLE sdk_workflow_executions ADD COLUMN IF NOT EXISTS customer_org_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_sdk_req_logs_customer_org
  ON sdk_api_request_logs (customer_org_id);
CREATE INDEX IF NOT EXISTS idx_sdk_usage_metering_customer_org
  ON sdk_usage_metering (customer_org_id);
CREATE INDEX IF NOT EXISTS idx_sdk_workflows_customer_org
  ON sdk_workflows (customer_org_id);
CREATE INDEX IF NOT EXISTS idx_sdk_workflow_exec_customer_org
  ON sdk_workflow_executions (customer_org_id);

-- HITL queue (already shipped by task #337). The column is added defensively
-- because some envs created the table inline and may not have it yet.
DO $$
BEGIN
  IF to_regclass('public.nv_hitl_queue') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS customer_org_id BIGINT';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_nv_hitl_queue_customer_org
               ON nv_hitl_queue (customer_org_id)';
  END IF;
  IF to_regclass('public.nv_hitl_decisions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS customer_org_id BIGINT';
  END IF;
  IF to_regclass('public.nv_cam_actions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE nv_cam_actions ADD COLUMN IF NOT EXISTS customer_org_id BIGINT';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_nv_cam_actions_customer_org
               ON nv_cam_actions (customer_org_id)';
  END IF;
END $$;

-- 4. Backfill: every existing tenant row gets routed to the per-platform
--    synthetic default (id = platform_id * 1_000_000) so when read paths
--    move to a strict (platform_id, customer_org_id) filter no historical
--    row is orphaned. Each statement is guarded so it skips tables not
--    present in the env, and is idempotent (only fills NULLs).
DO $$
BEGIN
  IF to_regclass('public.sdk_api_request_logs') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE sdk_api_request_logs
         SET customer_org_id = (application_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND application_id IS NOT NULL
    $sql$;
  END IF;
  IF to_regclass('public.sdk_usage_metering') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE sdk_usage_metering
         SET customer_org_id = (application_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND application_id IS NOT NULL
    $sql$;
  END IF;
  IF to_regclass('public.sdk_workflows') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE sdk_workflows
         SET customer_org_id = (application_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND application_id IS NOT NULL
    $sql$;
  END IF;
  IF to_regclass('public.sdk_workflow_executions') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE sdk_workflow_executions
         SET customer_org_id = (application_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND application_id IS NOT NULL
    $sql$;
  END IF;
  -- HITL / CAM tables key off organization_id (the legacy single-tenant
  -- column). Same arithmetic — the synthetic default uses the same id
  -- space because in the legacy world organization_id = platform tenant.
  -- HITL / CAM tables actually expose `org_id` (not `organization_id`);
  -- check both names defensively so this migration works on any env.
  IF to_regclass('public.nv_hitl_queue') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='nv_hitl_queue' AND column_name='org_id') THEN
    EXECUTE $sql$
      UPDATE nv_hitl_queue
         SET customer_org_id = (org_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND org_id IS NOT NULL
    $sql$;
  END IF;
  IF to_regclass('public.nv_hitl_decisions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='nv_hitl_decisions' AND column_name='org_id') THEN
    EXECUTE $sql$
      UPDATE nv_hitl_decisions d
         SET customer_org_id = (q.org_id::bigint * 1000000)
        FROM nv_hitl_queue q
       WHERE d.customer_org_id IS NULL
         AND d.queue_id = q.id
         AND q.org_id IS NOT NULL
    $sql$;
  END IF;
  IF to_regclass('public.nv_cam_actions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='nv_cam_actions' AND column_name='org_id') THEN
    EXECUTE $sql$
      UPDATE nv_cam_actions
         SET customer_org_id = (org_id::bigint * 1000000)
       WHERE customer_org_id IS NULL
         AND org_id IS NOT NULL
    $sql$;
  END IF;
END $$;

COMMIT;
