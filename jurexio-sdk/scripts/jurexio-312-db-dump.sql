-- ══════════════════════════════════════════════════════════════════════════════
-- NYAYAVIGYA PLATFORM 3.1.2 — COMPLETE DATABASE DUMP
-- JRX-DB-DUMP-001 | April 04, 2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Covers:
--   • 80 tables across public schema + nv_schema
--   • All extensions, indexes, and constraints
--   • Full seed data: feature flags, jurisdictions, LLM providers,
--     organizations, users, SDK apps, MCP tools
--   • nv_schema: SHA-256 hash chain audit, GRPO telemetry,
--     SDK observability, async job queue
--
-- Usage:
--   psql $DATABASE_URL -f jurexio-312-db-dump.sql
--
-- Notes:
--   - Agents (452 records) are loaded from jrx-agents-registry.json via the
--     TypeScript seed script (jrx-seed-agents.ts). The JSON file is too large
--     for inline SQL and is the single source of truth.
--   - Statute DB is seeded separately via jrx-seed-statutes.ts which calls
--     the NyayavignaStatuteSeedingService.
--   - All INSERT statements use ON CONFLICT DO UPDATE (idempotent).
--   - Password hash below corresponds to: <operator-managed; see JRX-SECURITY-DOC-CREDS-001>  (bcrypt, cost 12)
--
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- SCHEMA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS nv_schema;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 · CORE INFRASTRUCTURE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_organizations (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,
  tier            VARCHAR(50) NOT NULL DEFAULT 'pro',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255),
  full_name       VARCHAR(255),
  role            VARCHAR(50) NOT NULL DEFAULT 'user',
  tier            VARCHAR(50) NOT NULL DEFAULT 'solo',
  org_id          INTEGER REFERENCES nv_organizations(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_sessions (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER NOT NULL REFERENCES nv_users(id) ON DELETE CASCADE,
  refresh_token   TEXT,
  expires_at      TIMESTAMP NOT NULL,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_auth_tokens (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES nv_users(id) ON DELETE CASCADE,
  token_hash      VARCHAR(255) UNIQUE NOT NULL,
  token_type      VARCHAR(50) NOT NULL DEFAULT 'access',
  is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at      TIMESTAMP NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 · AGENT MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_agents (
  id              VARCHAR(50) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  subcategory     VARCHAR(100),
  description     TEXT,
  jurisdiction    TEXT[] DEFAULT '{}',
  statutes        TEXT[] DEFAULT '{}',
  capabilities    TEXT[] DEFAULT '{}',
  default_model   VARCHAR(100),
  fallback_model  VARCHAR(100),
  tier_required   VARCHAR(50) NOT NULL DEFAULT 'solo',
  language_support TEXT[] DEFAULT '{en}',
  system_prompt_key VARCHAR(200),
  tools           TEXT[] DEFAULT '{}',
  roma_level      INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_agent_configs (
  id              SERIAL PRIMARY KEY,
  agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
  model_override  VARCHAR(100),
  temperature     FLOAT DEFAULT 0.7,
  max_tokens      INTEGER DEFAULT 4096,
  top_p           FLOAT DEFAULT 1.0,
  custom_params   JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_agent_performance (
  id              SERIAL PRIMARY KEY,
  agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
  avg_latency_ms  FLOAT,
  success_rate    FLOAT,
  total_calls     INTEGER DEFAULT 0,
  tokens_used     BIGINT DEFAULT 0,
  cost_usd        FLOAT DEFAULT 0,
  period_start    TIMESTAMP,
  period_end      TIMESTAMP,
  recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_agent_personas (
  id              SERIAL PRIMARY KEY,
  agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  persona_prompt  TEXT NOT NULL,
  jurisdiction    VARCHAR(50),
  language        VARCHAR(10) DEFAULT 'en',
  created_by      INTEGER REFERENCES nv_users(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_roma_levels (
  id              SERIAL PRIMARY KEY,
  agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
  level           INTEGER NOT NULL DEFAULT 1,
  promoted_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  trigger_reason  TEXT,
  confidence_score FLOAT
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 · SDK AND API MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_sdk_applications (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(255) NOT NULL,
  app_type        VARCHAR(100) NOT NULL,
  jurisdiction    VARCHAR(10) NOT NULL DEFAULT 'IN',
  owner_id        INTEGER REFERENCES nv_users(id),
  org_id          INTEGER REFERENCES nv_organizations(id),
  tier            VARCHAR(50) NOT NULL DEFAULT 'solo',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_api_keys (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app_id          VARCHAR(36) REFERENCES nv_sdk_applications(id) ON DELETE CASCADE,
  key_prefix      VARCHAR(20) NOT NULL,
  key_hash        VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  permissions     TEXT[] DEFAULT '{}',
  rate_limit      INTEGER DEFAULT 1000,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMP,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_sdk_usage_metrics (
  id              SERIAL PRIMARY KEY,
  app_id          VARCHAR(36) REFERENCES nv_sdk_applications(id) ON DELETE CASCADE,
  endpoint        VARCHAR(255),
  method          VARCHAR(10),
  status_code     INTEGER,
  latency_ms      INTEGER,
  tokens_in       INTEGER DEFAULT 0,
  tokens_out      INTEGER DEFAULT 0,
  cost_usd        FLOAT DEFAULT 0,
  agent_id        VARCHAR(50),
  recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Extended SDK Application Tables ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sdk_applications (
  id                    SERIAL PRIMARY KEY,
  organization_id       INTEGER,
  app_name              VARCHAR(255) NOT NULL,
  app_type              VARCHAR(100) NOT NULL,
  description           TEXT,
  client_id             VARCHAR(100) UNIQUE NOT NULL,
  client_secret_hash    VARCHAR(255) NOT NULL,
  client_secret_prefix  VARCHAR(20),
  allowed_agents        JSONB DEFAULT '[]',
  llm_config            JSONB DEFAULT '{}',
  rate_limit_per_minute INTEGER DEFAULT 60,
  daily_token_budget    INTEGER DEFAULT 100000,
  monthly_token_budget  INTEGER DEFAULT 1000000,
  allowed_origins       JSONB DEFAULT '[]',
  jurisdiction          VARCHAR(10) DEFAULT 'IN',
  metadata              JSONB DEFAULT '{}',
  status                VARCHAR(50) DEFAULT 'active',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_app_api_keys (
  id              SERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  key_prefix      VARCHAR(20) NOT NULL,
  key_hash        VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  permissions     TEXT[] DEFAULT '{}',
  rate_limit      INTEGER DEFAULT 1000,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMP,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_app_agent_allocations (
  id              SERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  agent_id        VARCHAR(50),
  tier_override   VARCHAR(50),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_api_request_logs (
  id              BIGSERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id),
  api_key_id      INTEGER REFERENCES sdk_app_api_keys(id),
  endpoint        VARCHAR(500),
  method          VARCHAR(10),
  status_code     INTEGER,
  latency_ms      INTEGER,
  tokens_in       INTEGER DEFAULT 0,
  tokens_out      INTEGER DEFAULT 0,
  cost_usd        FLOAT DEFAULT 0,
  agent_id        VARCHAR(100),
  jurisdiction    VARCHAR(10),
  ip_address      VARCHAR(45),
  error_message   TEXT,
  metadata        JSONB DEFAULT '{}',
  recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_clause_library (
  id              SERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  clause_title    VARCHAR(500) NOT NULL,
  clause_text     TEXT NOT NULL,
  clause_type     VARCHAR(100),
  jurisdiction    VARCHAR(10) DEFAULT 'IN',
  tags            TEXT[] DEFAULT '{}',
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_compliance_controls (
  id              SERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  control_name    VARCHAR(255) NOT NULL,
  control_type    VARCHAR(100),
  description     TEXT,
  jurisdiction    VARCHAR(10) DEFAULT 'IN',
  statute         VARCHAR(200),
  is_active       BOOLEAN DEFAULT TRUE,
  config          JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_document_templates (
  id              SERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  template_type   VARCHAR(100),
  jurisdiction    VARCHAR(10) DEFAULT 'IN',
  content         TEXT,
  variables       JSONB DEFAULT '[]',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_usage_metering (
  id              BIGSERIAL PRIMARY KEY,
  app_id          INTEGER REFERENCES sdk_applications(id),
  billing_period  VARCHAR(20),
  tokens_in       BIGINT DEFAULT 0,
  tokens_out      BIGINT DEFAULT 0,
  api_calls       INTEGER DEFAULT 0,
  cost_usd        FLOAT DEFAULT 0,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_workflows (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  app_id          INTEGER REFERENCES sdk_applications(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  dag_definition  JSONB NOT NULL DEFAULT '{}',
  status          VARCHAR(50) DEFAULT 'draft',
  created_by      INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sdk_workflow_executions (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id     VARCHAR(36) REFERENCES sdk_workflows(id) ON DELETE CASCADE,
  status          VARCHAR(50) DEFAULT 'pending',
  input           JSONB DEFAULT '{}',
  output          JSONB DEFAULT '{}',
  error           TEXT,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 · LLM AND MODEL MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_llm_providers (
  id              SERIAL PRIMARY KEY,
  provider_id     VARCHAR(100) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  api_base_url    VARCHAR(500),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  capabilities    TEXT[] DEFAULT '{}',
  supported_models JSONB DEFAULT '[]',
  rate_limits     JSONB DEFAULT '{}',
  cost_per_1k_tokens_in  FLOAT,
  cost_per_1k_tokens_out FLOAT,
  avg_latency_ms  FLOAT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_model_catalog (
  id              SERIAL PRIMARY KEY,
  model_id        VARCHAR(200) UNIQUE NOT NULL,
  provider_id     VARCHAR(100),
  display_name    VARCHAR(255) NOT NULL,
  context_window  INTEGER,
  max_output_tokens INTEGER,
  supports_vision BOOLEAN DEFAULT FALSE,
  supports_tools  BOOLEAN DEFAULT FALSE,
  cost_per_1k_in  FLOAT,
  cost_per_1k_out FLOAT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_token_metrics (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES nv_users(id),
  app_id          VARCHAR(36),
  agent_id        VARCHAR(50),
  provider_id     VARCHAR(100),
  model_id        VARCHAR(200),
  tokens_in       INTEGER DEFAULT 0,
  tokens_out      INTEGER DEFAULT 0,
  cost_usd        FLOAT DEFAULT 0,
  request_id      VARCHAR(36),
  recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 · ORCHESTRATION
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_orchestration_jobs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type            VARCHAR(100) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  agent_id        VARCHAR(50),
  input           JSONB,
  output          JSONB,
  error           TEXT,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  user_id         INTEGER REFERENCES nv_users(id),
  app_id          VARCHAR(36),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_dag_jobs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(255) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  dag_definition  JSONB NOT NULL,
  results         JSONB DEFAULT '{}',
  user_id         INTEGER REFERENCES nv_users(id),
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_job_queue (
  id              SERIAL PRIMARY KEY,
  job_type        VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'queued',
  priority        INTEGER DEFAULT 5,
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 3,
  next_retry_at   TIMESTAMP,
  error           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_hitl_queue (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id        VARCHAR(50),
  task_type       VARCHAR(100) NOT NULL,
  context         JSONB NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  assigned_to     INTEGER REFERENCES nv_users(id),
  priority        VARCHAR(20) DEFAULT 'normal',
  deadline_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_hitl_decisions (
  id              SERIAL PRIMARY KEY,
  hitl_id         VARCHAR(36) REFERENCES nv_hitl_queue(id) ON DELETE CASCADE,
  decision        VARCHAR(50) NOT NULL,
  reasoning       TEXT,
  decided_by      INTEGER REFERENCES nv_users(id),
  decided_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_bmad_clusters (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(255) NOT NULL,
  agent_ids       TEXT[] NOT NULL DEFAULT '{}',
  status          VARCHAR(50) NOT NULL DEFAULT 'forming',
  task            TEXT,
  result          JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nv_grpo_runs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id        VARCHAR(50),
  model           VARCHAR(200),
  status          VARCHAR(50) NOT NULL DEFAULT 'running',
  config          JSONB DEFAULT '{}',
  metrics         JSONB DEFAULT '{}',
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMP
);

-- ── Jurexio Orchestration Jobs (product-level) ─────────────────────────────

CREATE TABLE IF NOT EXISTS nyayavigya_orchestration_jobs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_type        VARCHAR(100) NOT NULL,
  agent_id        VARCHAR(100),
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  input           JSONB DEFAULT '{}',
  output          JSONB DEFAULT '{}',
  error           TEXT,
  priority        INTEGER DEFAULT 5,
  user_id         INTEGER,
  org_id          INTEGER,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 · KNOWLEDGE, DOCUMENTS, AND RAG
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_documents (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(500) NOT NULL,
  file_type       VARCHAR(50),
  file_size_bytes BIGINT,
  storage_url     TEXT,
  status          VARCHAR(50) DEFAULT 'uploaded',
  user_id         INTEGER REFERENCES nv_users(id),
  app_id          VARCHAR(36),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_rag_documents (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title           VARCHAR(500) NOT NULL,
  content         TEXT,
  doc_type        VARCHAR(100),
  jurisdiction    VARCHAR(50),
  statute         VARCHAR(200),
  indexed_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS nv_rag_chunks (
  id              SERIAL PRIMARY KEY,
  doc_id          VARCHAR(36) REFERENCES nv_rag_documents(id) ON DELETE CASCADE,
  chunk_text      TEXT NOT NULL,
  chunk_index     INTEGER,
  embedding_model VARCHAR(100),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_document_embeddings (
  id              SERIAL PRIMARY KEY,
  document_id     INTEGER,
  chunk_id        VARCHAR(100),
  user_id         VARCHAR(100),
  assistant_id    INTEGER,
  text            TEXT,
  text_hash       VARCHAR(64),
  embedding       DOUBLE PRECISION[],
  model           VARCHAR(100),
  provider        VARCHAR(100),
  dimensions      INTEGER,
  chunk_index     INTEGER,
  start_position  INTEGER,
  end_position    INTEGER,
  word_count      INTEGER,
  character_count INTEGER,
  document_type   VARCHAR(100),
  source_file_name VARCHAR(500),
  metadata        JSONB DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Document Processing Pipeline ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_parsing (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  original_name   VARCHAR(500),
  file_type       VARCHAR(50),
  file_size_bytes BIGINT,
  storage_url     TEXT,
  status          VARCHAR(50) DEFAULT 'queued',
  page_count      INTEGER,
  error           TEXT,
  user_id         INTEGER,
  app_id          VARCHAR(36),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_pages (
  id              SERIAL PRIMARY KEY,
  document_id     VARCHAR(36) REFERENCES document_parsing(id) ON DELETE CASCADE,
  page_number     INTEGER NOT NULL,
  raw_text        TEXT,
  layout_json     JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_extracted_content (
  id              SERIAL PRIMARY KEY,
  document_id     VARCHAR(36) REFERENCES document_parsing(id) ON DELETE CASCADE,
  content_type    VARCHAR(100),
  content         TEXT,
  page_start      INTEGER,
  page_end        INTEGER,
  confidence      FLOAT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id     VARCHAR(36) REFERENCES document_parsing(id),
  job_type        VARCHAR(100) NOT NULL,
  status          VARCHAR(50) DEFAULT 'pending',
  priority        INTEGER DEFAULT 5,
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 3,
  error           TEXT,
  result          JSONB DEFAULT '{}',
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Nyayasiddhi Document Processing ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ns_doc_processing_jobs (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          INTEGER,
  document_id     VARCHAR(36),
  document_type   VARCHAR(100),
  extraction_mode VARCHAR(50) DEFAULT 'full',
  status          VARCHAR(50) DEFAULT 'queued',
  progress        INTEGER DEFAULT 0,
  file_name       VARCHAR(500),
  file_size_bytes BIGINT DEFAULT 0,
  priority        INTEGER DEFAULT 5,
  retry_count     INTEGER DEFAULT 0,
  max_retries     INTEGER DEFAULT 3,
  worker_id       VARCHAR(200),
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  error           TEXT,
  result          JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7 · MEMORY AND CONTEXT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_memory_entries (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER REFERENCES nv_users(id),
  agent_id        VARCHAR(50),
  session_id      VARCHAR(36),
  content         TEXT NOT NULL,
  entry_type      VARCHAR(50) DEFAULT 'fact',
  importance      INTEGER DEFAULT 5,
  tags            TEXT[] DEFAULT '{}',
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_chat_sessions (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER REFERENCES nv_users(id),
  agent_id        VARCHAR(50),
  app_id          VARCHAR(36),
  messages        JSONB DEFAULT '[]',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Founder Context Learning (NS-Queen memory layer) ─────────────────────────

CREATE TABLE IF NOT EXISTS nyayavigya_founder_context_profiles (
  id              SERIAL PRIMARY KEY,
  profile_key     VARCHAR(100) UNIQUE NOT NULL,
  profile_data    JSONB NOT NULL DEFAULT '{}',
  version         INTEGER DEFAULT 1,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nyayavigya_context_learning_history (
  id              SERIAL PRIMARY KEY,
  session_id      VARCHAR(36),
  input_summary   TEXT,
  learned_pattern TEXT,
  confidence      FLOAT DEFAULT 0.8,
  context_type    VARCHAR(100),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8 · MCP TOOLS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_mcp_tools (
  id              SERIAL PRIMARY KEY,
  tool_id         VARCHAR(100) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  tool_type       VARCHAR(100),
  config          JSONB DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_mcp_tool_calls (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tool_id         VARCHAR(100),
  input_params    JSONB,
  output_result   JSONB,
  status          VARCHAR(50) DEFAULT 'success',
  latency_ms      INTEGER,
  error           TEXT,
  called_by       INTEGER REFERENCES nv_users(id),
  called_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9 · AUDIT AND SECURITY
-- ══════════════════════════════════════════════════════════════════════════════

-- Note: public.nv_audit_logs is the general action log.
-- nv_schema.nv_audit_logs (Section 14) is the SHA-256 hash chain tamper-evidence log.

CREATE TABLE IF NOT EXISTS nv_audit_logs (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES nv_users(id),
  action          VARCHAR(200) NOT NULL,
  resource_type   VARCHAR(100),
  resource_id     VARCHAR(100),
  ip_address      VARCHAR(45),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_pii_vault (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER REFERENCES nv_users(id),
  field_type      VARCHAR(100) NOT NULL,
  encrypted_value TEXT NOT NULL,
  iv              TEXT,
  purpose         TEXT,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 10 · OPERATIONAL CONFIGURATION
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS nv_jurisdiction_configs (
  id              SERIAL PRIMARY KEY,
  jurisdiction    VARCHAR(10) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  legal_framework TEXT[] DEFAULT '{}',
  languages       TEXT[] DEFAULT '{}',
  currency        VARCHAR(10),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  config          JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS nv_feature_flags (
  id              SERIAL PRIMARY KEY,
  flag_key        VARCHAR(100) UNIQUE NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_system_configs (
  id              SERIAL PRIMARY KEY,
  config_key      VARCHAR(200) UNIQUE NOT NULL,
  config_value    TEXT NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_workspace_projects (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  user_id         INTEGER REFERENCES nv_users(id),
  app_id          VARCHAR(36),
  status          VARCHAR(50) DEFAULT 'active',
  config          JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_voice_sessions (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER REFERENCES nv_users(id),
  agent_id        VARCHAR(50),
  status          VARCHAR(50) DEFAULT 'active',
  language        VARCHAR(10) DEFAULT 'en',
  transcript      TEXT,
  audio_url       TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scoped_feature_flags (
  id              SERIAL PRIMARY KEY,
  flag_key        VARCHAR(200) NOT NULL,
  scope_type      VARCHAR(50) NOT NULL,
  scope_id        VARCHAR(100) NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(flag_key, scope_type, scope_id)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 11 · HITL WORKFLOWS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hitl_workflows (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  workflow_type   VARCHAR(100),
  trigger_config  JSONB DEFAULT '{}',
  steps           JSONB DEFAULT '[]',
  status          VARCHAR(50) DEFAULT 'active',
  created_by      INTEGER REFERENCES nv_users(id),
  org_id          INTEGER REFERENCES nv_organizations(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hitl_workflow_executions (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id     VARCHAR(36) REFERENCES hitl_workflows(id),
  status          VARCHAR(50) DEFAULT 'pending',
  current_step    INTEGER DEFAULT 0,
  context         JSONB DEFAULT '{}',
  assigned_to     INTEGER REFERENCES nv_users(id),
  decision        VARCHAR(100),
  reasoning       TEXT,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 12 · JRX EMAIL PROCESSING
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wai_email_accounts (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER REFERENCES nv_organizations(id),
  email_address   VARCHAR(255) NOT NULL,
  provider        VARCHAR(50) DEFAULT 'gmail',
  display_name    VARCHAR(255),
  access_token    TEXT,
  refresh_token   TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  last_synced_at  TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wai_emails (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id      INTEGER REFERENCES wai_email_accounts(id) ON DELETE CASCADE,
  message_id      VARCHAR(500) UNIQUE,
  subject         VARCHAR(1000),
  sender_email    VARCHAR(255),
  sender_name     VARCHAR(255),
  recipient_emails TEXT[] DEFAULT '{}',
  body_text       TEXT,
  body_html       TEXT,
  received_at     TIMESTAMP,
  is_processed    BOOLEAN DEFAULT FALSE,
  category        VARCHAR(100),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wai_email_processing (
  id              SERIAL PRIMARY KEY,
  email_id        VARCHAR(36) REFERENCES wai_emails(id) ON DELETE CASCADE,
  agent_id        VARCHAR(50),
  intent          VARCHAR(200),
  entities        JSONB DEFAULT '{}',
  sentiment       VARCHAR(50),
  urgency_score   FLOAT DEFAULT 0.5,
  suggested_action TEXT,
  processed_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wai_email_automation_rules (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER REFERENCES wai_email_accounts(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  conditions      JSONB NOT NULL DEFAULT '{}',
  actions         JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wai_email_responses (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email_id        VARCHAR(36) REFERENCES wai_emails(id) ON DELETE CASCADE,
  draft_content   TEXT NOT NULL,
  status          VARCHAR(50) DEFAULT 'draft',
  approved_by     INTEGER REFERENCES nv_users(id),
  sent_at         TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 13 · LEGAL AI — CASES, INSIGHTS, IDENTITY
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS legal_agents (
  id              VARCHAR(50) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  category        VARCHAR(100),
  subcategory     VARCHAR(100),
  description     TEXT,
  jurisdiction    TEXT[] DEFAULT '{}',
  statutes        TEXT[] DEFAULT '{}',
  capabilities    TEXT[] DEFAULT '{}',
  default_model   VARCHAR(100),
  tier_required   VARCHAR(50) DEFAULT 'solo',
  language_support TEXT[] DEFAULT '{en}',
  roma_level      INTEGER DEFAULT 1,
  is_active       BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_cases (
  id              SERIAL PRIMARY KEY,
  case_number     VARCHAR(200),
  case_type       VARCHAR(100),
  title           VARCHAR(500),
  status          VARCHAR(50) DEFAULT 'active',
  jurisdiction    VARCHAR(50) DEFAULT 'IN',
  court           VARCHAR(300),
  judge           VARCHAR(255),
  description     TEXT,
  outcome         TEXT,
  filing_date     DATE,
  hearing_date    DATE,
  resolution_date DATE,
  org_id          INTEGER REFERENCES nv_organizations(id),
  user_id         INTEGER REFERENCES nv_users(id),
  assigned_agent  VARCHAR(50),
  client_details  JSONB DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  insights_generated_at TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_case_documents (
  id              SERIAL PRIMARY KEY,
  case_id         INTEGER NOT NULL,
  document_id     INTEGER,
  added_by        INTEGER,
  document_role   VARCHAR(100) DEFAULT 'supporting',
  summary         TEXT,
  extracted_entities JSONB DEFAULT '{}',
  source          VARCHAR(100) DEFAULT 'upload',
  notes           TEXT,
  version         INTEGER DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_case_insights (
  id              SERIAL PRIMARY KEY,
  case_id         INTEGER NOT NULL,
  insight_type    VARCHAR(100),
  title           VARCHAR(500),
  content         TEXT,
  confidence      REAL DEFAULT 0.8,
  sources         JSONB DEFAULT '[]',
  agent_id        VARCHAR(100),
  orchestration_metadata JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nv_identity_extractions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER,
  organization_id INTEGER,
  document_id     INTEGER,
  document_type   VARCHAR(100),
  extracted_fields JSONB DEFAULT '{}',
  confidence      REAL DEFAULT 0.8,
  status          VARCHAR(50) DEFAULT 'extracted',
  agent_id        VARCHAR(100),
  orchestration_metadata JSONB DEFAULT '{}',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 14 · NV_SCHEMA — HASH CHAIN AUDIT + GRPO TELEMETRY + SDK TRACKING
-- ══════════════════════════════════════════════════════════════════════════════

-- SHA-256 Hash Chain Tamper-Evidence Audit Log
CREATE TABLE IF NOT EXISTS nv_schema.nv_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  record_hash   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nv_audit_logs_created ON nv_schema.nv_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nv_audit_logs_event   ON nv_schema.nv_audit_logs (event_type);

-- GRPO Pattern Telemetry (per execution, all 22 patterns)
CREATE TABLE IF NOT EXISTS nv_schema.nv_grpo_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key      TEXT NOT NULL,
  route            TEXT NOT NULL,
  agent_id         TEXT,
  jurisdiction     TEXT,
  task_hash        TEXT,
  response_snippet TEXT,
  reward           DOUBLE PRECISION,
  policy_updated   BOOLEAN DEFAULT FALSE,
  total_episodes   INTEGER DEFAULT 0,
  avg_reward       DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nv_grpo_runs_pattern ON nv_schema.nv_grpo_runs (pattern_key);
CREATE INDEX IF NOT EXISTS idx_nv_grpo_runs_created ON nv_schema.nv_grpo_runs (created_at DESC);

-- SDK API Observability (per HTTP request, SDK-key authenticated)
CREATE TABLE IF NOT EXISTS nv_schema.sdk_api_request_logs (
  id            BIGSERIAL PRIMARY KEY,
  trace_id      TEXT UNIQUE NOT NULL,
  app_id        TEXT NOT NULL,
  org_id        TEXT NOT NULL,
  route         TEXT NOT NULL,
  method        TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  tokens_used   INTEGER DEFAULT 0,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdk_logs_app_id  ON nv_schema.sdk_api_request_logs (app_id);
CREATE INDEX IF NOT EXISTS idx_sdk_logs_created ON nv_schema.sdk_api_request_logs (created_at DESC);

-- Async Job Queue (patterns interceptor for large document jobs)
DROP TABLE IF EXISTS nv_schema.async_job_queue CASCADE;

CREATE TABLE nv_schema.async_job_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name  TEXT NOT NULL DEFAULT 'default',
  task_type   TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_async_jobs_queue   ON nv_schema.async_job_queue (queue_name, status);
CREATE INDEX IF NOT EXISTS idx_async_jobs_created ON nv_schema.async_job_queue (created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 15 · SEED DATA
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.1 Feature Flags (15 flags, all enabled)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_feature_flags (flag_key, is_enabled, description) VALUES
  ('nv_avatar_sessions',    TRUE, 'Avatar session API (GAP-020)'),
  ('nv_grpo_training',      TRUE, 'GRPO optimization training runs'),
  ('nv_bmad_clusters',      TRUE, 'BMAD agent cluster formation'),
  ('nv_a2a_collaboration',  TRUE, 'Agent-to-Agent collaboration bus'),
  ('nv_voice_sessions',     TRUE, 'Voice WebSocket sessions'),
  ('nv_mcp_tools',          TRUE, 'MCP tool execution (GitHub, DB, SQS)'),
  ('nv_parlant_journeys',   TRUE, 'Parlant 7-template journeys'),
  ('nv_digital_twin',       TRUE, 'Digital twin simulation'),
  ('nv_multimodal',         TRUE, 'Multimodal (vision + audio) processing'),
  ('nv_hallucination_check',TRUE, 'Hallucination detection on all responses'),
  ('nv_pii_vault',          TRUE, 'PII vault encryption storage'),
  ('nv_rag_search',         TRUE, 'RAG semantic search on documents'),
  ('nv_social_memory',      TRUE, 'Cross-session social memory'),
  ('nv_cost_analytics',     TRUE, 'Per-request cost analytics'),
  ('nv_real_time_events',   TRUE, 'WebSocket real-time event push')
ON CONFLICT (flag_key) DO UPDATE
  SET is_enabled  = EXCLUDED.is_enabled,
      description = EXCLUDED.description,
      updated_at  = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.2 Jurisdiction Configs (6 canonical jurisdictions)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_jurisdiction_configs (jurisdiction, name, legal_framework, languages, currency) VALUES
  ('IN', 'India',
   ARRAY['Constitution of India 1950','BNS 2023 (Bharatiya Nyaya Sanhita)','BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita)','BSA 2023 (Bharatiya Sakshya Adhiniyam)','CPC 1908','Companies Act 2013','DPDPA 2023 (Digital Personal Data Protection Act)','Income Tax Act 1961','GST Laws 2017','Arbitration and Conciliation Act 1996'],
   ARRAY['en','hi','ta','te','kn','ml','mr','gu','pa','bn','or','as','ur','sa','kok','mai','mni','ks','sd','doi','sat'],
   'INR'),
  ('UK', 'United Kingdom',
   ARRAY['UK GDPR','Data Protection Act 2018','Companies Act 2006','Employment Rights Act 1996','Equality Act 2010','Arbitration Act 1996','Financial Services and Markets Act 2000','Proceeds of Crime Act 2002','Consumer Rights Act 2015','UK AI Regulation Framework 2024'],
   ARRAY['en','cy','gd'],
   'GBP'),
  ('GC', 'GCC (Gulf Cooperation Council)',
   ARRAY['UAE Federal Law','UAE Civil Code (Federal Law No. 5/1985)','DIFC Laws and Regulations','ADGM Laws and Regulations','Saudi Commercial Law','Saudi Labor Law','GCC Common Market Agreement','GCC Cybercrime Law','PDPL (Saudi Personal Data Protection Law)','UAE Federal Decree-Law No. 45/2021 (Data Protection)'],
   ARRAY['en','ar'],
   'AED'),
  ('EU', 'European Union',
   ARRAY['GDPR (General Data Protection Regulation)','EU AI Act 2024','Digital Services Act (DSA)','Digital Markets Act (DMA)','NIS2 Directive','ePrivacy Directive','ECHR (European Convention on Human Rights)','EU Consumer Rights Directive'],
   ARRAY['en','fr','de','es','it','nl','pl','pt','ro','sv','da','fi'],
   'EUR'),
  ('US', 'United States',
   ARRAY['US Federal Constitution','Uniform Commercial Code (UCC)','CCPA (California Consumer Privacy Act)','HIPAA','SOX (Sarbanes-Oxley Act)','SEC Regulations','Federal Rules of Civil Procedure','Federal Rules of Evidence','State Laws (50 states)'],
   ARRAY['en','es'],
   'USD'),
  ('SG', 'Singapore',
   ARRAY['Singapore Companies Act 1967','PDPA (Personal Data Protection Act 2012)','Employment Act (Cap. 91)','Electronic Transactions Act','Securities and Futures Act','Arbitration Act','MAS (Monetary Authority of Singapore) Regulations'],
   ARRAY['en','zh','ms','ta'],
   'SGD')
ON CONFLICT (jurisdiction) DO UPDATE
  SET name           = EXCLUDED.name,
      legal_framework = EXCLUDED.legal_framework,
      languages       = EXCLUDED.languages;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.3 LLM Providers (23 providers)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_llm_providers (provider_id, name, capabilities, is_active, cost_per_1k_tokens_in, cost_per_1k_tokens_out, avg_latency_ms) VALUES
  ('openai',       'OpenAI',           ARRAY['chat','vision','tools','embeddings','tts','stt'],             TRUE, 0.005,    0.015,    800),
  ('anthropic',    'Anthropic',        ARRAY['chat','vision','tools','long-context'],                       TRUE, 0.003,    0.015,    1200),
  ('google',       'Google GenAI',     ARRAY['chat','vision','tools','long-context','multimodal'],          TRUE, 0.0015,   0.006,    700),
  ('openrouter',   'OpenRouter',       ARRAY['chat','vision','tools','multi-model'],                        TRUE, 0.001,    0.003,    900),
  ('groq',         'Groq',             ARRAY['chat','fast-inference','tools'],                              TRUE, 0.0001,   0.0001,   200),
  ('perplexity',   'Perplexity AI',    ARRAY['chat','search','real-time'],                                  TRUE, 0.001,    0.001,    1500),
  ('mistral',      'Mistral AI',       ARRAY['chat','tools','embeddings'],                                  TRUE, 0.0002,   0.0006,   600),
  ('sarvam',       'Sarvam AI',        ARRAY['chat','tts','stt','translation','indic-languages'],           TRUE, 0.0001,   0.0002,   500),
  ('replicate',    'Replicate',        ARRAY['image-gen','video-gen','audio','custom-models'],              TRUE, 0.0005,   0.001,    3000),
  ('together',     'Together AI',      ARRAY['chat','tools','fine-tuning','embeddings'],                    TRUE, 0.0002,   0.0002,   400),
  ('cohere',       'Cohere',           ARRAY['chat','embeddings','rerank','classification'],                TRUE, 0.0003,   0.0015,   700),
  ('fireworks',    'Fireworks AI',     ARRAY['chat','fast-inference','tools'],                              TRUE, 0.0001,   0.0001,   250),
  ('deepseek',     'DeepSeek',         ARRAY['chat','reasoning','tools','code'],                            TRUE, 0.00014,  0.00028,  800),
  ('qwen',         'Alibaba Qwen',     ARRAY['chat','vision','tools','long-context'],                       TRUE, 0.0002,   0.0006,   900),
  ('kimi',         'Kimi (Moonshot)',  ARRAY['chat','long-context','tools'],                                TRUE, 0.0001,   0.0003,   1000),
  ('llama',        'Meta LLaMA',       ARRAY['chat','tools','open-source'],                                 TRUE, 0.0001,   0.0001,   300),
  ('gemma',        'Google Gemma',     ARRAY['chat','open-source','lightweight'],                           TRUE, 0.00005,  0.0001,   200),
  ('nvidia',       'NVIDIA NIM',       ARRAY['chat','vision','tools','enterprise'],                         TRUE, 0.0003,   0.0009,   500),
  ('azure-openai', 'Azure OpenAI',     ARRAY['chat','vision','tools','enterprise'],                         TRUE, 0.005,    0.015,    900),
  ('aws-bedrock',  'AWS Bedrock',      ARRAY['chat','vision','tools','enterprise'],                         TRUE, 0.003,    0.015,    1000),
  ('huggingface',  'Hugging Face',     ARRAY['chat','embeddings','custom-models','open-source'],            TRUE, 0.0001,   0.0001,   2000),
  ('exa',          'Exa (Search AI)',  ARRAY['search','retrieval','rag'],                                   TRUE, 0.001,    0.001,    800),
  ('tavily',       'Tavily Search',    ARRAY['search','retrieval','real-time'],                             TRUE, 0.0005,   0.0005,   1000)
ON CONFLICT (provider_id) DO UPDATE
  SET name           = EXCLUDED.name,
      capabilities   = EXCLUDED.capabilities,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      updated_at     = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.4 Demo Organizations (4 orgs)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_organizations (name, slug, tier) VALUES
  ('Jurexio Technologies',          'jurexio-tech',  'enterprise'),
  ('Demo Law Firm (Pro)',               'demo-law-firm-pro','pro'),
  ('Demo Legal Department (Plus)',      'demo-legal-dept',  'plus'),
  ('Demo Bar Association (Enterprise)','demo-bar-assoc',   'enterprise')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.5 Demo Users (6 users — password: <operator-managed; see JRX-SECURITY-DOC-CREDS-001>)
-- bcrypt hash of '<operator-managed; see JRX-SECURITY-DOC-CREDS-001>' at cost 12
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_users (email, password_hash, full_name, role, tier) VALUES
  ('admin@jurexio.com',         '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'SDK Administrator', 'super_admin', 'enterprise'),
  ('dev@demo.jurexio.com',      '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'Demo Developer',   'developer',   'pro'),
  ('analyst@demo.jurexio.com',  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'Demo Analyst',     'analyst',     'plus'),
  ('operator@demo.jurexio.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'Demo Operator',    'operator',    'pro'),
  ('manager@demo.jurexio.com',  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'Demo Manager',     'manager',     'enterprise'),
  ('user@demo.jurexio.com',     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhcanFp8.ot669V5j2BXOC', 'Demo User',        'user',        'solo')
ON CONFLICT (email) DO UPDATE
  SET role      = EXCLUDED.role,
      tier      = EXCLUDED.tier,
      full_name = EXCLUDED.full_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.6 Demo SDK Applications (5 apps)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_sdk_applications (id, name, app_type, jurisdiction, tier) VALUES
  ('nvsdkapp-demo-nsp-001',      'Nyayasiddhi Professional™ Integration',  'nyayasiddhi_professional',  'IN', 'pro'),
  ('nvsdkapp-demo-nm-001',       'Jurexio Citizen Citizen App Integration',      'jurexio-citizen',                'IN', 'plus'),
  ('nvsdkapp-demo-playground-001','SDK Playground (Developer Testing)',      'custom',                    'IN', 'solo'),
  ('nvsdkapp-demo-nyi-001',      'Nyayasiddhi Institutional™ Integration',  'nyayasiddhi_institutional', 'IN', 'enterprise'),
  ('nvsdkapp-demo-academy-001',  'Nyayasiddhi Academy™ Integration',        'nyayasiddhi_academy',       'IN', 'pro')
ON CONFLICT (id) DO UPDATE
  SET name     = EXCLUDED.name,
      app_type = EXCLUDED.app_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.7 MCP Tools (10 tools)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_mcp_tools (tool_id, name, description, tool_type, is_active) VALUES
  ('JRX-MCP-GITHUB-001',   'GitHub Repository Tool',    'Read/write GitHub repos, create PRs, manage issues',                      'github',    TRUE),
  ('JRX-MCP-DBQUERY-001',  'Database Query Tool',       'Execute safe read-only SQL queries against NV databases',                 'db-query',  TRUE),
  ('JRX-MCP-SQS-001',      'SQS Batch Processing Tool', 'Push batch jobs to AWS SQS for async processing',                         'sqs-batch', TRUE),
  ('JRX-MCP-SEARCH-001',   'Web Search Tool',           'Real-time web search via Exa / Tavily / Perplexity',                      'search',    TRUE),
  ('JRX-MCP-SCRAPE-001',   'Web Scraping Tool',         'Extract structured content from legal websites',                          'scrape',    TRUE),
  ('JRX-MCP-DOC-001',      'Document Processing Tool',  'Extract, analyze, and summarize legal documents (PDF, DOCX)',             'document',  TRUE),
  ('JRX-MCP-CODE-001',     'Code Execution Tool',       'Safe sandboxed JavaScript/Python execution via vm2',                      'code',      TRUE),
  ('JRX-MCP-STORAGE-001',  'Storage Tool',              'Read/write files to GCS / Replit Object Storage',                         'storage',   TRUE),
  ('JRX-MCP-EMAIL-001',    'Email Notification Tool',   'Send email notifications via SMTP',                                       'email',     TRUE),
  ('JRX-MCP-CALENDAR-001', 'Calendar Tool',             'Create legal deadline reminders and court date events',                    'calendar',  TRUE)
ON CONFLICT (tool_id) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15.8 System Configs (platform constants)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nv_system_configs (config_key, config_value, description) VALUES
  ('platform.version',          '3.1.2',                     'Platform version — stays 312 until live production'),
  ('platform.name',             'Jurexio Platform',       'Platform display name'),
  ('platform.agent_count',      '149',                       'Total agent count: 148 domain + 1 NS-Queen'),
  ('platform.launch_target',    'September 2026',            'First release: India, UK, USA'),
  ('platform.api_prefix',       '/api/nv/',                  'API prefix (NEVER /api/nyv/)'),
  ('platform.jurisdictions',    'IN,UK,GC,EU,US,SG',         'Canonical 6 jurisdictions'),
  ('platform.patterns_count',   '22',                        'Total ROMA L5 patterns (P01–P22)'),
  ('grpo.min_pairs_for_update', '20',                        'Minimum training pairs before GRPO policy update'),
  ('grpo.default_reward',       '0.7',                       'Default GRPO reward if evaluation unavailable'),
  ('sdk.rate_limit_default',    '1000',                      'Default API key rate limit per hour'),
  ('audit.chain_algo',          'sha256',                    'Hash chain algorithm for nv_schema.nv_audit_logs'),
  ('pii.expiry_minutes',        '30',                        'Default PII vault entry expiry in minutes'),
  ('hitl.default_priority',     'normal',                    'Default HITL queue priority'),
  ('llm.default_model',         'claude-opus-4-6',           'Platform default LLM model'),
  ('llm.fallback_model',        'gpt-4.1',                   'Platform fallback LLM model')
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      description  = EXCLUDED.description,
      updated_at   = NOW();

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- POST-DUMP NOTES
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The following seed data is NOT inline here — run the TypeScript seed scripts:
--
--   npx tsx scripts/jrx-seed-agents.ts
--       Loads 452 ROMA L5 agents from src/data/jrx-agents-registry.json
--
--   npx tsx scripts/jrx-seed-statutes.ts
--       Seeds statute DB (IN, UK, US, EU, GCC, SG) via NyayavignStatuteSeedingService
--       ~200+ statute sections per jurisdiction
--
-- Full seed order (jrx-seed-all.ts):
--   1. jrx-seed-feature-flags.ts
--   2. jrx-seed-jurisdictions.ts
--   3. jrx-seed-llm-providers.ts
--   4. jrx-seed-organizations.ts
--   5. jrx-seed-users.ts
--   6. jrx-seed-sdk-apps.ts
--   7. jrx-seed-agents.ts       ← requires jrx-agents-registry.json
--   8. jrx-seed-mcp-tools.ts
--   9. jrx-seed-statutes.ts     ← requires NyayavignStatuteSeedingService
--
-- ══════════════════════════════════════════════════════════════════════════════
-- END OF DUMP — Jurexio Platform 3.1.2 | JRX-DB-DUMP-001 | April 04, 2026
-- ══════════════════════════════════════════════════════════════════════════════
