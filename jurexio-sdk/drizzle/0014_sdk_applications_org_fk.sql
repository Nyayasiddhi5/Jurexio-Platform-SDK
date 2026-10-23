-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014_sdk_applications_org_fk — Task #378 (2026-05-14)
--
-- Lock-in tenant safety: add a FOREIGN KEY constraint on
--   sdk_applications.organization_id → public.nv_organizations(id)
--
-- Why
--   Task #365 (BCD-flip, 2026-05-14) hand-bound the 7 prod SDK applications
--   (id 10..16, NSP/NSPM/NSI/NSA/NSM/NYM/JRX) to organization_id = 1, but
--   nothing at the database level prevents a future migration or DML mistake
--   from leaving an `sdk_applications` row with a NULL or invalid
--   organization_id. That re-triggers the production fail-closed path
--   `sdk_application_missing_org_binding` in src/middleware/jrx-sdk-gateway.ts
--   and silently 500s the SKU.
--
-- This migration is ADDITIVE on the API contract (NV-API-CONTRACT-001):
--   • No columns added or dropped, no routes/types removed
--   • Tightens organization_id to NOT NULL so the database itself rejects
--     unbound apps at write time. This is the "lock-in" the task title
--     calls for — a NULL would otherwise let a bad insert sneak past the
--     FK and re-trigger the runtime fail-closed guard
--     `sdk_application_missing_org_binding`. Pre-flight raises loudly if
--     any sdk_applications row still has a NULL organization_id so the
--     operator must bind it explicitly before retry — we will not pick a
--     sentinel org silently.
--   • Idempotent — every step gates on pg_constraint /
--     information_schema so re-running the migration is a no-op
--   • Reversible — see the matching DROP / DROP NOT NULL at the bottom
--
-- ON DELETE / ON UPDATE
--   ON DELETE RESTRICT — never silently delete SDK applications when an
--                        organization is removed; force the operator to
--                        re-bind or explicitly purge first
--   ON UPDATE CASCADE  — propagate organization id renumbering (rare)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Pre-flight safety: any orphan or NULL rows would block the FK / NOT
--    NULL tightening. Surface them loudly so the operator can fix the
--    data before retry — we deliberately refuse to pick a sentinel org
--    silently (a wrong bind is worse than a hard stop).
DO $$
DECLARE
  orphan_count INTEGER;
  null_count   INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM sdk_applications a
   WHERE a.organization_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.nv_organizations o
        WHERE o.id = a.organization_id
     );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Task #378 / 0014: % sdk_applications row(s) reference a non-existent nv_organizations.id — fix the data and retry',
      orphan_count;
  END IF;

  SELECT COUNT(*) INTO null_count
    FROM sdk_applications
   WHERE organization_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Task #378 / 0014: % sdk_applications row(s) still have organization_id IS NULL — bind them explicitly to an nv_organizations.id (see Task #365 BCD-flip notes) before retrying. We will not pick a sentinel org for you.',
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
     WHERE conname = 'sdk_applications_organization_id_nv_organizations_id_fk'
       AND conrelid = 'public.sdk_applications'::regclass
  ) THEN
    ALTER TABLE public.sdk_applications
      ADD CONSTRAINT sdk_applications_organization_id_nv_organizations_id_fk
      FOREIGN KEY (organization_id)
      REFERENCES public.nv_organizations (id)
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Supporting index — the FK does NOT auto-create one on the referencing
--    side, and we filter `WHERE organization_id = ?` on the SDK gateway hot
--    path. Idempotent.
CREATE INDEX IF NOT EXISTS sdk_applications_organization_id_idx
  ON public.sdk_applications (organization_id);

-- 4. Tighten organization_id to NOT NULL so a future bad insert can never
--    leave an app with a missing org binding (the structural lock-in).
--    Idempotent — gated on information_schema.columns.is_nullable. The
--    pre-flight in step 1 has already proven there are no NULL rows, so
--    this ALTER cannot fail on existing data; if a NULL slips in between
--    step 1 and step 4 (concurrent writer in another session) Postgres
--    will fail the ALTER and the whole transaction rolls back — which is
--    the correct outcome.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'sdk_applications'
       AND column_name  = 'organization_id'
       AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE public.sdk_applications
      ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reversal (manual, not run by drizzle):
--
--   BEGIN;
--   ALTER TABLE public.sdk_applications
--     ALTER COLUMN organization_id DROP NOT NULL;
--   ALTER TABLE public.sdk_applications
--     DROP CONSTRAINT IF EXISTS sdk_applications_organization_id_nv_organizations_id_fk;
--   DROP INDEX IF EXISTS sdk_applications_organization_id_idx;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
