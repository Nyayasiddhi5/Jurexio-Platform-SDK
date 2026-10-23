-- @nvkit:no-transaction
-- ============================================================================
-- JRX-NS-002 · 0006_unify_sdk_key_tables.sql · 2026-05-01
-- ============================================================================
-- BIFURCATION FIX. Two parallel SDK key schemas exist in production:
--   Schema A (legacy, written by jrx-sdk-provision-routes.ts + jrx-sdk-keylife-routes.ts):
--     nv_sdk_applications  (UUID id)
--     nv_api_keys          (UUID id, app_id  → nv_sdk_applications.id)
--   Schema B (canonical, READ by src/middleware/jrx-sdk-gateway.ts):
--     sdk_applications     (SERIAL id)
--     sdk_app_api_keys     (SERIAL id, application_id → sdk_applications.id)
--
-- RESULT: every key minted via the provisioning routes is INVISIBLE to the
-- runtime gateway. Production was lucky here (operators provisioned through
-- direct SQL into sdk_applications), but the route is broken-by-design.
--
-- This migration:
--   1. Backfills every active row from Schema A → Schema B with a stable
--      legacy-id mapping table (so future calls can resolve old UUIDs to
--      new serial ids).
--   2. Adds DEPRECATED comments on the legacy tables.
--   3. DOES NOT drop the legacy tables — that is gated on operator confirmation
--      that no out-of-tree readers depend on them. See JRX-NS-002 in
--      JRX-TECH-SPEC-MASTER.md §14 for the drop plan.
--
-- The application code change that makes the provisioning routes write to
-- the canonical tables is in JRX-NS-002 / route fix C2.
-- ============================================================================

-- ── Defensive: ensure both schemas actually exist before backfilling ────────
DO $nyv$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'nv_api_keys') THEN
    RAISE NOTICE 'JRX-NS-002: nv_api_keys not present — skipping backfill (schema A never installed)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'sdk_app_api_keys') THEN
    RAISE EXCEPTION 'JRX-NS-002: sdk_app_api_keys missing — run drizzle migration 0000 first';
  END IF;
END
$nyv$;

-- ── Legacy-id mapping (idempotent) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nyv_sdk_legacy_id_map (
  legacy_uuid     VARCHAR(36) PRIMARY KEY,
  canonical_id    INTEGER     NOT NULL,
  table_name      VARCHAR(64) NOT NULL,
  migrated_at     TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nyv_sdk_legacy_id_map_canonical_idx
  ON nyv_sdk_legacy_id_map(table_name, canonical_id);

-- ── Backfill nv_sdk_applications → sdk_applications ────────────────────────
-- Strategy: for each legacy app NOT already mapped, insert a canonical row
-- using a synthetic client_id derived from the legacy UUID (deterministic, so
-- re-running this migration is a no-op).
DO $nyv$
DECLARE
  legacy_app  RECORD;
  new_id      INTEGER;
  fake_secret VARCHAR(255);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'nv_sdk_applications') THEN
    RETURN;
  END IF;

  FOR legacy_app IN
    SELECT a.*
      FROM nv_sdk_applications a
      LEFT JOIN nyv_sdk_legacy_id_map m
        ON m.legacy_uuid = a.id AND m.table_name = 'sdk_applications'
     WHERE m.legacy_uuid IS NULL
       AND a.is_active = TRUE
  LOOP
    -- Use the legacy UUID (sans dashes) as the client_id prefix so it stays
    -- traceable. The secret hash is a placeholder that forces a rotation
    -- (NULL would violate NOT NULL); operators MUST rotate via the keylife
    -- route after this migration runs.
    fake_secret := 'MIGRATED_PENDING_ROTATION_' || REPLACE(legacy_app.id, '-', '');

    INSERT INTO sdk_applications (
      organization_id, app_name, app_type, description,
      client_id, client_secret_hash, client_secret_prefix,
      jurisdiction, status, created_at, updated_at
    ) VALUES (
      legacy_app.org_id,
      legacy_app.name,
      legacy_app.app_type,
      'Migrated from legacy nv_sdk_applications (JRX-NS-002, 2026-05-01). Rotate secret before use.',
      'legacy_' || REPLACE(legacy_app.id, '-', ''),
      fake_secret,
      'legacy_',
      legacy_app.jurisdiction,
      CASE WHEN legacy_app.is_active THEN 'active' ELSE 'disabled' END,
      legacy_app.created_at,
      legacy_app.updated_at
    )
    ON CONFLICT (client_id) DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      INSERT INTO nyv_sdk_legacy_id_map (legacy_uuid, canonical_id, table_name)
        VALUES (legacy_app.id, new_id, 'sdk_applications')
        ON CONFLICT (legacy_uuid) DO NOTHING;
    END IF;
  END LOOP;
END
$nyv$;

-- ── Backfill nv_api_keys → sdk_app_api_keys ────────────────────────────────
DO $nyv$
DECLARE
  legacy_key  RECORD;
  canonical_app_id INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'nv_api_keys') THEN
    RETURN;
  END IF;

  FOR legacy_key IN
    SELECT k.*
      FROM nv_api_keys k
      LEFT JOIN nyv_sdk_legacy_id_map m
        ON m.legacy_uuid = k.id AND m.table_name = 'sdk_app_api_keys'
     WHERE m.legacy_uuid IS NULL
       AND k.is_active = TRUE
  LOOP
    SELECT canonical_id INTO canonical_app_id
      FROM nyv_sdk_legacy_id_map
     WHERE legacy_uuid = legacy_key.app_id
       AND table_name = 'sdk_applications';

    IF canonical_app_id IS NULL THEN
      CONTINUE;  -- orphan key (parent app not migrated); skip silently
    END IF;

    -- key_hash has a UNIQUE constraint, so ON CONFLICT keeps this idempotent
    INSERT INTO sdk_app_api_keys (
      application_id, key_hash, key_prefix, name,
      scopes, is_active, last_used_at, expires_at, created_at
    ) VALUES (
      canonical_app_id,
      legacy_key.key_hash,
      legacy_key.key_prefix,
      legacy_key.name,
      to_jsonb(COALESCE(legacy_key.permissions, '{}'::text[])),
      legacy_key.is_active,
      legacy_key.last_used_at,
      legacy_key.expires_at,
      legacy_key.created_at
    )
    ON CONFLICT (key_hash) DO NOTHING;

    INSERT INTO nyv_sdk_legacy_id_map (legacy_uuid, canonical_id, table_name)
      SELECT legacy_key.id, id, 'sdk_app_api_keys'
        FROM sdk_app_api_keys
       WHERE key_hash = legacy_key.key_hash
      ON CONFLICT (legacy_uuid) DO NOTHING;
  END LOOP;
END
$nyv$;

-- ── Deprecation markers (only when legacy tables exist on this DB) ─────────
DO $nyv$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_api_keys') THEN
    EXECUTE $cmt$COMMENT ON TABLE nv_api_keys IS
      'DEPRECATED 2026-05-01 (JRX-NS-002). Use sdk_app_api_keys. Will be dropped post-GA.'$cmt$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_sdk_applications') THEN
    EXECUTE $cmt$COMMENT ON TABLE nv_sdk_applications IS
      'DEPRECATED 2026-05-01 (JRX-NS-002). Use sdk_applications. Will be dropped post-GA.'$cmt$;
  END IF;
END
$nyv$;

-- ── Helpful index for the legacy-id reverse lookup ─────────────────────────
CREATE INDEX IF NOT EXISTS nyv_sdk_legacy_id_map_table_idx
  ON nyv_sdk_legacy_id_map(table_name);
