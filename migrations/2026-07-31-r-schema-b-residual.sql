-- R-SCHEMA-B residual close-out (2026-07-31)
-- Idempotent CREATE for tables referenced in src/ but previously undeclared in Drizzle.
-- Apply via: psql as schema owner / master — NOT as nv_app (no CREATE on nv_schema).
--   GRANT CREATE ON SCHEMA nv_schema TO nv_app;  -- optional after DBA apply
-- Or: python3 scripts/nv-apply-r-schema-b-residual-master-ec2.py (needs Secrets Manager master).
-- Bulk R-SCHEMA-B (~94 tables) already applied 2026-04-29; this file is 4 residual tables only.

-- nv_schema already exists on prod; do not CREATE SCHEMA (needs DB CREATE privilege).

CREATE TABLE IF NOT EXISTS nv_schema.nv_bipa_consent_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  org_id             TEXT,
  biometric_type     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'granted',
  disclosure_text    TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  retention_term     TEXT NOT NULL,
  signature_name     TEXT NOT NULL,
  signature_payload  TEXT,
  policy_version     TEXT NOT NULL,
  ip_address         TEXT,
  user_agent         TEXT,
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at         TIMESTAMPTZ,
  destroyed_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nv_bipa_user ON nv_schema.nv_bipa_consent_records (user_id, biometric_type);
CREATE INDEX IF NOT EXISTS idx_nv_bipa_status ON nv_schema.nv_bipa_consent_records (user_id, status);

CREATE TABLE IF NOT EXISTS nv_schema.nv_biometric_artefacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  biometric_type  TEXT NOT NULL,
  payload_ref     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_schema.nv_digital_twins (
  twin_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128),
  entity_id VARCHAR(256) NOT NULL,
  twin_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  profile JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nv_digital_twins_org ON nv_schema.nv_digital_twins(organization_id);
CREATE INDEX IF NOT EXISTS idx_nv_digital_twins_entity ON nv_schema.nv_digital_twins(entity_id);
CREATE INDEX IF NOT EXISTS idx_nv_digital_twins_status ON nv_schema.nv_digital_twins(status);

CREATE TABLE IF NOT EXISTS nv_schema.nv_rag_coverage_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  category TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  fixture_query TEXT,
  pipeline_used TEXT,
  sources_count INTEGER DEFAULT 0,
  avg_similarity REAL DEFAULT 0,
  grounded BOOLEAN DEFAULT FALSE,
  latency_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'yellow',
  notes TEXT,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nv_rag_coverage_audit_cell
  ON nv_schema.nv_rag_coverage_audit (run_id, category, jurisdiction);
CREATE INDEX IF NOT EXISTS idx_nv_rag_coverage_audit_run
  ON nv_schema.nv_rag_coverage_audit (run_id);
