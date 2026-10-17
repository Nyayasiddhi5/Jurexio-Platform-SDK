-- NV-AUDIT-SURFACE-001 (2026-06-25)
-- Fix the public.nv_ai_activity (0 rows) vs nv_schema.ai_activity (16k+ rows)
-- read mismatch. 11 dashboard/analytics/admin endpoints query the unqualified
-- `nv_ai_activity` (resolves to public, empty) while every writer targets
-- nv_schema.ai_activity. Replace the orphan empty table with a compatibility
-- VIEW that maps the live columns into the legacy column names those readers
-- expect, so all readers surface real platform-wide activity with zero code
-- churn. No production writer targets public.nv_ai_activity (verified), so the
-- table is safe to drop.
--
-- Column mapping notes:
--   input_tokens  := tokens_used, output_tokens := 0  (SUM(in+out)=total preserved)
--   credits_charged := 0          (cost is not tracked in ai_activity; org-level
--                                   spend is sourced separately from usage_logs)
--   org_id, session_id, agent_id, block_reason := NULL (not present in source)
-- Guarded so the checked-in migration set stays self-contained: the source
-- table nv_schema.ai_activity is provisioned at runtime by the activity
-- event-bus, not by a checked-in migration, so on a fresh `createdb + psql -f`
-- run it does not exist yet. We only (re)build the compat view when the source
-- table is present (i.e. on the live RDS), and skip cleanly otherwise. The
-- GRANT is also guarded on the nv_app role existing.
DO $$
BEGIN
  IF to_regclass('nv_schema.ai_activity') IS NOT NULL THEN
    -- NV-AUDIT-TOKENS-001 — real per-request LLM cost column (idempotent).
    EXECUTE 'ALTER TABLE nv_schema.ai_activity ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) DEFAULT 0';

    -- Drop whichever form currently occupies public.nv_ai_activity (legacy empty
    -- table OR a previously-created view) so the column type of credits_charged
    -- can change from integer -> numeric without CREATE OR REPLACE conflicts.
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'nv_ai_activity' AND c.relkind = 'r'
    ) THEN
      EXECUTE 'DROP TABLE public.nv_ai_activity CASCADE';
    ELSIF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'nv_ai_activity' AND c.relkind = 'v'
    ) THEN
      EXECUTE 'DROP VIEW public.nv_ai_activity';
    END IF;

    EXECUTE $v$
      CREATE VIEW public.nv_ai_activity AS
      SELECT
        NULL::integer                       AS id,
        a.user_id::varchar                  AS user_id,
        -- The activity event-bus stores the org/tenant id in user_id; expose it
        -- as org_id too so per-org spend rollups (superadmin/llm-budget) group
        -- meaningfully instead of bucketing everything as 'unassigned'.
        a.user_id::varchar                  AS org_id,
        NULL::varchar                       AS session_id,
        'llm_activity'::text                AS activity_type,
        a.pattern_key::varchar              AS pattern_key,
        NULL::varchar                       AS agent_id,
        a.jurisdiction::varchar             AS jurisdiction,
        a.model_provider::varchar           AS model_provider,
        a.model_name::varchar               AS model_name,
        COALESCE(a.tokens_used, 0)::integer AS input_tokens,
        0::integer                          AS output_tokens,
        a.latency_ms::integer               AS latency_ms,
        COALESCE(a.cost_usd, 0)::numeric    AS credits_charged,
        a.blocked                           AS blocked,
        NULL::text                          AS block_reason,
        a.trace_id::varchar                 AS trace_id,
        a.prompt_hash::varchar              AS prompt_hash,
        a.risk_score::integer               AS risk_score,
        a.jurisdiction_validated            AS jurisdiction_validated,
        a.template_mode::varchar            AS template_mode,
        jsonb_build_object('route', a.route) AS metadata,
        a.created_at                        AS created_at
      FROM nv_schema.ai_activity a
    $v$;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
      EXECUTE 'GRANT SELECT ON public.nv_ai_activity TO nv_app';
    END IF;

    RAISE NOTICE 'nv_ai_activity compat view (re)created over nv_schema.ai_activity (with cost_usd)';
  ELSE
    RAISE NOTICE 'skip: nv_schema.ai_activity not present (fresh DB) — view will be created on the live environment';
  END IF;
END $$;
