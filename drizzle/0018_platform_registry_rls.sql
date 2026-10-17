-- ============================================================================
-- 0018_platform_registry_rls.sql  (JRX-PLATFORMS-500 / JRX-PLATFORMS-RLS)
-- ============================================================================
-- The Platform Registry (GET /api/nv/platforms, SDK Hub ▸ Key Management) reads
-- the `nv_sdk_applications` table. On the EC2 dev-edge RDS this table predated
-- the registry feature, so it was MISSING the platform_* columns; and migration
-- 0004 had force-enabled the strict per-org `tenant_isolation` policy on it
-- (org_id::text = current_setting('app.current_org_id')). Two consequences:
--
--   1. The route's runtime self-heal `ADD COLUMN` was silently denied (DDL is
--      admin-only on RDS), so the ecosystem seed INSERT failed with
--      "column platform_type does not exist" -> registry showed 0 platforms
--      ("No platforms registered").
--   2. Even after seeding, the runtime pool's fail-closed default
--      (app.current_org_id = '') made the strict policy hide every row.
--
-- This migration reconciles both, non-destructively (additive ADD COLUMN IF NOT
-- EXISTS; PK type VARCHAR(36) preserved) and idempotently. The Platform Registry
-- is GLOBAL super-admin config — NOT per-tenant data. Platform API key SECRETS
-- live in the separate sdk_app_api_keys / nv_api_keys tables, which keep their
-- own protection; and the canonical SDK gateway authenticates against
-- `sdk_applications`, not this table — so relaxing this one policy is safe.
-- ============================================================================

-- 1. Additive columns the registry route expects (non-destructive). --------------
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS platform_type      VARCHAR(60) DEFAULT 'custom';
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS display_name       VARCHAR(255);
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS jurisdictions      TEXT[] DEFAULT ARRAY['IN'];
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS environment        VARCHAR(20) NOT NULL DEFAULT 'sandbox';
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS contact_email      VARCHAR(255);
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS modules_enabled    JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS agents_allowed     TEXT[] DEFAULT ARRAY['*'];
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS llm_config         JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS rate_limits_config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS is_provisioned     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS key_expires_at     TIMESTAMP;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS org_id             INTEGER DEFAULT 1;
ALTER TABLE IF EXISTS nv_sdk_applications ADD COLUMN IF NOT EXISTS owner_id           INTEGER;

-- 2. Relax tenant_isolation for the GLOBAL platform registry rows. ----------------
--    Strict per-org isolation is retained for every non-platform row; platform
--    rows (app_type='platform') and explicit super-admin context are exempt.
DO $$
BEGIN
  IF to_regclass('public.nv_sdk_applications') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON nv_sdk_applications;
    CREATE POLICY tenant_isolation ON nv_sdk_applications
      USING (
        org_id::text = current_setting('app.current_org_id', true)
        OR current_setting('app.is_super_admin', true) = 'true'
        OR app_type = 'platform'
      )
      WITH CHECK (
        org_id::text = current_setting('app.current_org_id', true)
        OR current_setting('app.is_super_admin', true) = 'true'
        OR app_type = 'platform'
      );
  END IF;
END$$;

-- 3. Seed the 5 ecosystem platforms idempotently (only if absent by name). --------
--    Guarded so a fresh migration-only DB (where nv_sdk_applications is created at
--    runtime, not by a checked-in .sql) skips this block cleanly instead of erroring.
DO $$
BEGIN
  IF to_regclass('public.nv_sdk_applications') IS NOT NULL THEN
    EXECUTE $seed$
      INSERT INTO nv_sdk_applications (name, display_name, app_type, platform_type, jurisdiction, jurisdictions, tier, is_active, environment, modules_enabled, agents_allowed, is_provisioned, settings, created_at, updated_at)
      SELECT v.name, v.display_name, 'platform', v.platform_type, v.jurisdiction, v.jurisdictions, v.tier, true, 'production', v.modules_enabled::jsonb, ARRAY['*']::text[], false, '{}'::jsonb, NOW(), NOW()
      FROM (VALUES
        ('Jurexio Citizen',                 'Jurexio Citizen (Citizen Legal Aid)',             'jurexio-citizen',               'IN', ARRAY['IN']::text[],                              'pro',        '{"clawdbot":true,"nyayarag":true,"doc_intelligence":true,"voice_ai":true,"hitl":true}'),
        ('Nyayasiddhi Professional',   'Nyayasiddhi Professional (Practice Mgmt)',   'nyayasiddhi-professional', 'IN', ARRAY['IN','UK','US','EU','GC','SG']::text[],    'pro',        '{"automateai":true,"twindesk":true,"skillshop":true,"nyayarag":true,"doc_intelligence":true,"voice_ai":true,"hitl":true,"sdk_intelligence":true}'),
        ('Nyayasiddhi Institutional',  'Nyayasiddhi Institutional (Enterprise GC)',  'nyayasiddhi-institution',  'IN', ARRAY['IN','UK','US','EU','GC','SG']::text[],    'enterprise', '{"clawdbot":true,"openbot":true,"automateai":true,"twindesk":true,"skillshop":true,"nyayarag":true,"doc_intelligence":true,"voice_ai":true,"hitl":true,"sdk_intelligence":true}'),
        ('Nyayasiddhi Academy',        'Nyayasiddhi Academy (Education)',            'nyayasiddhi-academy',      'IN', ARRAY['IN','UK','US','EU','GC','SG']::text[],    'plus',       '{"skillshop":true,"nyayarag":true,"doc_intelligence":true}'),
        ('Nyayasiddhi Ministry',       'Nyayasiddhi Ministry (Sovereign / Regulator)','nyayasiddhi-ministry',    'IN', ARRAY['IN']::text[],                              'government', '{"automateai":true,"nyayarag":true,"doc_intelligence":true,"voice_ai":true,"hitl":true,"sdk_intelligence":true}')
      ) AS v(name, display_name, platform_type, jurisdiction, jurisdictions, tier, modules_enabled)
      WHERE NOT EXISTS (SELECT 1 FROM nv_sdk_applications x WHERE x.name = v.name)
    $seed$;
  END IF;
END$$;
