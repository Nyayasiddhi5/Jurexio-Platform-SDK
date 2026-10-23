-- ============================================================================
-- 0011_security_audit_persistence.sql — Task #262
--
-- Promote the six security-audit tables from in-memory stubs (the no-op
-- `db` + `Tbl = {} as ...` shapes that lived at the top of
-- src/packages/security/security-audit-persistence-service.ts) into real
-- nv_schema tables. Until this migration shipped every logSecurityAudit /
-- logPiiDetections / saveComplianceReport / logAttackSimulation /
-- trackVulnerability / recordDailyMetrics call appeared to succeed while
-- silently dropping the row, so audit & compliance evidence never landed
-- on disk. Schemas mirror shared/schema.ts (nvSecurityAuditLogs etc).
--
-- All tables live under nv_schema (governance / SDK runtime ownership) to
-- match nvAuditLogsHashChain and the AutomateAI/ClaWdBot/etc. families
-- introduced by 0010. NV-DB-SCRIPT-001: this migration is run via
-- drizzle-kit / npm run migrate, not the neon HTTP driver, so writes
-- land correctly off-Neon as well.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS nv_schema;

-- ── nv_security_audit_logs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_security_audit_logs (
  id                  SERIAL PRIMARY KEY,
  scan_type           VARCHAR(64)  NOT NULL,
  target_type         VARCHAR(32)  NOT NULL,
  severity            VARCHAR(16)  NOT NULL,
  vulnerability_type  VARCHAR(64)  NOT NULL,
  owasp_id            VARCHAR(32)  NOT NULL,
  cwe_id              VARCHAR(32),
  title               VARCHAR(255) NOT NULL,
  description         TEXT         NOT NULL,
  location            TEXT         NOT NULL,
  evidence            TEXT,
  recommendation      TEXT         NOT NULL,
  raw_data            JSONB        DEFAULT '{}'::jsonb,
  agent_id            VARCHAR(100),
  user_id             VARCHAR(100),
  project_id          VARCHAR(100),
  resolved            BOOLEAN      NOT NULL DEFAULT FALSE,
  resolved_at         TIMESTAMPTZ,
  resolved_by         VARCHAR(100),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_security_audit_logs_created_idx
  ON nv_schema.nv_security_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS nv_security_audit_logs_severity_idx
  ON nv_schema.nv_security_audit_logs (severity, created_at);
CREATE INDEX IF NOT EXISTS nv_security_audit_logs_resolved_idx
  ON nv_schema.nv_security_audit_logs (resolved, created_at);

-- ── nv_pii_detections ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_pii_detections (
  id              SERIAL PRIMARY KEY,
  audit_log_id    INTEGER     NOT NULL,
  pii_type        VARCHAR(32) NOT NULL,
  confidence      INTEGER     NOT NULL,
  location_start  INTEGER     NOT NULL,
  location_end    INTEGER     NOT NULL,
  redacted_value  TEXT,
  context         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_pii_detections_audit_idx
  ON nv_schema.nv_pii_detections (audit_log_id);

-- ── nv_compliance_reports ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_compliance_reports (
  id                 SERIAL PRIMARY KEY,
  standard           VARCHAR(32)  NOT NULL,
  report_type        VARCHAR(32)  NOT NULL,
  date_range_start   TIMESTAMPTZ  NOT NULL,
  date_range_end     TIMESTAMPTZ  NOT NULL,
  compliant          BOOLEAN      NOT NULL DEFAULT FALSE,
  critical_findings  INTEGER      NOT NULL DEFAULT 0,
  high_findings      INTEGER      NOT NULL DEFAULT 0,
  medium_findings    INTEGER      NOT NULL DEFAULT 0,
  low_findings       INTEGER      NOT NULL DEFAULT 0,
  info_findings      INTEGER      NOT NULL DEFAULT 0,
  total_findings     INTEGER      NOT NULL DEFAULT 0,
  findings           JSONB        DEFAULT '[]'::jsonb,
  recommendations    JSONB        DEFAULT '[]'::jsonb,
  evidence_sources   JSONB        DEFAULT '{}'::jsonb,
  generated_by       VARCHAR(100),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_compliance_reports_standard_idx
  ON nv_schema.nv_compliance_reports (standard, created_at);

-- ── nv_attack_simulations ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_attack_simulations (
  id            SERIAL PRIMARY KEY,
  attack_type   VARCHAR(32)  NOT NULL,
  target_agent  VARCHAR(100) NOT NULL,
  payload       TEXT         NOT NULL,
  response      TEXT,
  successful    BOOLEAN      NOT NULL DEFAULT FALSE,
  severity      VARCHAR(16)  NOT NULL,
  blocked       BOOLEAN      NOT NULL DEFAULT FALSE,
  mitigation    TEXT,
  techniques    JSONB        DEFAULT '[]'::jsonb,
  metadata      JSONB        DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_attack_simulations_agent_idx
  ON nv_schema.nv_attack_simulations (target_agent, created_at);

-- ── nv_vulnerability_history ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_vulnerability_history (
  id                SERIAL PRIMARY KEY,
  vulnerability_id  VARCHAR(100) NOT NULL,
  audit_log_id      INTEGER      NOT NULL,
  status            VARCHAR(32)  NOT NULL DEFAULT 'discovered',
  priority          VARCHAR(16)  NOT NULL,
  cvss_score        REAL,
  affected_systems  JSONB        DEFAULT '[]'::jsonb,
  assigned_to       VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nv_vulnerability_history_vuln_idx
  ON nv_schema.nv_vulnerability_history (vulnerability_id);
CREATE INDEX IF NOT EXISTS nv_vulnerability_history_status_idx
  ON nv_schema.nv_vulnerability_history (status, updated_at);

-- ── nv_security_metrics ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_security_metrics (
  id                          SERIAL PRIMARY KEY,
  metric_date                 TIMESTAMPTZ NOT NULL,
  total_scans                 INTEGER     NOT NULL DEFAULT 0,
  prompt_injection_attempts   INTEGER     NOT NULL DEFAULT 0,
  pii_leaks                   INTEGER     NOT NULL DEFAULT 0,
  malicious_code_detected     INTEGER     NOT NULL DEFAULT 0,
  jailbreak_attempts          INTEGER     NOT NULL DEFAULT 0,
  data_extraction_attempts    INTEGER     NOT NULL DEFAULT 0,
  critical_vulnerabilities    INTEGER     NOT NULL DEFAULT 0,
  high_vulnerabilities        INTEGER     NOT NULL DEFAULT 0,
  medium_vulnerabilities      INTEGER     NOT NULL DEFAULT 0,
  low_vulnerabilities         INTEGER     NOT NULL DEFAULT 0,
  mean_time_to_detect         INTEGER,
  mean_time_to_resolve        INTEGER,
  compliance_score            REAL,
  metadata                    JSONB       DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nv_security_metrics_date_idx
  ON nv_schema.nv_security_metrics (metric_date);

COMMENT ON TABLE nv_schema.nv_security_audit_logs IS
  'Task #262 — OWASP-LLM Top-10 audit findings (replaces in-memory stub).';
COMMENT ON TABLE nv_schema.nv_pii_detections IS
  'Task #262 — PII redactions tied to a parent audit log row.';
COMMENT ON TABLE nv_schema.nv_compliance_reports IS
  'Task #262 — SOC2 / GDPR / HIPAA / PCI-DSS compliance report snapshots.';
COMMENT ON TABLE nv_schema.nv_attack_simulations IS
  'Task #262 — Red-team adversarial attack runs against agents.';
COMMENT ON TABLE nv_schema.nv_vulnerability_history IS
  'Task #262 — Per-vulnerability lifecycle tracker (discovered → resolved).';
COMMENT ON TABLE nv_schema.nv_security_metrics IS
  'Task #262 — Daily aggregated security KPIs for the dashboard.';
