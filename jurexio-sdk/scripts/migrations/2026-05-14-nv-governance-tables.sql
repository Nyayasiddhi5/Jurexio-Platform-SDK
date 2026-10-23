-- ──────────────────────────────────────────────────────────────────────────────
-- Jurexio Platform — Governance / Compliance / Policies / Internal-Security
-- Migration: 2026-05-14
--
-- Adds the persistent backbone for the Console "Governance & Compliance" and
-- "Operations" sections. All tables are additive; no existing rows touched.
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Frameworks catalog (one row per framework × jurisdiction binding)
CREATE TABLE IF NOT EXISTS nv_compliance_frameworks (
  id              SERIAL PRIMARY KEY,
  framework_code  VARCHAR(60)  NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  jurisdiction    VARCHAR(10)  NOT NULL,
  authority       VARCHAR(255),
  version         VARCHAR(120),
  category        VARCHAR(60),
  description     TEXT,
  total_controls  INTEGER       NOT NULL DEFAULT 0,
  active          BOOLEAN       NOT NULL DEFAULT TRUE,
  effective_from  DATE,
  "references"    JSONB         NOT NULL DEFAULT '[]'::jsonb,
  metadata        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nv_compliance_frameworks_jur_idx ON nv_compliance_frameworks(jurisdiction);
CREATE INDEX IF NOT EXISTS nv_compliance_frameworks_cat_idx ON nv_compliance_frameworks(category);

-- 2. Controls per framework
CREATE TABLE IF NOT EXISTS nv_compliance_controls (
  id                SERIAL PRIMARY KEY,
  framework_code    VARCHAR(60)  NOT NULL,
  control_code      VARCHAR(80)  NOT NULL,
  title             VARCHAR(500) NOT NULL,
  category          VARCHAR(120),
  severity          VARCHAR(20)  NOT NULL DEFAULT 'medium',
  description       TEXT,
  requirement_text  TEXT,
  automation_level  VARCHAR(30)  NOT NULL DEFAULT 'auto',
  evidence_source   VARCHAR(255),
  default_status    VARCHAR(30)  NOT NULL DEFAULT 'compliant',
  "references"      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(framework_code, control_code)
);
CREATE INDEX IF NOT EXISTS nv_compliance_controls_fw_idx ON nv_compliance_controls(framework_code);
CREATE INDEX IF NOT EXISTS nv_compliance_controls_sev_idx ON nv_compliance_controls(severity);

-- 3. Per-org evidence rows (one per (org, framework, control))
CREATE TABLE IF NOT EXISTS nv_compliance_evidence (
  id                BIGSERIAL PRIMARY KEY,
  org_id            INTEGER     NOT NULL DEFAULT 1,
  framework_code    VARCHAR(60) NOT NULL,
  control_code      VARCHAR(80) NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'compliant',
  evidence_type     VARCHAR(40) NOT NULL DEFAULT 'automated',
  evidence_summary  TEXT,
  evidence_ref      VARCHAR(500),
  metric_value      NUMERIC,
  owner_team        VARCHAR(120),
  last_assessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_review_at    TIMESTAMPTZ,
  attachments       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, framework_code, control_code)
);
CREATE INDEX IF NOT EXISTS nv_compliance_evidence_org_idx       ON nv_compliance_evidence(org_id);
CREATE INDEX IF NOT EXISTS nv_compliance_evidence_status_idx    ON nv_compliance_evidence(status);
CREATE INDEX IF NOT EXISTS nv_compliance_evidence_fw_idx        ON nv_compliance_evidence(framework_code);
CREATE INDEX IF NOT EXISTS nv_compliance_evidence_org_fw_idx    ON nv_compliance_evidence(org_id, framework_code);

