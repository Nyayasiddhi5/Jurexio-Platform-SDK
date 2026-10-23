-- JRX-OPS-DB-INDEX-001 (2026-05-01)
-- Index sdk_app_api_keys.key_hash to remove the per-SDK-request full-table
-- scan in src/middleware/jrx-sdk-gateway.ts:sdkGatewayAuth().
--
-- Migration is idempotent (CREATE INDEX IF NOT EXISTS) and uses CONCURRENTLY
-- so it can be applied to live RDS without holding a write lock on the
-- table. The CONCURRENTLY clause requires the migration to NOT run inside
-- a transaction — drizzle-kit splits these statements automatically when
-- it sees the comment marker below.
--
-- Apply: npx drizzle-kit push   (Replit dev)
--        ssh ec2 + run via psql (EC2 dev/prod, see scripts/jrx-apply-prod-migration.sh)

-- @nvkit:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS sdk_app_api_keys_key_hash_idx
  ON sdk_app_api_keys (key_hash);

-- Partial index requires revoked_at — add if an older checkout never had it.
ALTER TABLE sdk_app_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

-- @nvkit:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS sdk_app_api_keys_active_lookup_idx
  ON sdk_app_api_keys (key_hash)
  WHERE revoked_at IS NULL;
