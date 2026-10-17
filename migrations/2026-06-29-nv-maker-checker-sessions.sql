-- nv_maker_checker_sessions — durable maker/checker governance loop sessions.
--
-- Source of truth: shared/nv-schema-tables.ts (nvMakerCheckerSessions).
-- Brings fresh databases (clean Neon/RDS bootstrap, drift-check temp DB) in
-- line with the TS schema so src/services/maker-checker-service.ts can persist
-- completed maker/checker loops + human decisions instead of holding them only
-- in-process Maps.
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS so it is safe to
-- re-run against an existing DB and against a brand-new one.
--
-- Column shape (names, types, NOT NULL, default-presence) is a byte-for-byte
-- mirror of the Drizzle declaration so `npm run guardrail:schema-drift`
-- reports zero drift.

CREATE SCHEMA IF NOT EXISTS nv_schema;

CREATE TABLE IF NOT EXISTS nv_schema.nv_maker_checker_sessions (
  session_id        uuid PRIMARY KEY NOT NULL,
  original_prompt   text        NOT NULL,
  final_output      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  iterations        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total_iterations  integer     NOT NULL DEFAULT 0,
  approved          boolean     NOT NULL DEFAULT false,
  human_escalated   boolean     NOT NULL DEFAULT false,
  human_decision    text,
  quality_score     numeric,
  total_latency_ms  integer,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_approved
  ON nv_schema.nv_maker_checker_sessions (approved);
CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_escalated
  ON nv_schema.nv_maker_checker_sessions (human_escalated);
CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_created
  ON nv_schema.nv_maker_checker_sessions (created_at);