-- 4. Periodic assessment snapshots
CREATE TABLE IF NOT EXISTS nv_compliance_assessments (
  id                BIGSERIAL PRIMARY KEY,
  org_id            INTEGER     NOT NULL DEFAULT 1,
  framework_code    VARCHAR(60) NOT NULL,
  period_start      DATE        NOT NULL,
  period_end        DATE        NOT NULL,
  score_pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
  compliant_count   INTEGER     NOT NULL DEFAULT 0,
  partial_count     INTEGER     NOT NULL DEFAULT 0,
  gap_count         INTEGER     NOT NULL DEFAULT 0,
  na_count          INTEGER     NOT NULL DEFAULT 0,
  summary           TEXT,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nv_compliance_assessments_org_fw_idx ON nv_compliance_assessments(org_id, framework_code, period_end DESC);

-- 5. Policies (organisation-level)
CREATE TABLE IF NOT EXISTS nv_policies (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER     NOT NULL DEFAULT 1,
  policy_code     VARCHAR(80) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  category        VARCHAR(60),
  jurisdiction    VARCHAR(10),
  severity        VARCHAR(20)  NOT NULL DEFAULT 'medium',
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  owner_team      VARCHAR(120),
  description     TEXT,
  rules           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  current_version VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
  effective_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  review_at       TIMESTAMPTZ,
  framework_refs  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, policy_code)
);
CREATE INDEX IF NOT EXISTS nv_policies_org_idx ON nv_policies(org_id);
CREATE INDEX IF NOT EXISTS nv_policies_cat_idx ON nv_policies(category);

CREATE TABLE IF NOT EXISTS nv_policy_versions (
  id            SERIAL PRIMARY KEY,
  policy_id     INTEGER     NOT NULL,
  version       VARCHAR(20) NOT NULL,
  body_md       TEXT,
  changelog     TEXT,
  published_by  VARCHAR(120),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(policy_id, version)
);
CREATE INDEX IF NOT EXISTS nv_policy_versions_policy_idx ON nv_policy_versions(policy_id);

CREATE TABLE IF NOT EXISTS nv_policy_assignments (
  id            SERIAL PRIMARY KEY,
  policy_id     INTEGER     NOT NULL,
  scope_type    VARCHAR(40) NOT NULL,
  scope_value   VARCHAR(120) NOT NULL,
  assigned_by   VARCHAR(120),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ack_required  BOOLEAN     NOT NULL DEFAULT FALSE,
  ack_count     INTEGER     NOT NULL DEFAULT 0,
  UNIQUE(policy_id, scope_type, scope_value)
);
CREATE INDEX IF NOT EXISTS nv_policy_assignments_policy_idx ON nv_policy_assignments(policy_id);

