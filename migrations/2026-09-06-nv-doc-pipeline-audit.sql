-- NV-DOC-PIPELINE-AUDIT-001 — async_job_queue poll index + Patra Mitra session durability
-- Idempotent; safe to re-run on nysdev RDS.

CREATE INDEX IF NOT EXISTS idx_async_job_queue_type_status_created
  ON nv_schema.async_job_queue (job_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS nv_schema.nv_patra_mitra_sessions (
  session_id     TEXT PRIMARY KEY,
  org_id         TEXT,
  platform_code  TEXT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nv_patra_mitra_sessions_org
  ON nv_schema.nv_patra_mitra_sessions (org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_nv_patra_mitra_sessions_expires
  ON nv_schema.nv_patra_mitra_sessions (expires_at);
