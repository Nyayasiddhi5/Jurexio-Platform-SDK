-- sdk_workflows / sdk_workflow_executions schema catch-up
-- Source of truth: shared/schema.ts (task #263 brought TS in line with the
-- live Replit/EC2 dev DB; this migration brings *fresh* databases in line
-- with the TS so a clean Neon/RDS bootstrap or the staged RDS schema-sync in
-- docs/canonical/EC2-INTEGRATION-STATUS.md ends up with the same columns the
-- service code (src/services/sdk/sdk-workflow-protocol-service.ts) reads/writes.
--
-- Idempotent: every column add uses IF NOT EXISTS so it is safe to re-run
-- against the existing dev DB (where these columns were added by hand) and
-- against a brand-new DB created from drizzle/0000_even_red_skull.sql.
--
-- The one non-additive change is sdk_workflow_executions.workflow_id, which
-- the original migration created as `integer` and the schema now declares as
-- `varchar(100)`. We convert in place using USING workflow_id::text so the
-- step is safe whether the column is still integer (fresh DB), already
-- varchar (live dev DB), or NULL throughout.

-- ── sdk_workflows ────────────────────────────────────────────────────────

ALTER TABLE "sdk_workflows"
  ADD COLUMN IF NOT EXISTS "workflow_id"     varchar(100),
  ADD COLUMN IF NOT EXISTS "organization_id" integer,
  ADD COLUMN IF NOT EXISTS "description"     text,
  ADD COLUMN IF NOT EXISTS "steps"           jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "triggers"        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "jurisdiction"    varchar(20)  DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS "status"          varchar(50)  DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS "version"         integer      DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "created_by"      varchar(100),
  ADD COLUMN IF NOT EXISTS "schedule_config" jsonb,
  ADD COLUMN IF NOT EXISTS "deleted_at"      timestamp;

-- workflow_id is NOT NULL in the TS schema. Backfill any pre-existing rows
-- (the live dev DB seeds workflow_id from the application layer; on a fresh
-- DB the table is empty so the UPDATE is a no-op) before enforcing the
-- constraint, and only enforce it once every row has a value.
UPDATE "sdk_workflows"
   SET "workflow_id" = 'wf_' || "id"::text
 WHERE "workflow_id" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'sdk_workflows'
       AND column_name  = 'workflow_id'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE "sdk_workflows" ALTER COLUMN "workflow_id" SET NOT NULL;
  END IF;
END $$;

-- ── sdk_workflow_executions ─────────────────────────────────────────────

ALTER TABLE "sdk_workflow_executions"
  ADD COLUMN IF NOT EXISTS "execution_id"    varchar(100),
  ADD COLUMN IF NOT EXISTS "organization_id" integer,
  ADD COLUMN IF NOT EXISTS "execution_mode"  varchar(20) DEFAULT 'async',
  ADD COLUMN IF NOT EXISTS "steps_completed" integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_steps"     integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "duration_ms"     integer,
  ADD COLUMN IF NOT EXISTS "tokens_used"     integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "estimated_cost"  varchar(32),
  ADD COLUMN IF NOT EXISTS "executed_by"     varchar(100);

-- workflow_id type change: integer → varchar(100). Guarded so it only runs
-- when the column is still integer (fresh DB built from
-- drizzle/0000_even_red_skull.sql); on the live dev DB the column is
-- already varchar and this block is a no-op.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'sdk_workflow_executions'
     AND column_name  = 'workflow_id';

  IF current_type = 'integer' THEN
    ALTER TABLE "sdk_workflow_executions"
      ALTER COLUMN "workflow_id" TYPE varchar(100)
      USING "workflow_id"::text;
  END IF;
END $$;

-- Backfill execution_id (NOT NULL in TS) before enforcing the constraint.
UPDATE "sdk_workflow_executions"
   SET "execution_id" = 'exec_' || "id"::text
 WHERE "execution_id" IS NULL;

-- sdk_app_api_keys.revoked_at (schema.ts / API key validation query)
ALTER TABLE "sdk_app_api_keys"
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'sdk_workflow_executions'
       AND column_name  = 'execution_id'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE "sdk_workflow_executions" ALTER COLUMN "execution_id" SET NOT NULL;
  END IF;
END $$;