CREATE TABLE IF NOT EXISTS nv_policy_violations (
  id              BIGSERIAL PRIMARY KEY,
  policy_id       INTEGER     NOT NULL,
  org_id          INTEGER     NOT NULL DEFAULT 1,
  severity        VARCHAR(20) NOT NULL DEFAULT 'medium',
  source          VARCHAR(60),
  request_id      VARCHAR(120),
  user_ref        VARCHAR(120),
  description     TEXT,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          VARCHAR(30) NOT NULL DEFAULT 'open',
  resolution_notes TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS nv_policy_violations_policy_idx ON nv_policy_violations(policy_id);
CREATE INDEX IF NOT EXISTS nv_policy_violations_status_idx ON nv_policy_violations(status);
CREATE INDEX IF NOT EXISTS nv_policy_violations_detected_idx ON nv_policy_violations(detected_at DESC);

-- 6. Internal security posture catalog (Jurexio-as-a-platform's own controls)
CREATE TABLE IF NOT EXISTS nv_internal_security_controls (
  id              SERIAL PRIMARY KEY,
  control_code    VARCHAR(80) NOT NULL UNIQUE,
  category        VARCHAR(60) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(30) NOT NULL DEFAULT 'active',
  maturity        VARCHAR(20) NOT NULL DEFAULT 'managed',
  owner_team      VARCHAR(120),
  evidence_link   VARCHAR(500),
  frequency       VARCHAR(40),
  framework_refs  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  last_verified_at TIMESTAMPTZ,
  next_review_at   TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nv_internal_security_controls_cat_idx ON nv_internal_security_controls(category);

-- 7. Key rotations log (JWT, session, encryption, SDK keys, RDS/Redis, TLS)
CREATE TABLE IF NOT EXISTS nv_security_key_rotations (
  id            BIGSERIAL PRIMARY KEY,
  key_kind      VARCHAR(60)  NOT NULL,
  key_label     VARCHAR(120) NOT NULL,
  rotation_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  rotated_by    VARCHAR(120),
  next_rotation_at TIMESTAMPTZ,
  status        VARCHAR(20)  NOT NULL DEFAULT 'success',
  notes         TEXT,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS nv_security_key_rotations_kind_idx ON nv_security_key_rotations(key_kind);
CREATE INDEX IF NOT EXISTS nv_security_key_rotations_at_idx   ON nv_security_key_rotations(rotation_at DESC);

-- 8. TLS certificates inventory
CREATE TABLE IF NOT EXISTS nv_certificates (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL UNIQUE,
  scope           VARCHAR(120),
  issuer          VARCHAR(255),
  subject         VARCHAR(255),
  fingerprint     VARCHAR(120),
  valid_from      TIMESTAMPTZ,
  valid_to        TIMESTAMPTZ,
  auto_renew      BOOLEAN     NOT NULL DEFAULT TRUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'valid',
  last_check_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- 9. Data governance records (datasets / classifications / retention)
CREATE TABLE IF NOT EXISTS nv_data_governance_records (
  id                  SERIAL PRIMARY KEY,
  dataset_name        VARCHAR(255) NOT NULL UNIQUE,
  classification      VARCHAR(40)  NOT NULL,
  jurisdiction        VARCHAR(10),
  retention_days      INTEGER,
  encryption_at_rest  VARCHAR(40)  NOT NULL DEFAULT 'AES-256',
  encryption_in_transit VARCHAR(40) NOT NULL DEFAULT 'TLS 1.3',
  pii_categories      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  owner_team          VARCHAR(120),
  storage_location    VARCHAR(120),
  last_audit_at       TIMESTAMPTZ,
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Lightweight HITL queue + history.
-- Existing installs already have nv_hitl_queue + nv_hitl_decisions with a
-- different (legacy) schema (id varchar, agent_id, task_type, context, …) —
-- they are kept intact for the SLA timer + phase-c stubs that read those
-- columns. Here we additively widen both tables with the governance-era
-- columns the new seeder + posture endpoints expect, so old + new code paths
-- can coexist on the same physical tables.
CREATE TABLE IF NOT EXISTS nv_hitl_queue (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text
);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS request_id      VARCHAR(120);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS org_id          INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS platform        VARCHAR(20);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS jurisdiction    VARCHAR(10);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS agent_key       VARCHAR(120);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS category        VARCHAR(60);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS severity        VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS payload_summary TEXT;
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS sla_minutes     INTEGER     NOT NULL DEFAULT 60;
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS decided_at      TIMESTAMPTZ;
-- Reviewer-assignment columns the My-Approvals route (src/routes/jrx-my-approvals-routes.ts)
-- filters on. Legacy installs lacked `assigned_to` entirely (the type-convert
-- block below only runs WHEN it already exists), which 500'd the endpoint with
-- `column q.assigned_to does not exist`. Add them here so fresh + legacy installs
-- both carry the columns (the route also self-heals best-effort + degrades safely).
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS assigned_to     VARCHAR(120);
ALTER TABLE nv_hitl_queue ADD COLUMN IF NOT EXISTS assigned_role   VARCHAR;
CREATE INDEX IF NOT EXISTS idx_nv_hitl_queue_assigned_role
  ON nv_hitl_queue (assigned_role) WHERE assigned_to IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nv_hitl_queue_request_id_key'
  ) THEN
    ALTER TABLE nv_hitl_queue ADD CONSTRAINT nv_hitl_queue_request_id_key UNIQUE (request_id);
  END IF;
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS nv_hitl_queue_status2_idx ON nv_hitl_queue(status);
CREATE INDEX IF NOT EXISTS nv_hitl_queue_org_idx     ON nv_hitl_queue(org_id);
CREATE INDEX IF NOT EXISTS nv_hitl_queue_platform_idx ON nv_hitl_queue(platform);

-- nv_hitl_decisions — additive on legacy schema.
CREATE TABLE IF NOT EXISTS nv_hitl_decisions (
  id              SERIAL PRIMARY KEY
);
ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS request_id  VARCHAR(120);
ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS decision    VARCHAR(20);
ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS reason      TEXT;
ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS policy_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE nv_hitl_decisions ADD COLUMN IF NOT EXISTS metadata    JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS nv_hitl_decisions_request_idx ON nv_hitl_decisions(request_id);
CREATE INDEX IF NOT EXISTS nv_hitl_decisions_at2_idx     ON nv_hitl_decisions(decided_at DESC);

-- Loosen legacy NOT NULL constraints on nv_hitl_queue so the new request_id /
-- platform / agent_key / category seeder can insert without supplying
-- task_type or context (which are populated only by the older HITL flow).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nv_hitl_queue' AND column_name='task_type' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE nv_hitl_queue ALTER COLUMN task_type DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nv_hitl_queue' AND column_name='context' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE nv_hitl_queue ALTER COLUMN context DROP NOT NULL';
  END IF;
END $$;

-- Convert legacy nv_hitl_queue.assigned_to from int FK → varchar to support
-- the new external-reviewer-id flow (e.g. 'reviewer-3', external IdP subject IDs).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='nv_hitl_queue' AND column_name='assigned_to' AND data_type='integer'
  ) THEN
    EXECUTE 'ALTER TABLE nv_hitl_queue DROP CONSTRAINT IF EXISTS nv_hitl_queue_assigned_to_fkey';
    EXECUTE 'ALTER TABLE nv_hitl_queue ALTER COLUMN assigned_to TYPE VARCHAR(120) USING assigned_to::text';
  END IF;
END $$;

-- Convert legacy nv_hitl_decisions.decided_by from int FK → varchar to match assigned_to.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='nv_hitl_decisions' AND column_name='decided_by' AND data_type='integer'
  ) THEN
    EXECUTE 'ALTER TABLE nv_hitl_decisions DROP CONSTRAINT IF EXISTS nv_hitl_decisions_decided_by_fkey';
    EXECUTE 'ALTER TABLE nv_hitl_decisions ALTER COLUMN decided_by TYPE VARCHAR(120) USING decided_by::text';
  END IF;
END $$;

-- ── Multi-jurisdiction regulatory feeds (added 2026-05-14) ──────────────────
CREATE TABLE IF NOT EXISTS nv_regulatory_feeds (
  id                       SERIAL PRIMARY KEY,
  source_name              VARCHAR(200) NOT NULL,
  jurisdiction             VARCHAR(10)  NOT NULL,
  feed_type                VARCHAR(20)  NOT NULL DEFAULT 'rss',
  feed_url                 TEXT         NOT NULL,
  parser_type              VARCHAR(60)  NOT NULL DEFAULT 'rss',
  fetch_interval_minutes   INTEGER      NOT NULL DEFAULT 60,
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  last_fetched_at          TIMESTAMPTZ,
  last_change_detected_at  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (source_name, feed_url)
);
CREATE INDEX IF NOT EXISTS nv_regulatory_feeds_jur_idx    ON nv_regulatory_feeds(jurisdiction);
CREATE INDEX IF NOT EXISTS nv_regulatory_feeds_active_idx ON nv_regulatory_feeds(is_active);
-- Task #304 (Demo G3B): Tavily sweep persistence requires metadata + auth_config.
ALTER TABLE nv_regulatory_feeds
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auth_config jsonb NOT NULL DEFAULT '{}'::jsonb;
