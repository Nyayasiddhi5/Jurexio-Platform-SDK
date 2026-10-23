-- ============================================================================
-- 0010_bot_workflow_twin_persistence.sql — Task #223
--
-- Persist AutomateAI™, ClaWdBot™, OpenBot™, and TwinDesk™ records.
--
-- These tables back the in-memory Maps used by the four "products" services:
--   - src/services/automateai/automateai-service.ts
--   - src/services/clawdbot/clawdbot-service.ts
--   - src/services/openbot/openbot-service.ts
--   - src/services/twindesk/twindesk-service.ts
--
-- Until this migration shipped, those services kept all state (workflows,
-- bots, channels, routing rules, twins, etc.) in process-local Maps. Every
-- gateway restart wiped user data and multi-pod EC2 deployments diverged
-- per pod. The services already emitted write-through events into a generic
-- nv_persistence_helper that issues `INSERT … ON CONFLICT DO UPDATE` against
-- these tables — but the tables didn't exist, so every upsert silently
-- no-op'd ("hydrate failed (table may not exist yet — run db:push)").
--
-- Schemas mirror shared/schema.ts (nvClawdbotBots, nvClawdbotConversations,
-- nvOpenbotChannels, nvOpenbotRoutes, nvOpenbotInbox, nvAutomateaiWorkflows,
-- nvAutomateaiRuns, nvTwindeskTwins, nvTwindeskScenarios) plus a new
-- nv_twindesk_chat_sessions table so TwinDesk chat history also survives
-- restart.
--
-- All tables live in the nv_schema namespace (governance / SDK runtime
-- ownership). NV-DB-SCRIPT-001: standalone scripts use makePgSql; this
-- migration is run via drizzle-kit / npm run migrate, not the neon HTTP
-- driver, so writes land correctly off-Neon as well.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS nv_schema;

-- ── ClaWdBot™ ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_clawdbot_bots (
  bot_id      VARCHAR(32)  PRIMARY KEY,
  org_id      VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  config      JSONB        NOT NULL,
  status      VARCHAR(24)  NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_clawdbot_bots_org_idx
  ON nv_schema.nv_clawdbot_bots (org_id, status);

CREATE TABLE IF NOT EXISTS nv_schema.nv_clawdbot_conversations (
  conversation_id  VARCHAR(64) PRIMARY KEY,
  bot_id           VARCHAR(32) NOT NULL,
  org_id           VARCHAR(64),
  data             JSONB       NOT NULL,
  status           VARCHAR(24) NOT NULL DEFAULT 'active',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_clawdbot_conv_bot_idx
  ON nv_schema.nv_clawdbot_conversations (bot_id, last_message_at);

-- ── OpenBot™ ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_channels (
  channel_id    VARCHAR(32) PRIMARY KEY,
  channel_type  VARCHAR(32) NOT NULL,
  org_id        VARCHAR(64),
  config        JSONB       NOT NULL,
  status        VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_openbot_channels_org_idx
  ON nv_schema.nv_openbot_channels (org_id, status);

CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_routes (
  rule_id    VARCHAR(32) PRIMARY KEY,
  org_id     VARCHAR(64),
  rule       JSONB       NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_openbot_routes_org_idx
  ON nv_schema.nv_openbot_routes (org_id, is_active);

CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_inbox (
  message_id   VARCHAR(64) PRIMARY KEY,
  channel_id   VARCHAR(32) NOT NULL,
  org_id       VARCHAR(64),
  message      JSONB       NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_openbot_inbox_chan_idx
  ON nv_schema.nv_openbot_inbox (channel_id, received_at);

CREATE INDEX IF NOT EXISTS nv_openbot_inbox_org_idx
  ON nv_schema.nv_openbot_inbox (org_id, received_at);

-- ── AutomateAI™ ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_automateai_workflows (
  workflow_id  VARCHAR(48) PRIMARY KEY,
  org_id       VARCHAR(64) NOT NULL,
  definition   JSONB       NOT NULL,
  status       VARCHAR(24) NOT NULL DEFAULT 'draft',
  version      INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_automateai_wf_org_idx
  ON nv_schema.nv_automateai_workflows (org_id, status);

CREATE TABLE IF NOT EXISTS nv_schema.nv_automateai_runs (
  execution_id  VARCHAR(64) PRIMARY KEY,
  workflow_id   VARCHAR(48) NOT NULL,
  data          JSONB       NOT NULL,
  status        VARCHAR(24) NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS nv_automateai_runs_wf_idx
  ON nv_schema.nv_automateai_runs (workflow_id, started_at);

-- ── TwinDesk™ ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_twins (
  twin_id    VARCHAR(48) PRIMARY KEY,
  org_id     VARCHAR(64) NOT NULL,
  profile    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_twindesk_twins_org_idx
  ON nv_schema.nv_twindesk_twins (org_id);

CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_scenarios (
  scenario_id   VARCHAR(64) PRIMARY KEY,
  twin_id       VARCHAR(48) NOT NULL,
  data          JSONB       NOT NULL,
  simulated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_twindesk_scen_twin_idx
  ON nv_schema.nv_twindesk_scenarios (twin_id, simulated_at);

CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_chat_sessions (
  session_id        VARCHAR(64) PRIMARY KEY,
  twin_id           VARCHAR(48) NOT NULL,
  data              JSONB       NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nv_twindesk_chat_twin_idx
  ON nv_schema.nv_twindesk_chat_sessions (twin_id, last_message_at);

COMMENT ON TABLE nv_schema.nv_clawdbot_bots          IS 'Task #223 — ClaWdBot™ bot configurations (write-through from in-memory registry).';
COMMENT ON TABLE nv_schema.nv_clawdbot_conversations IS 'Task #223 — ClaWdBot™ conversations + message history.';
COMMENT ON TABLE nv_schema.nv_openbot_channels       IS 'Task #223 — OpenBot™ channel adapters (whatsapp/slack/teams/etc).';
COMMENT ON TABLE nv_schema.nv_openbot_routes         IS 'Task #223 — OpenBot™ bot-routing rules (priority + conditions).';
COMMENT ON TABLE nv_schema.nv_openbot_inbox          IS 'Task #223 — OpenBot™ unified inbox messages.';
COMMENT ON TABLE nv_schema.nv_automateai_workflows   IS 'Task #223 — AutomateAI™ workflow definitions (DAG of AI gates).';
COMMENT ON TABLE nv_schema.nv_automateai_runs        IS 'Task #223 — AutomateAI™ workflow executions (terminal states only).';
COMMENT ON TABLE nv_schema.nv_twindesk_twins         IS 'Task #223 — TwinDesk™ digital-twin profiles.';
COMMENT ON TABLE nv_schema.nv_twindesk_scenarios     IS 'Task #223 — TwinDesk™ simulation results.';
COMMENT ON TABLE nv_schema.nv_twindesk_chat_sessions IS 'Task #223 — TwinDesk™ persona chat sessions.';
