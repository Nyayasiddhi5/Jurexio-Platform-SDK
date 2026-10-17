-- ============================================================================
-- 0008_org_console_layout.sql — Per-org console layout overlay
-- Session-15 v13 (2026-05-11). Closes Phase 5 in
--   docs/audit/console-cpo-audit-2026-05-11.md
--   docs/audit/feature-matrix-and-status-2026-05-11.md §1 / §3
--
-- One row per organisation that wants to override the default console layout
-- (sidebar visibility, branding colours, default landing page, hidden
-- sections). When a row is absent for an org, the console falls back to the
-- platform default (no behavioural change for any tenant that doesn't opt in).
--
-- Auth model:
--   - GET  /api/nv/admin/org-console-layout/_self/effective → any auth user
--          (resolves the active org and returns the effective overlay or
--           the platform default).
--   - GET  /api/nv/admin/org-console-layout/:orgId → org_admin for own org;
--          super_admin for any org.
--   - PUT  /api/nv/admin/org-console-layout/:orgId → org_admin for own org;
--          super_admin for any org.
--   - DELETE /api/nv/admin/org-console-layout/:orgId → super_admin only.
--
-- Task #214 (2026-05-13): the runtime CREATE TABLE IF NOT EXISTS bootstrap
-- previously living in nv-org-console-layout-routes.ts has been removed.
-- The table is now defined in shared/schema.ts (`nvOrgConsoleLayout`) and
-- shipped exclusively via this migration, so it shows up in Drizzle
-- introspection and `npm run db:parity`. Run `npm run migrate` once on a
-- fresh dev box; prod RDS picks it up during the normal schema sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nv_org_console_layout (
  org_id              VARCHAR(96)  PRIMARY KEY,
  display_name        VARCHAR(120),
  brand_primary_hex   VARCHAR(7),
  brand_accent_hex    VARCHAR(7),
  logo_url            TEXT,
  default_landing     VARCHAR(200),
  sidebar_sections    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  hidden_routes       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  feature_overrides   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  notes               TEXT,
  updated_by          VARCHAR(120),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  nv_org_console_layout IS
  'Phase 5 — per-org console overlay. Absent row = platform default. Edited via /api/nv/admin/org-console-layout/:orgId (org_admin or super_admin).';
COMMENT ON COLUMN nv_org_console_layout.org_id            IS 'FK to nv_organizations.id (string-typed to match cross-env id formats)';
COMMENT ON COLUMN nv_org_console_layout.display_name      IS 'Per-org override of the console display name shown in header';
COMMENT ON COLUMN nv_org_console_layout.brand_primary_hex IS '#RRGGBB primary brand colour applied to header/sidebar accents';
COMMENT ON COLUMN nv_org_console_layout.brand_accent_hex  IS '#RRGGBB secondary brand colour applied to call-to-action buttons';
COMMENT ON COLUMN nv_org_console_layout.logo_url          IS 'HTTPS URL of the org logo (replaces nyayasiddhi-logo.png in header)';
COMMENT ON COLUMN nv_org_console_layout.default_landing   IS 'Path the org should land on after login (e.g. /chat-hub). NULL = platform default';
COMMENT ON COLUMN nv_org_console_layout.sidebar_sections  IS 'JSON map { sectionKey: bool } controlling which sidebar sections are visible';
COMMENT ON COLUMN nv_org_console_layout.hidden_routes     IS 'JSON array of canonical route paths to suppress from menus + nav (deep-links still work)';
COMMENT ON COLUMN nv_org_console_layout.feature_overrides IS 'JSON map of per-org feature flag overrides (subset of NYV_F_* logical keys)';
COMMENT ON COLUMN nv_org_console_layout.notes             IS 'Free-text operator note (audit trail companion)';
COMMENT ON COLUMN nv_org_console_layout.updated_by        IS 'User id of the last operator to edit this overlay';

CREATE INDEX IF NOT EXISTS idx_nv_org_console_layout_updated
  ON nv_org_console_layout (updated_at DESC);
