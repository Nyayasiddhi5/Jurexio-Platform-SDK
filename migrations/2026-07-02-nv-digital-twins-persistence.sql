-- NV-TWIN-DB-001 — durable persistence for digital-twin-service (Session-34)
-- Mirrors the TwinDesk write-through pattern: full twin document in JSONB.

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
