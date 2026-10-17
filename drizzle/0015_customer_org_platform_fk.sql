-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015_customer_org_platform_fk — Task #385 (2026-05-14)
--
-- Make it impossible to onboard a customer organisation without a real
-- platform binding. Adds the FK that 0012_customer_organizations.sql
-- documented in its column comment but did NOT enforce, and re-asserts
-- platform_id NOT NULL idempotently so a future schema rewrite that drops
-- the constraint cannot silently re-introduce orphan rows.
--
-- Why
--   `nv_customer_organizations.platform_id` is the (platform_id,
--   external_ref) half of every tenant-scoped RLS partition (see
--   `customer_org_isolation` policy installed by 0013). A row with a
--   NULL or invalid platform_id would either:
--     • orphan: point at a non-existent sdk_applications row → the
--       partner platform's filter `application_id = sdkContext.applicationId`
--       skips the row, but unrelated platforms could still pick it up
--       through a buggy admin query that joins by (platform_id) alone.
--     • NULL: bypass RLS partitioning entirely — the
--       `customer_org_isolation` policy uses `customer_org_id IS NULL`
--       as the legacy/synthetic-default escape hatch on the data tables,
--       and a NULL platform_id on the registry undermines the audit
--       trail of which platform owns the row.
--   Either case mixes data across customers. Task #365 already shipped
--   the runtime path (RLS + non-superuser `nv_app`); this migration
--   closes the structural gap on the registry table itself.
--
-- This migration is ADDITIVE on the API contract (NV-API-CONTRACT-001):
--   • No columns added or dropped, no routes/types removed
--   • Adds FK + index + re-asserts NOT NULL (idempotent — every step
--     gates on pg_constraint / information_schema / IF NOT EXISTS so
--     re-running the migration is a no-op)
--   • Reversible — see the matching DROP block at the bottom
--
-- Pre-flight contract (mirrors 0014):
--   We deliberately RAISE EXCEPTION on any orphan or NULL row rather
--   than silently re-binding to the per-platform synthetic default. A
--   wrong rebind is worse than a hard stop — the operator must inspect
--   the rows and decide explicitly. See `scripts/nv-task385-preflight.ts`
--   for the read-only inventory pass meant to be run against prod RDS
--   BEFORE this migration is applied via the SSM + psql sidecar pattern.
--
-- ON DELETE / ON UPDATE
--   ON DELETE RESTRICT — never silently delete customer orgs when an
--                        SDK application is removed; force the operator
--                        to re-bind or explicitly purge first.
--   ON UPDATE CASCADE  — propagate sdk_applications id renumbering
--                        (rare but cheap to support).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Pre-flight safety: any orphan or NULL rows would block the FK / NOT
--    NULL tightening. Surface them loudly so the operator can fix the
--    data before retry — we deliberately refuse to pick a sentinel
--    platform silently (a wrong bind mixes customer data across SKUs).
DO $$
DECLARE
  orphan_count INTEGER;
  null_count   INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM nv_customer_organizations c
   WHERE c.platform_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.sdk_applications a
        WHERE a.id = c.platform_id
     );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Task #385 / 0015: % nv_customer_organizations row(s) reference a non-existent sdk_applications.id — fix the data and retry (see scripts/nv-task385-preflight.ts for the inventory)',
      orphan_count;
  END IF;

  SELECT COUNT(*) INTO null_count
    FROM nv_customer_organizations
   WHERE platform_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Task #385 / 0015: % nv_customer_organizations row(s) still have platform_id IS NULL — bind them explicitly to an sdk_applications.id before retrying. We will not pick a sentinel platform for you.',
      null_count;
  END IF;
END $$;

-- 2. Add the FK if (and only if) it does not already exist. Postgres has no
--    `ADD CONSTRAINT IF NOT EXISTS`, so we gate on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'nv_customer_organizations_platform_id_sdk_applications_id_fk'
       AND conrelid = 'public.nv_customer_organizations'::regclass
  ) THEN
    ALTER TABLE public.nv_customer_organizations
      ADD CONSTRAINT nv_customer_organizations_platform_id_sdk_applications_id_fk
      FOREIGN KEY (platform_id)
      REFERENCES public.sdk_applications (id)
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Supporting index — 0012 already created `idx_nv_customer_orgs_platform`,
--    but assert IF NOT EXISTS so envs that built the table without it
--    (or with a different name) still get the FK-side lookup index.
CREATE INDEX IF NOT EXISTS idx_nv_customer_orgs_platform
  ON public.nv_customer_organizations (platform_id);

-- 4. Re-assert NOT NULL idempotently. The 0012 definition already declared
--    platform_id NOT NULL, but a future schema rewrite that drops it
--    would silently re-open the orphan path. Gating on
--    information_schema.columns.is_nullable keeps this a no-op when the
--    column is already NOT NULL. The pre-flight in step 1 has already
--    proven there are no NULL rows, so this ALTER cannot fail on
--    existing data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'nv_customer_organizations'
       AND column_name  = 'platform_id'
       AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE public.nv_customer_organizations
      ALTER COLUMN platform_id SET NOT NULL;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reversal (manual, not run by drizzle):
--
--   BEGIN;
--   ALTER TABLE public.nv_customer_organizations
--     ALTER COLUMN platform_id DROP NOT NULL;
--   ALTER TABLE public.nv_customer_organizations
--     DROP CONSTRAINT IF EXISTS nv_customer_organizations_platform_id_sdk_applications_id_fk;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
