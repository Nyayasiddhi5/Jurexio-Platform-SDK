-- task-236 / NV-SCHEMA-DRIFT-001: org_id columns required before RLS pilot (0016_rls_*).
-- Mirrors migrations/2026-05-12-openbot-org-id-backfill.sql for fresh-db migration chain.

ALTER TABLE IF EXISTS nv_schema.nv_openbot_channels ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
ALTER TABLE IF EXISTS nv_schema.nv_openbot_routes   ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
ALTER TABLE IF EXISTS nv_schema.nv_openbot_inbox    ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS nv_openbot_channels_org_idx ON nv_schema.nv_openbot_channels (org_id, status);
CREATE INDEX IF NOT EXISTS nv_openbot_routes_org_idx   ON nv_schema.nv_openbot_routes   (org_id, is_active);
CREATE INDEX IF NOT EXISTS nv_openbot_inbox_org_idx    ON nv_schema.nv_openbot_inbox    (org_id, received_at);
