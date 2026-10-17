-- ============================================================================
-- 0009_cam_actions.sql — Compliance Action Manager (CAM) reviewer queue table.
--
-- Promotes the runtime CREATE TABLE IF NOT EXISTS that previously lived in
-- src/routes/nv-cam-routes.ts (Task #190) into a real Drizzle migration so:
--   (a) the table is visible to Drizzle introspection / schema parity check,
--   (b) it lands on read-replicas during the normal schema sync,
--   (c) prod RDS gets it before the first /api/nv/cam/reviews call instead
--       of relying on bootstrap-on-demand.
--
-- Backs: GET /api/nv/cam/reviews (compliance_reviewer / org_admin /
--        super_admin via authenticateToken).
-- Schema mirrors shared/schema.ts → nvCamActions exactly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nv_cam_actions (
  id              SERIAL PRIMARY KEY,
  action_id       VARCHAR(64)  UNIQUE NOT NULL,
  org_id          VARCHAR(100),
  framework       VARCHAR(64),
  control_id      VARCHAR(100),
  severity        VARCHAR(20)  DEFAULT 'medium',
  status          VARCHAR(20)  DEFAULT 'pending',
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  assigned_to     VARCHAR(100),
  triggered_by    VARCHAR(100),
  evidence_ref    VARCHAR(255),
  metadata        JSONB        DEFAULT '{}'::jsonb,
  created_at      TIMESTAMP    DEFAULT NOW(),
  updated_at      TIMESTAMP    DEFAULT NOW(),
  reviewed_at     TIMESTAMP,
  reviewed_by     VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_nv_cam_actions_status
  ON nv_cam_actions (status, created_at DESC);

COMMENT ON TABLE  nv_cam_actions IS
  'Task #190 — Compliance Action Manager reviewer queue. Backs /api/nv/cam/reviews.';
COMMENT ON COLUMN nv_cam_actions.action_id    IS 'External stable id (UUID/slug) for cross-system reference';
COMMENT ON COLUMN nv_cam_actions.org_id       IS 'Owning org (string-typed to match cross-env id formats)';
COMMENT ON COLUMN nv_cam_actions.framework    IS 'Compliance framework key (e.g. dpdp, gdpr, soc2, iso27001)';
COMMENT ON COLUMN nv_cam_actions.control_id   IS 'Framework-specific control identifier';
COMMENT ON COLUMN nv_cam_actions.severity     IS 'critical | high | medium | low';
COMMENT ON COLUMN nv_cam_actions.status       IS 'pending | in_review | approved | rejected';
COMMENT ON COLUMN nv_cam_actions.evidence_ref IS 'Pointer (URL / object key / audit id) to supporting evidence';
COMMENT ON COLUMN nv_cam_actions.metadata     IS 'Free-form JSON payload for framework-specific fields';
