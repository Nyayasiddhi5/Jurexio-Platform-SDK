-- NV-DB-INDEX-OPTIMIZE-001 — index corrections found by the live audit (2026-08-17).
--
-- All statements are CONCURRENTLY + IF [NOT] EXISTS so this file is re-appliable and
-- never takes an ACCESS EXCLUSIVE lock on a live table. CONCURRENTLY cannot run inside
-- a transaction block, so this file must NOT be wrapped in BEGIN/COMMIT.
--
-- Deliberately does NOT touch RLS. The audit found RLS is FORCE'd with
-- `org_id = current_setting('app.current_org_id')` and `nv_app` has no BYPASSRLS, while
-- ordinary pooled queries never bind that GUC (only `withTenantTx` does). Enabling RLS
-- on more tables would therefore return ZERO rows to the application — fail-closed by
-- design (`nv-org-rls-middleware.ts:26-28`). That rollout needs app changes first and is
-- tracked separately.

-- NV-SCHEMA-DRIFT fix (2026-08-19) — why every statement below is guarded on table existence.
--
-- `guardrail:schema-drift` rebuilds a throwaway Postgres from the checked-in migrations and
-- this file failed on it:
--   ERROR: relation "nv_schema.nv_legal_graph_entities" does not exist
-- Several tables it indexes (`nv_legal_graph_entities`, `experiment_outcomes`,
-- `model_drift_checks`, `subscription_events`) are declared in shared/** and exist on the live
-- RDS, but were never captured in a migration — they were created out-of-band in the
-- Replit era. So a fresh `createdb` + `psql -f`, i.e. a disaster-recovery rebuild or a brand
-- new environment, aborted here and every later migration went unapplied.
--
-- This file's job is index HYGIENE on tables it does not own, so re-declaring those tables
-- here would duplicate ownership and invite the two copies to drift. Instead each statement is
-- skipped when its table is absent: a no-op on a fresh database, and byte-for-byte the same
-- behaviour on the live one where the tables do exist. The missing CREATEs remain a real gap,
-- tracked separately — but a hygiene migration must not be what blocks a rebuild.
--
-- `\gexec` is used rather than a DO block because CREATE INDEX CONCURRENTLY cannot run inside
-- a function body or transaction; \gexec runs each generated statement as its own top-level
-- command, so CONCURRENTLY is preserved.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Missing HNSW index on the legal-graph embedding column.
--
-- `nv_legal_graph_entities.embedding` is `vector(1536)` but had NO vector index, while
-- the three sibling vector tables (`rag_chunks`, `knowledge_graph_entities`,
-- `org_memory_entries`) all have one. Any similarity query on the legal graph was a
-- sequential scan with a full distance computation per row.
--
-- Parameters match the existing `idx_nv_rag_chunks_embedding_hnsw` (m=16,
-- ef_construction=200) so behaviour is consistent across vector tables rather than
-- introducing a second, differently-tuned profile.
-- `vector_cosine_ops` matches the sibling indexes and the cosine distance the retrieval
-- code uses.
SELECT $$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nv_legal_graph_entities_embedding_hnsw
  ON nv_schema.nv_legal_graph_entities USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)$$
WHERE to_regclass('nv_schema.nv_legal_graph_entities') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
\gexec

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Foreign keys with no leading index.
--
-- Postgres does not auto-index the referencing side of a FK. Without one, every join
-- across the FK and every ON DELETE/UPDATE check on the parent does a sequential scan
-- of the child. These three were reported by the audit query that looks for
-- `contype='f'` with no index whose first key column is the FK column.
SELECT $$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_outcomes_experiment_id
  ON nv_schema.experiment_outcomes (experiment_id)$$
WHERE to_regclass('nv_schema.experiment_outcomes') IS NOT NULL
\gexec

SELECT $$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_model_drift_checks_baseline_id
  ON nv_schema.model_drift_checks (baseline_id)$$
WHERE to_regclass('nv_schema.model_drift_checks') IS NOT NULL
\gexec

SELECT $$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_events_subscription_id
  ON nv_schema.subscription_events (subscription_id)$$
WHERE to_regclass('nv_schema.subscription_events') IS NOT NULL
\gexec

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Composite index for the `memory_entries` seq-scan pattern.
--
-- `memory_entries` showed 39.1 % sequential scans (3,918 seq vs 6,094 idx) despite
-- holding 10 indexes. Two causes: `random_page_cost = 4` on SSD biases the planner away
-- from index scans (fixed separately in the parameter group), and the recall query
-- filters `user_id` + optional `session_id`/`matter_id`/`scope` then orders by
-- `importance DESC, last_accessed_at DESC` — for which no single index covered both the
-- filter and the sort.
--
-- This index lets the planner satisfy the common no-query recall path
-- (filter by user, order by importance/recency) without a sort step.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_user_importance_recent
  ON nv_schema.memory_entries (user_id, importance DESC, last_accessed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop indexes with zero reads.
--
-- Each of these has `idx_scan = 0` in `pg_stat_user_indexes` while costing write
-- amplification on every INSERT/UPDATE of a hot table. Verified NOT primary and NOT
-- unique before listing, so no constraint depends on them.
--
-- Deliberately EXCLUDED from this list even though they also report 0 scans:
--   * idx_memory_value_tsv, idx_memory_user_evict, idx_memory_user_session — created
--     minutes before the audit ran, so 0 scans means "no traffic yet", not "unused".
-- Dropping an index we just created to fix a 67x regression would be a self-inflicted
-- wound; statistics need a real observation window first.
--
-- `hallucination_checks` is the largest table (39 MB / 7,622 rows) and carries two
-- unused indexes totalling ~896 kB — the clearest win.
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_halluc_request;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_halluc_status;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_ai_act_pattern;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_ai_act_blocked;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_agent_metrics_tenant;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_agent_metrics_period;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_agent_metrics_agent;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_usage_logs_agent;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_model_governance_created_at;
DROP INDEX CONCURRENTLY IF EXISTS nv_schema.idx_agent_auto_sel_tenant;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Refresh planner statistics on the tables whose access paths just changed.
--    Guarded like the rest: ANALYZE on a missing relation is an error, which would
--    re-break the fresh-database rebuild at the very last step.
SELECT 'ANALYZE nv_schema.' || t
FROM (VALUES ('memory_entries'), ('nv_legal_graph_entities'), ('hallucination_checks'), ('ai_activity')) AS v(t)
WHERE to_regclass('nv_schema.' || v.t) IS NOT NULL
\gexec
