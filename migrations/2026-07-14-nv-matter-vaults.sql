-- NV-MATTER-VAULT-PG-001 — durable Matter Vault persistence (2026-07-14)
-- Write-through from nv-matter-vault-service; payload JSONB holds documents/EDJ/playbooks.

CREATE TABLE IF NOT EXISTS nv_schema.nv_matter_vaults (
  vault_id        VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(128),
  user_id         VARCHAR(128),
  name            TEXT NOT NULL,
  matter_ref      TEXT,
  description     TEXT,
  jurisdiction    VARCHAR(16) NOT NULL DEFAULT 'IN',
  status          VARCHAR(32) NOT NULL DEFAULT 'draft',
  default_depth   VARCHAR(32) NOT NULL DEFAULT 'detailed',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nv_matter_vaults_org
  ON nv_schema.nv_matter_vaults (organization_id);
CREATE INDEX IF NOT EXISTS idx_nv_matter_vaults_status
  ON nv_schema.nv_matter_vaults (status);
CREATE INDEX IF NOT EXISTS idx_nv_matter_vaults_updated
  ON nv_schema.nv_matter_vaults (updated_at DESC);

-- Best-effort backfill from legacy async_job_queue mirror (idempotent).
INSERT INTO nv_schema.nv_matter_vaults (
  vault_id, organization_id, user_id, name, matter_ref, description,
  jurisdiction, status, default_depth, payload, created_at, updated_at
)
SELECT
  COALESCE(output->>'vaultId', REPLACE(job_id, 'mv-', '')),
  NULLIF(output->>'orgId', ''),
  NULLIF(output->>'userId', ''),
  COALESCE(NULLIF(output->>'name', ''), 'Migrated vault'),
  NULLIF(output->>'matterRef', ''),
  NULLIF(output->>'description', ''),
  COALESCE(NULLIF(UPPER(output->>'jurisdiction'), ''), 'IN'),
  COALESCE(NULLIF(output->>'status', ''), 'draft'),
  COALESCE(NULLIF(output->>'defaultDepth', ''), 'detailed'),
  COALESCE(output, '{}'::jsonb),
  COALESCE(created_at, NOW()),
  COALESCE(updated_at, NOW())
FROM nv_schema.async_job_queue
WHERE job_type = 'matter_vault_meta'
  AND output IS NOT NULL
  AND COALESCE(output->>'vaultId', REPLACE(job_id, 'mv-', '')) IS NOT NULL
ON CONFLICT (vault_id) DO NOTHING;
