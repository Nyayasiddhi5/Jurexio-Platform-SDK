-- ─────────────────────────────────────────────────────────────────────
-- NV-UAT-DEFAULT-ORG-001 (2026-05-13)
-- Until full RBAC sign-off, every user / SDK app / API key row defaults
-- to the platform-baseline org_id = 1 (Jurexio Technologies).
-- Idempotent. Safe to re-run.
-- Apply on: Replit dev DB, Replit deployment DB, EC2 RDS prod-dev DB.
-- TO BE REVERTED before production cutover (see canonical doc 13).
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Backfill nulls
UPDATE public.nv_users           SET org_id = 1           WHERE org_id IS NULL;
UPDATE public.sdk_applications   SET organization_id = 1  WHERE organization_id IS NULL;
UPDATE public.nv_sdk_applications SET org_id          = 1  WHERE org_id IS NULL;

-- 2. Column defaults (so future inserts auto-fill)
ALTER TABLE public.nv_users            ALTER COLUMN org_id          SET DEFAULT 1;
ALTER TABLE public.sdk_applications    ALTER COLUMN organization_id SET DEFAULT 1;
ALTER TABLE public.nv_sdk_applications ALTER COLUMN org_id          SET DEFAULT 1;

-- 3. UAT widening — promote all real users to super_admin (skips synthetic e2e)
UPDATE public.nv_users
   SET role      = 'super_admin',
       is_active = true
 WHERE email NOT ILIKE 'e2e-%@nyayavigya.test'
   AND email NOT ILIKE '%-test-%@nyayavigya.test';

-- 4. Reaffirm 7 platform SDK keys are wide-open
UPDATE public.sdk_app_api_keys
   SET is_active  = true,
       scopes     = '["*"]'::jsonb,
       expires_at = NULL;

COMMIT;

-- Verification (read-only)
SELECT 'users_super_admin' k, count(*)::text v FROM public.nv_users WHERE role='super_admin'
UNION ALL SELECT 'users_with_null_org', count(*)::text FROM public.nv_users WHERE org_id IS NULL
UNION ALL SELECT 'sdk_apps_with_null_org', count(*)::text FROM public.sdk_applications WHERE organization_id IS NULL
UNION ALL SELECT 'sdk_keys_active_wildcard', count(*)::text FROM public.sdk_app_api_keys WHERE is_active AND scopes::text='[\"*\"]';
