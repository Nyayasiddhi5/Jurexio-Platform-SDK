-- @nvkit:no-transaction
-- ============================================================================
-- Task #114 · 0007_runtime_flag_overrides.sql · 2026-05-11
-- ============================================================================
-- Persistent overlay store for JRX_F_* feature flags so super-admins can flip
-- Platform-v5 namespaces from the Console without shell access to the gateway.
--
-- Resolution order at runtime (src/config/jrx-feature-flags.ts):
--   1. nv_runtime_flag_overrides.value when present (most recent row wins)
--   2. process.env[JRX_F_*] (legacy boot-time activation)
--   3. default = OFF
--
-- A NULL value semantically means "no override" (clears the overlay) — the
-- application layer DELETEs the row in that case rather than storing NULL,
-- so the table only ever holds ON/OFF rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nv_runtime_flag_overrides (
  logical       VARCHAR(64)  PRIMARY KEY,
  env_name      VARCHAR(96)  NOT NULL,
  value         BOOLEAN      NOT NULL,
  reason        TEXT,
  updated_by    VARCHAR(100),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  nv_runtime_flag_overrides IS
  'Task #114 — persistent overlay for JRX_F_* feature flags. Edited via PATCH /api/nv/admin/feature-flags/:logical (super_admin only).';
COMMENT ON COLUMN nv_runtime_flag_overrides.logical    IS 'Logical flag key from FLAG_ENV_MAP (e.g. govMakerChecker)';
COMMENT ON COLUMN nv_runtime_flag_overrides.env_name   IS 'Canonical JRX_F_* env var name this overlay shadows';
COMMENT ON COLUMN nv_runtime_flag_overrides.value      IS 'Effective override (true=ON, false=force-OFF)';
COMMENT ON COLUMN nv_runtime_flag_overrides.reason     IS 'Operator-supplied note for the audit chain';
COMMENT ON COLUMN nv_runtime_flag_overrides.updated_by IS 'User id that last toggled (for audit cross-reference)';
