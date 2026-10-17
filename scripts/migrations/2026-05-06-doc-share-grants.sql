-- ─────────────────────────────────────────────────────────────────────────────
-- nv_doc_share_grants: Jurexio-mediated cross-platform document sharing
-- ─────────────────────────────────────────────────────────────────────────────
-- Per Phase 2A decisions LOCKED 2026-05-06:
--   - Sharing is platform-mediated by Jurexio, NOT peer-to-peer
--   - Default policy = private (uploader-platform-only)
--   - Documents ≥ auto_share_threshold_mb (default 50) auto-receive grants
--     for ALL ecosystem platforms (NSP, NSPM, NSI, NSM, NSA, NYM, JRX) so
--     large docs are NOT duplicated per-platform
--   - Every grant + every cross-platform read is audited
--
-- Idempotent — safe to re-run. Follows Gotcha "drizzle-kit push needs TTY"
-- pattern: this SQL is authoritative for table creation; shared/schema.ts
-- mirrors the shape for typing only.
--
-- @see docs/v5.0.0/DOC-MGMT-PHASE2-ARCHITECTURE-PLAN-2026-05-06.md §10-§11
-- @see config/storage/document-storage-deployment.yaml § sharing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nv_doc_share_grants (
  id                       BIGSERIAL PRIMARY KEY,
  document_id              TEXT        NOT NULL,
  owner_org_id             TEXT        NOT NULL,
  owner_platform_code      TEXT        NOT NULL,         -- NSP|NSPM|NSI|NSM|NSA|NYM|JRX
  granted_to_platform_code TEXT        NOT NULL,
  granted_to_org_id        TEXT,                          -- NULL = ecosystem-wide for that platform
  grant_type               TEXT        NOT NULL DEFAULT 'read',  -- read|write|admin
  grant_reason             TEXT,                          -- auto-large-doc|manual|cross-platform-workflow|jurexio-orchestrator
  threshold_bytes          BIGINT,                        -- file size that triggered auto-grant (NULL for manual)
  storage_path             TEXT,                          -- canonical storage path (Jurexio-shared bucket)
  shared_bucket            TEXT        NOT NULL DEFAULT 'jrx-shared-documents',
  expires_at               TIMESTAMPTZ,                   -- NULL = no expiry
  revoked_at               TIMESTAMPTZ,
  revoked_by               TEXT,
  revoke_reason            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               TEXT,                          -- user_id or 'jurexio-orchestrator'
  audit_chain_hash         TEXT,                          -- linked into nv_audit_logs hash chain
  metadata                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CHECK (grant_type IN ('read','write','admin')),
  CHECK (owner_platform_code IN ('NSP','NSPM','NSI','NSM','NSA','NYM','JRX','JRX')),
  CHECK (granted_to_platform_code IN ('NSP','NSPM','NSI','NSM','NSA','NYM','JRX'))
);

-- Indexes for the 3 hot query paths:
--   1. "Does this user's platform have read on this doc?" — granted_to + doc
--   2. "List all docs this org shared out" — owner_org + owner_platform
--   3. "What grants exist on this doc?" — doc_id

CREATE INDEX IF NOT EXISTS idx_doc_share_grants_doc
  ON public.nv_doc_share_grants (document_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_share_grants_owner
  ON public.nv_doc_share_grants (owner_org_id, owner_platform_code, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_share_grants_granted
  ON public.nv_doc_share_grants (granted_to_platform_code, granted_to_org_id, document_id)
  WHERE revoked_at IS NULL;

-- Partial unique index: prevent duplicate active grants for the same
-- (document, granted_to_platform, granted_to_org) tuple.
-- Ecosystem-wide grants (granted_to_org_id IS NULL) are de-duped by
-- (document, platform, NULL) via COALESCE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_share_grants_active
  ON public.nv_doc_share_grants (document_id, granted_to_platform_code, COALESCE(granted_to_org_id, ''))
  WHERE revoked_at IS NULL;

-- Comments for psql \d+ inspection
COMMENT ON TABLE public.nv_doc_share_grants IS
  'Jurexio-mediated cross-platform document share grants. Per Phase 2A 2026-05-06: large docs (>= auto_share_threshold_mb) auto-grant ecosystem read access to eliminate per-platform duplication.';

COMMENT ON COLUMN public.nv_doc_share_grants.granted_to_org_id IS
  'NULL = ecosystem-wide grant for the named platform (any org on that platform with valid SDK key has read).';

COMMENT ON COLUMN public.nv_doc_share_grants.audit_chain_hash IS
  'SHA-256 of the audit chain entry recorded in nv_audit_logs at grant issuance. Tampering detectable via the existing audit chain verifier.';
