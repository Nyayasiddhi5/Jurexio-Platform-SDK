-- Legal Chat + SME + document pipeline + router decision log catch-up
-- Source of truth: shared/schema.ts (2026-05-28)
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS legal_chat_sessions (
  id              VARCHAR(36) PRIMARY KEY,
  owner_user_id   INTEGER NOT NULL,
  org_id          INTEGER,
  title           VARCHAR(255) NOT NULL DEFAULT 'Untitled session',
  jurisdictions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  tier            VARCHAR(32) NOT NULL DEFAULT 'pro',
  mode            VARCHAR(64) NOT NULL DEFAULT 'chat',
  preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS legal_chat_sessions_owner_idx ON legal_chat_sessions(owner_user_id);
CREATE INDEX IF NOT EXISTS legal_chat_sessions_last_used_idx ON legal_chat_sessions(last_used_at);

CREATE TABLE IF NOT EXISTS legal_chat_messages (
  id                VARCHAR(36) PRIMARY KEY,
  session_id        VARCHAR(36) NOT NULL,
  orchestration_id  VARCHAR(64),
  role              VARCHAR(16) NOT NULL,
  content           TEXT NOT NULL,
  citations         JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS legal_chat_messages_session_idx ON legal_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS legal_chat_messages_orchestration_idx ON legal_chat_messages(orchestration_id);

CREATE TABLE IF NOT EXISTS sme_allocations (
  id                   SERIAL PRIMARY KEY,
  sme_user_id          INTEGER NOT NULL,
  allocated_by_user_id INTEGER NOT NULL,
  scope                JSONB NOT NULL DEFAULT '{}'::jsonb,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sme_allocations_sme_idx ON sme_allocations(sme_user_id);
CREATE INDEX IF NOT EXISTS sme_allocations_active_idx ON sme_allocations(active);

CREATE TABLE IF NOT EXISTS sme_feedback (
  id                SERIAL PRIMARY KEY,
  orchestration_id  VARCHAR(64) NOT NULL,
  session_id        VARCHAR(36),
  sme_user_id       INTEGER NOT NULL,
  ratings           JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment           TEXT,
  preferred_over    VARCHAR(64),
  judge_verdict     JSONB,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sme_feedback_orchestration_idx ON sme_feedback(orchestration_id);
CREATE INDEX IF NOT EXISTS sme_feedback_sme_idx ON sme_feedback(sme_user_id);

CREATE TABLE IF NOT EXISTS nv_router_decisions (
  id                SERIAL PRIMARY KEY,
  ts                TIMESTAMP NOT NULL DEFAULT NOW(),
  request_id        VARCHAR(64),
  agent_id          VARCHAR(96),
  tier              VARCHAR(32),
  jurisdiction      VARCHAR(16),
  task_kind         VARCHAR(64),
  primary_model_id  VARCHAR(96) NOT NULL,
  picked_model_id   VARCHAR(96) NOT NULL,
  picked_provider   VARCHAR(32) NOT NULL,
  fallback_level    INTEGER NOT NULL DEFAULT 0,
  ok                BOOLEAN NOT NULL,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  cost_usd          DOUBLE PRECISION NOT NULL DEFAULT 0,
  tokens_in         INTEGER NOT NULL DEFAULT 0,
  tokens_out        INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  meta              JSONB
);
CREATE INDEX IF NOT EXISTS nv_router_decisions_ts_idx ON nv_router_decisions(ts);
CREATE INDEX IF NOT EXISTS nv_router_decisions_model_idx ON nv_router_decisions(picked_model_id);
CREATE INDEX IF NOT EXISTS nv_router_decisions_agent_idx ON nv_router_decisions(agent_id);
CREATE INDEX IF NOT EXISTS nv_router_decisions_juris_idx ON nv_router_decisions(jurisdiction);

CREATE TABLE IF NOT EXISTS ns_doc_processing_jobs (
  id               VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           INTEGER NOT NULL,
  document_id      VARCHAR(36),
  document_type    VARCHAR(50) DEFAULT 'text',
  extraction_mode  VARCHAR(50) DEFAULT 'full',
  status           VARCHAR(30) NOT NULL DEFAULT 'queued',
  progress         INTEGER NOT NULL DEFAULT 0,
  file_name        VARCHAR(500),
  file_size_bytes  INTEGER DEFAULT 0,
  priority         INTEGER NOT NULL DEFAULT 5,
  worker_id        VARCHAR(100),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  max_retries      INTEGER NOT NULL DEFAULT 3,
  error_message    TEXT,
  result           JSONB,
  storage_path     TEXT,
  parsed_json_path TEXT,
  metadata         JSONB DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_doc_jobs_poller_idx ON ns_doc_processing_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS ns_doc_jobs_org_idx ON ns_doc_processing_jobs(org_id, created_at);

CREATE TABLE IF NOT EXISTS ns_parsed_documents (
  id                   SERIAL PRIMARY KEY,
  organization_id      INTEGER NOT NULL,
  document_id          VARCHAR(36) NOT NULL,
  job_id               VARCHAR(36) NOT NULL,
  file_name            VARCHAR(500),
  file_type            VARCHAR(50),
  file_size_bytes      INTEGER DEFAULT 0,
  mime_type            VARCHAR(100),
  storage_path         TEXT,
  parsed_json_path     TEXT,
  raw_content          TEXT,
  parsed_content       JSONB,
  metadata             JSONB DEFAULT '{}'::jsonb,
  statistics           JSONB DEFAULT '{}'::jsonb,
  entities             JSONB DEFAULT '[]'::jsonb,
  sections             JSONB DEFAULT '[]'::jsonb,
  obligations          JSONB DEFAULT '[]'::jsonb,
  risks                JSONB DEFAULT '[]'::jsonb,
  deadlines            JSONB DEFAULT '[]'::jsonb,
  language             VARCHAR(10) DEFAULT 'en',
  jurisdiction         VARCHAR(10),
  document_class       VARCHAR(100),
  page_count           INTEGER DEFAULT 0,
  word_count           INTEGER DEFAULT 0,
  processing_time_ms   INTEGER DEFAULT 0,
  status               VARCHAR(30) DEFAULT 'completed',
  created_by           VARCHAR(100),
  platform_code        VARCHAR(20),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ns_parsed_docs_org_doc_idx ON ns_parsed_documents(organization_id, document_id);
CREATE UNIQUE INDEX IF NOT EXISTS ns_parsed_docs_job_uniq ON ns_parsed_documents(job_id);
CREATE INDEX IF NOT EXISTS ns_parsed_docs_org_platform_idx ON ns_parsed_documents(organization_id, platform_code);

CREATE TABLE IF NOT EXISTS nv_esign_sessions (
  session_id       VARCHAR(64) PRIMARY KEY,
  organization_id  INTEGER NOT NULL,
  document_hash    VARCHAR(64) NOT NULL,
  signers          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           VARCHAR(30) NOT NULL DEFAULT 'pending',
  provider         VARCHAR(50),
  platform_code    VARCHAR(20),
  metadata         JSONB DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS nv_esign_org_idx ON nv_esign_sessions(organization_id, created_at);
CREATE INDEX IF NOT EXISTS nv_esign_expiry_idx ON nv_esign_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS ns_rag_document_chunks (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL,
  document_id       VARCHAR(36) NOT NULL,
  job_id            VARCHAR(36) NOT NULL,
  chunk_index       INTEGER NOT NULL,
  content           TEXT NOT NULL,
  token_count       INTEGER DEFAULT 0,
  char_count        INTEGER DEFAULT 0,
  start_position    INTEGER DEFAULT 0,
  end_position      INTEGER DEFAULT 0,
  section_title     VARCHAR(500),
  chunk_metadata    JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_rag_chunks_org_doc_idx ON ns_rag_document_chunks(organization_id, document_id);

CREATE TABLE IF NOT EXISTS ns_document_graph (
  id                   SERIAL PRIMARY KEY,
  organization_id      INTEGER NOT NULL,
  source_document_id   VARCHAR(36) NOT NULL,
  target_document_id   VARCHAR(36) NOT NULL,
  relationship_type    VARCHAR(60) NOT NULL,
  confidence           REAL DEFAULT 0,
  metadata             JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_document_graph_org_idx ON ns_document_graph(organization_id, source_document_id);

CREATE TABLE IF NOT EXISTS nv_doc_share_grants (
  id                       BIGSERIAL PRIMARY KEY,
  document_id              TEXT NOT NULL,
  owner_org_id             TEXT NOT NULL,
  owner_platform_code      TEXT NOT NULL,
  granted_to_platform_code TEXT NOT NULL,
  granted_to_org_id        TEXT,
  grant_type               TEXT NOT NULL DEFAULT 'read',
  grant_reason             TEXT,
  threshold_bytes          BIGINT,
  storage_path             TEXT,
  shared_bucket            TEXT NOT NULL DEFAULT 'nyv-shared-documents',
  expires_at               TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  revoked_by               TEXT,
  revoke_reason            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               TEXT,
  audit_chain_hash         TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_doc_share_grants_doc ON nv_doc_share_grants(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_share_grants_owner ON nv_doc_share_grants(owner_org_id, owner_platform_code, created_at);
CREATE INDEX IF NOT EXISTS idx_doc_share_grants_granted ON nv_doc_share_grants(granted_to_platform_code, granted_to_org_id, document_id);
