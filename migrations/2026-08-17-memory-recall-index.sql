-- NV-MEM-RECALL-INDEX-001 — index the memory-recall ranking expression.
--
-- Defect: nvMemoryService.retrieve() ranks with
--   ts_rank_cd(to_tsvector('simple', COALESCE(value::text,'')), plainto_tsquery(...))
-- computed PER ROW at query time, with no functional index. Measured on live RDS
-- (2026-08-17), EXPLAIN (ANALYZE) on the largest user's memory:
--
--   Sort (actual time=690.592..690.594 rows=20)
--     Sort Key: (ts_rank_cd(to_tsvector('simple', COALESCE((value)::text, ''))...
--     ->  Index Scan using idx_memory_user (actual time=1.336..689.935 rows=1430)
--   Execution Time: 690.635 ms
--
-- 688 ms of that is ranking 1,430 rows == ~0.48 ms/row, linear in rows-per-user.
-- The capability breaker fires at 30 s, i.e. at roughly 62,000 rows for ONE user.
-- The table holds 1,589 rows today, which is exactly why the 30 s hang reported in
-- the Queen leaf traces is currently latent rather than reproducible.
--
-- Fix: a STORED generated tsvector column plus a GIN index, so ranking reads a
-- precomputed vector instead of building one per row.
--
-- Why GENERATED rather than a trigger: a trigger can drift from `value` if any
-- writer bypasses it; a generated column cannot, because Postgres maintains it.
--
-- Why CONCURRENTLY on the indexes: this table is on the live recall path. A plain
-- CREATE INDEX takes ACCESS EXCLUSIVE and would stall every recall for its
-- duration. CONCURRENTLY cannot run inside a transaction block, which is why this
-- file must NOT be wrapped in BEGIN/COMMIT.
--
-- Cost of the ADD COLUMN: a STORED generated column rewrites the table. At 1,589
-- rows that is milliseconds — a strong argument for applying this now rather than
-- at 60k rows.

-- Why this file also CREATEs the table (NV-SCHEMA-DRIFT fix, 2026-08-19):
-- `guardrail:schema-drift` builds a throwaway Postgres, applies every checked-in
-- migration in order, and compares the result against shared/**. It failed here with
--   ERROR: relation "nv_schema.memory_entries" does not exist
-- because the table is declared in shared/nv-governance-schema.ts (mirrored from the
-- Replit-era database on 2026-04-29) but was NEVER captured in a migration. It exists on
-- the live RDS only because it was created out-of-band, so `db:push` had nothing to do.
--
-- That made the migration set non-self-contained: a fresh `createdb` + `psql -f` — i.e. a
-- disaster-recovery rebuild or a new environment — would fail on this file and leave the
-- memory tier without its recall index. The ALTER below cannot run before the table exists,
-- so the CREATE has to precede it.
--
-- The column list mirrors `nvMemoryEntries` in shared/nv-governance-schema.ts exactly,
-- including the six pre-existing indexes, so the drift check reaches the same schema by
-- either route. IF NOT EXISTS throughout, so this is a no-op against the live database and
-- changes nothing there.
CREATE SCHEMA IF NOT EXISTS nv_schema;

CREATE TABLE IF NOT EXISTS nv_schema.memory_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  tenant_id        text,
  memory_type      text NOT NULL DEFAULT 'fact',
  scope            text NOT NULL DEFAULT 'longterm',
  matter_id        text,
  session_id       text,
  key              text,
  value            jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance       double precision DEFAULT 0.5,
  access_count     integer NOT NULL DEFAULT 0,
  last_accessed_at timestamp(6) with time zone,
  expires_at       timestamp(6) with time zone,
  created_at       timestamp(6) with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_expires ON nv_schema.memory_entries (expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_matter  ON nv_schema.memory_entries (matter_id);
CREATE INDEX IF NOT EXISTS idx_memory_scope   ON nv_schema.memory_entries (scope);
CREATE INDEX IF NOT EXISTS idx_memory_session ON nv_schema.memory_entries (session_id);
CREATE INDEX IF NOT EXISTS idx_memory_tenant  ON nv_schema.memory_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_user    ON nv_schema.memory_entries (user_id);

-- 1. Precomputed ranking vector. IF NOT EXISTS so re-application is safe.
ALTER TABLE nv_schema.memory_entries
  ADD COLUMN IF NOT EXISTS value_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(value::text, ''))) STORED;

-- 2. GIN index for the @@ match and the rank input.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_value_tsv
  ON nv_schema.memory_entries USING GIN (value_tsv);

-- 3. The recall query always filters user_id and usually session_id. The existing
--    idx_memory_user covers user_id alone; this composite lets the planner narrow
--    both before ranking, which matters most for the multi-session partner case.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_user_session
  ON nv_schema.memory_entries (user_id, session_id);

-- 4. Eviction support: the cap query orders by importance ASC, last_accessed_at ASC
--    within a user. Without this index the cap itself becomes a seq scan, i.e. the
--    fix for unbounded growth would reintroduce the cost it exists to prevent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_user_evict
  ON nv_schema.memory_entries (user_id, importance, last_accessed_at);
