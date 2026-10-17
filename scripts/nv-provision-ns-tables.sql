-- Nyayavigya Platform 3.1.2 — ns_* table provisioning
-- NYV-PROD-NS-PROVISION-001  (April 27, 2026)
--
-- Idempotent CREATE TABLE IF NOT EXISTS for the four document-pipeline
-- tables backing src/services/document-pipeline/production-doc-processor.ts.
-- Without these, the 3-second poller logs a single "DISABLED" warn (after
-- this session's checkPollerDependenciesOrSkip() guard) and never processes
-- jobs.
--
-- Why this is preferred over `npm run db:push --force` on prod:
--   The repo's drizzle.config.ts loads FIVE schema files covering hundreds
--   of tables. Running --force on prod RDS would compare every one of
--   those tables against the local TypeScript and apply any drift it finds
--   — potentially destructive on tables not touched in this session.
--   IF NOT EXISTS keeps the change surgical: only the 4 missing tables
--   (and their indexes) are created. Existing tables — including the
--   already-present nv_schema.model_governance and nv_schema.nv_audit_logs
--   — are left untouched.
--
-- Re-running this script is a no-op.

BEGIN;

-- ── 1. ns_doc_processing_jobs ────────────────────────────────────────
-- The poller's primary work queue. status/priority/created_at index is
-- the hot path; org_idx supports the per-tenant listing endpoint.
CREATE TABLE IF NOT EXISTS ns_doc_processing_jobs (
  id               varchar(36)              PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           integer                  NOT NULL,
  document_id      varchar(36),
  document_type    varchar(50)              DEFAULT 'text',
  extraction_mode  varchar(50)              DEFAULT 'full',
  status           varchar(30)              NOT NULL DEFAULT 'queued',
  progress         integer                  NOT NULL DEFAULT 0,
  file_name        varchar(500),
  file_size_bytes  integer                  DEFAULT 0,
  priority         integer                  NOT NULL DEFAULT 5,
  worker_id        varchar(100),
  started_at       timestamp with time zone,
  completed_at     timestamp with time zone,
  retry_count      integer                  NOT NULL DEFAULT 0,
  max_retries      integer                  NOT NULL DEFAULT 3,
  error_message    text,
  result           jsonb,
  storage_path     text,
  parsed_json_path text,
  metadata         jsonb                    DEFAULT '{}'::jsonb,
  created_at       timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at       timestamp with time zone NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_doc_jobs_poller_idx
  ON ns_doc_processing_jobs (status, priority, created_at);
CREATE INDEX IF NOT EXISTS ns_doc_jobs_org_idx
  ON ns_doc_processing_jobs (org_id, created_at);

-- ── 2. ns_parsed_documents ───────────────────────────────────────────
-- Output of the document parser. Unique on job_id so the poller can
-- reliably find "the parsed result for this job" without duplicates.
CREATE TABLE IF NOT EXISTS ns_parsed_documents (
  id                  serial                   PRIMARY KEY,
  organization_id     integer                  NOT NULL,
  document_id         varchar(36)              NOT NULL,
  job_id              varchar(36)              NOT NULL,
  file_name           varchar(500),
  file_type           varchar(50),
  file_size_bytes     integer                  DEFAULT 0,
  mime_type           varchar(100),
  storage_path        text,
  parsed_json_path    text,
  raw_content         text,
  parsed_content      jsonb,
  metadata            jsonb                    DEFAULT '{}'::jsonb,
  statistics          jsonb                    DEFAULT '{}'::jsonb,
  entities            jsonb                    DEFAULT '[]'::jsonb,
  sections            jsonb                    DEFAULT '[]'::jsonb,
  obligations         jsonb                    DEFAULT '[]'::jsonb,
  risks               jsonb                    DEFAULT '[]'::jsonb,
  deadlines           jsonb                    DEFAULT '[]'::jsonb,
  language            varchar(10)              DEFAULT 'en',
  jurisdiction        varchar(10),
  document_class      varchar(100),
  page_count          integer                  DEFAULT 0,
  word_count          integer                  DEFAULT 0,
  processing_time_ms  integer                  DEFAULT 0,
  status              varchar(30)              DEFAULT 'completed',
  created_by          varchar(100),
  created_at          timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at          timestamp with time zone NOT NULL DEFAULT NOW(),
  deleted_at          timestamp with time zone
);
CREATE INDEX IF NOT EXISTS ns_parsed_docs_org_doc_idx
  ON ns_parsed_documents (organization_id, document_id);
CREATE UNIQUE INDEX IF NOT EXISTS ns_parsed_docs_job_uniq
  ON ns_parsed_documents (job_id);

-- ── 3. ns_rag_document_chunks ────────────────────────────────────────
-- Chunk-level RAG store, separate from the citation-canonical
-- knowledge_chunks (which holds the seeded statute corpus). The
-- pgvector embedding column is added at runtime by document-pipeline
-- only when pgvector is present; keeping it out of the schema lets
-- this provisioning run on Postgres installs without the extension.
CREATE TABLE IF NOT EXISTS ns_rag_document_chunks (
  id              bigserial                PRIMARY KEY,
  organization_id integer                  NOT NULL,
  document_id     varchar(36)              NOT NULL,
  job_id          varchar(36)              NOT NULL,
  chunk_index     integer                  NOT NULL,
  content         text                     NOT NULL,
  token_count     integer                  DEFAULT 0,
  char_count      integer                  DEFAULT 0,
  start_position  integer                  DEFAULT 0,
  end_position    integer                  DEFAULT 0,
  section_title   varchar(500),
  chunk_metadata  jsonb                    DEFAULT '{}'::jsonb,
  created_at      timestamp with time zone NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_rag_chunks_org_doc_idx
  ON ns_rag_document_chunks (organization_id, document_id);

-- ── 4. ns_document_graph ─────────────────────────────────────────────
-- Citation/reference graph between parsed documents (e.g. "Contract A
-- supersedes Contract B"). Source/target indexes support both
-- directions of traversal.
CREATE TABLE IF NOT EXISTS ns_document_graph (
  id                  serial                   PRIMARY KEY,
  organization_id     integer                  NOT NULL,
  source_document_id  varchar(36)              NOT NULL,
  target_document_id  varchar(36)              NOT NULL,
  relationship_type   varchar(60)              NOT NULL,
  confidence          real                     DEFAULT 0,
  metadata            jsonb                    DEFAULT '{}'::jsonb,
  created_at          timestamp with time zone NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ns_doc_graph_org_src_idx
  ON ns_document_graph (organization_id, source_document_id);
CREATE INDEX IF NOT EXISTS ns_doc_graph_org_tgt_idx
  ON ns_document_graph (organization_id, target_document_id);

COMMIT;

-- ── 5. Verification ──────────────────────────────────────────────────
-- Print existence of every provisioned object so the deploy log
-- doubles as a permanent record.
SELECT 'ns_doc_processing_jobs' AS object,
       COUNT(*)::int AS exists
  FROM information_schema.tables
 WHERE table_name = 'ns_doc_processing_jobs'
UNION ALL
SELECT 'ns_parsed_documents',     COUNT(*)::int
  FROM information_schema.tables
 WHERE table_name = 'ns_parsed_documents'
UNION ALL
SELECT 'ns_rag_document_chunks',  COUNT(*)::int
  FROM information_schema.tables
 WHERE table_name = 'ns_rag_document_chunks'
UNION ALL
SELECT 'ns_document_graph',       COUNT(*)::int
  FROM information_schema.tables
 WHERE table_name = 'ns_document_graph';
