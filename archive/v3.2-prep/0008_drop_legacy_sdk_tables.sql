-- =====================================================================
-- v3.2 STAGED MIGRATION — DO NOT RUN UNTIL v3.2 RELEASE
-- =====================================================================
-- Drops the legacy SDK key schema (nv_api_keys + nv_sdk_applications) in
-- favour of the consolidated nv_sdk_keys table introduced in NYV-NS-016.
--
-- Sunset date: 2026-08-01 (announced via Deprecation/Sunset/Warning
-- headers from 2026-05-01 onwards; see
-- src/middleware/legacy-deprecation-header.ts).
--
-- Pre-flight checks (must all pass before applying):
--   1. SELECT count(*) FROM nv_api_keys WHERE last_used_at > NOW() - INTERVAL '30 days';
--      → must be 0 (no consumer has touched the legacy table in 30 days)
--   2. SELECT count(*) FROM nv_sdk_keys; → must be ≥ count(*) FROM nv_api_keys
--      (every legacy key has been migrated to nv_sdk_keys)
--   3. Application logs grep: zero `LEGACY_SDK_KEY_HIT` events in the last 7 days
--   4. Operator sign-off recorded in Project-Tracker.md §5
--
-- This file lives in archive/v3.2-prep/ on purpose — it is NOT picked up
-- by Drizzle's migrator until manually moved into src/database/migrations/
-- as part of the v3.2 cut.
-- =====================================================================

BEGIN;

-- 1. Final dual-write reconciliation: copy any nv_api_keys rows that
--    somehow never made it into nv_sdk_keys (defence in depth).
INSERT INTO nv_sdk_keys (
  id, key_hash, platform, app_id, scopes, tier,
  is_active, created_at, expires_at, last_used_at, metadata
)
SELECT
  k.id,
  k.key_hash,
  COALESCE(a.platform, 'unknown'),
  k.app_id,
  COALESCE(k.scopes, ARRAY['agents:read', 'agents:execute', 'research:read']::text[]),
  COALESCE(a.tier, 'developer'),
  k.is_active,
  k.created_at,
  k.expires_at,
  k.last_used_at,
  jsonb_build_object('migrated_from', 'nv_api_keys', 'migrated_at', NOW())
FROM nv_api_keys k
LEFT JOIN nv_sdk_applications a ON k.app_id = a.id
WHERE NOT EXISTS (
  SELECT 1 FROM nv_sdk_keys s WHERE s.id = k.id OR s.key_hash = k.key_hash
);

-- 2. Drop dependent FKs first
ALTER TABLE IF EXISTS nv_api_keys DROP CONSTRAINT IF EXISTS nv_api_keys_app_id_fkey;

-- 3. Drop the two legacy tables
DROP TABLE IF EXISTS nv_api_keys CASCADE;
DROP TABLE IF EXISTS nv_sdk_applications CASCADE;

-- 4. Audit chain entry (append-only, strict mode)
INSERT INTO nv_audit_logs (
  id, event_type, actor, target, payload, hash_chain_prev, created_at
) VALUES (
  gen_random_uuid(),
  'SCHEMA_LEGACY_TABLES_DROPPED',
  'migration:0008',
  'nv_api_keys,nv_sdk_applications',
  jsonb_build_object(
    'reason', 'v3.2 cleanup — superseded by nv_sdk_keys',
    'sunset_announced', '2026-05-01',
    'sunset_effective', '2026-08-01'
  ),
  (SELECT hash_chain_curr FROM nv_audit_logs ORDER BY created_at DESC LIMIT 1),
  NOW()
);

COMMIT;
