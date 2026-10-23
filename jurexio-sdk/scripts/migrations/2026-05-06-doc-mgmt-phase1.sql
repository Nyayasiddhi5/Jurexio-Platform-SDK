-- Document Management Phase 1 migration (v5.0.1, 2026-05-06)
-- Idempotent: safe to re-run. Applies G1 (platform_code) + D2 (eSign DB persistence).
-- See: docs/v5.0.0/DOCUMENT-MANAGEMENT-AUDIT-AND-PLAN-2026-05-06.md §9

BEGIN;

-- ─── G1: Ecosystem-platform segregation column ──────────────────────────
-- Per-platform document filtering without table bloat. Backfill happens
-- lazily as new docs come in via the SDK gateway (which knows the variant).
ALTER TABLE ns_parsed_documents
  ADD COLUMN IF NOT EXISTS platform_code VARCHAR(20);

CREATE INDEX IF NOT EXISTS ns_parsed_docs_org_platform_idx
  ON ns_parsed_documents (organization_id, platform_code);

-- ─── D2: e-Sign session persistence (was in-memory Map) ─────────────────
CREATE TABLE IF NOT EXISTS nv_esign_sessions (
  session_id      VARCHAR(64)  PRIMARY KEY,
  organization_id INTEGER      NOT NULL,
  document_hash   VARCHAR(64)  NOT NULL,
  signers         JSONB        NOT NULL DEFAULT '[]',
  status          VARCHAR(30)  NOT NULL DEFAULT 'pending',
  provider        VARCHAR(50),
  platform_code   VARCHAR(20),
  metadata        JSONB        DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS nv_esign_org_idx
  ON nv_esign_sessions (organization_id, created_at);

CREATE INDEX IF NOT EXISTS nv_esign_expiry_idx
  ON nv_esign_sessions (status, expires_at);

COMMIT;

-- Verification (run separately):
-- \d+ ns_parsed_documents
-- \d+ nv_esign_sessions
-- SELECT 'ok' WHERE EXISTS (SELECT 1 FROM information_schema.columns
--   WHERE table_name='ns_parsed_documents' AND column_name='platform_code');
