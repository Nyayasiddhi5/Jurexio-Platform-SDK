-- task-241: Backfill org_id on legacy OpenBot rows so old tenants stay isolated.
--
-- Context: task-236 added the `org_id` column to nv_schema.nv_openbot_channels,
-- nv_schema.nv_openbot_routes, and nv_schema.nv_openbot_inbox. New writes
-- populate it directly, but rows persisted before the column existed only
-- carry `orgId` inside the JSON blob (`config`/`rule`/`message`). The
-- in-memory hydrate path in `openbot-service._hydrate()` patches the cache,
-- but DB-side `WHERE org_id = $1` filters won't return those legacy rows on
-- a pod that hasn't hydrated them yet — which means a freshly-restarted pod
-- can leak nothing but also serve nothing for those tenants until hydrate
-- completes.
--
-- This migration copies the JSON-blob orgId into the dedicated column once,
-- so server-side filters return correct results immediately.
--
-- Idempotent: every UPDATE is gated on `org_id IS NULL`, so re-running this
-- script is safe and will be a no-op once the backfill has succeeded.

BEGIN;

-- 0) Defensive ensure: on environments where openbot-service._hydrate() has
-- never run (e.g. a fresh EC2 redeploy hitting RDS for the first time), the
-- org_id column from task-236 may not exist yet. Mirror the service-side
-- ALTER guards so this script is safe to run before the gateway boots.
ALTER TABLE IF EXISTS nv_schema.nv_openbot_channels ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
ALTER TABLE IF EXISTS nv_schema.nv_openbot_routes   ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
ALTER TABLE IF EXISTS nv_schema.nv_openbot_inbox    ADD COLUMN IF NOT EXISTS org_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS nv_openbot_channels_org_idx ON nv_schema.nv_openbot_channels (org_id, status);
CREATE INDEX IF NOT EXISTS nv_openbot_routes_org_idx   ON nv_schema.nv_openbot_routes   (org_id, is_active);
CREATE INDEX IF NOT EXISTS nv_openbot_inbox_org_idx    ON nv_schema.nv_openbot_inbox    (org_id, received_at);

-- 1) Channels: copy config->>'orgId' into the dedicated column.
UPDATE nv_schema.nv_openbot_channels
   SET org_id = config->>'orgId'
 WHERE org_id IS NULL
   AND config ? 'orgId'
   AND nullif(config->>'orgId', '') IS NOT NULL;

-- 2) Routes: copy rule->>'orgId' into the dedicated column.
UPDATE nv_schema.nv_openbot_routes
   SET org_id = rule->>'orgId'
 WHERE org_id IS NULL
   AND rule ? 'orgId'
   AND nullif(rule->>'orgId', '') IS NOT NULL;

-- 3) Inbox: prefer the channel's authoritative org_id (now backfilled in
-- step 1); fall back to message->>'orgId' if the channel row is missing
-- one for any reason.
UPDATE nv_schema.nv_openbot_inbox AS i
   SET org_id = COALESCE(c.org_id, nullif(i.message->>'orgId', ''))
  FROM nv_schema.nv_openbot_channels AS c
 WHERE i.org_id IS NULL
   AND i.channel_id = c.channel_id
   AND COALESCE(c.org_id, nullif(i.message->>'orgId', '')) IS NOT NULL;

COMMIT;

-- Verification — expected `null_count = 0` for any tenant-tagged rows.
-- (Rows that legitimately never carried an orgId in the JSON blob will
-- remain NULL; that is correct, not a bug, and the WHERE-filtered queries
-- will simply not match them.)
SELECT 'nv_openbot_channels' AS tbl,
       COUNT(*) FILTER (WHERE org_id IS NULL AND config ? 'orgId')   AS null_with_json_org,
       COUNT(*) FILTER (WHERE org_id IS NULL)                        AS null_total,
       COUNT(*)                                                      AS total
  FROM nv_schema.nv_openbot_channels
UNION ALL
SELECT 'nv_openbot_routes',
       COUNT(*) FILTER (WHERE org_id IS NULL AND rule ? 'orgId'),
       COUNT(*) FILTER (WHERE org_id IS NULL),
       COUNT(*)
  FROM nv_schema.nv_openbot_routes
UNION ALL
SELECT 'nv_openbot_inbox',
       COUNT(*) FILTER (WHERE org_id IS NULL AND message ? 'orgId'),
       COUNT(*) FILTER (WHERE org_id IS NULL),
       COUNT(*)
  FROM nv_schema.nv_openbot_inbox;
