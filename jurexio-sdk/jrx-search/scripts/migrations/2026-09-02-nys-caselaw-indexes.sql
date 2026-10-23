-- NYS caselaw RDS hot-path indexes (2026-09-02).
-- Run on caselaw-worker RDS via admin role during maintenance window.
-- App user may lack CREATE INDEX — apply via SSM as postgres/rdsadmin:
--   aws ssm send-command --instance-ids i-000115b19219bb766 \
--     --document-name AWS-RunShellScript \
--     --parameters commands='["psql \"$CASELAW_DATABASE_URL\" -f /opt/nyv/api/migrations/2026-09-02-nys-caselaw-indexes.sql"]'
--
-- CONCURRENTLY cannot run inside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_embedding_hnsw
  ON judgments USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_sc_embedding_partial
  ON judgments (id)
  WHERE embedding IS NOT NULL AND court_type = 'sc';

CREATE INDEX CONCURRENTLY IF NOT EXISTS cnr_case_details_cnr_idx
  ON cnr_case_details (cnr);

ANALYZE judgments;
ANALYZE statutes;
ANALYZE cnr_case_details;
