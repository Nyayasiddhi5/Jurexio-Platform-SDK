-- NV-SCHEMA-DRIFT-B-001 — Telemetry tables for agent metrics, hallucination checks, usage.
-- Idempotent. Apply on prod via deploy hook or: psql "$DATABASE_URL" -f migrations/2026-07-05-nv-drift-b-telemetry.sql

CREATE SCHEMA IF NOT EXISTS nv_schema;

-- agent_metrics (hourly rollups)
CREATE TABLE IF NOT EXISTS nv_schema.agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key TEXT NOT NULL,
  tenant_id TEXT,
  period TEXT NOT NULL DEFAULT 'hour',
  period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_requests BIGINT NOT NULL DEFAULT 0,
  avg_latency_ms DOUBLE PRECISION,
  avg_tokens DOUBLE PRECISION,
  avg_cost_usd DOUBLE PRECISION,
  error_rate DOUBLE PRECISION,
  satisfaction_score DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent ON nv_schema.agent_metrics(agent_key);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_period ON nv_schema.agent_metrics(period_start DESC);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_tenant ON nv_schema.agent_metrics(tenant_id);

-- nv_agent_metrics (windowed counters)
CREATE TABLE IF NOT EXISTS nv_schema.nv_agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key TEXT NOT NULL,
  tenant_id TEXT,
  request_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  total_latency_ms BIGINT DEFAULT 0,
  total_input_tokens BIGINT DEFAULT 0,
  total_output_tokens BIGINT DEFAULT 0,
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  metrics_window TEXT DEFAULT 'hour',
  window_start TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nv_agent_metrics_agent_window ON nv_schema.nv_agent_metrics(agent_key, window_start DESC);

-- hallucination_checks
CREATE TABLE IF NOT EXISTS nv_schema.hallucination_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  agent_key TEXT,
  input_text TEXT,
  output_text TEXT,
  confidence_score NUMERIC(5,4),
  grounding_score NUMERIC(5,4),
  flagged_claims JSONB DEFAULT '[]'::jsonb,
  verified_citations JSONB DEFAULT '[]'::jsonb,
  unverified_citations JSONB DEFAULT '[]'::jsonb,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_halluc_request ON nv_schema.hallucination_checks(request_id);
CREATE INDEX IF NOT EXISTS idx_halluc_status ON nv_schema.hallucination_checks(status, created_at DESC);

-- ai_activity (usage / audit telemetry)
CREATE TABLE IF NOT EXISTS nv_schema.ai_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'IN',
  pattern_key TEXT,
  route TEXT,
  template_mode TEXT NOT NULL DEFAULT 'STRICT',
  risk_score INTEGER NOT NULL DEFAULT 0,
  prompt_hash TEXT NOT NULL,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  model_provider TEXT,
  model_name TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  jurisdiction_validated BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_ai_act_created ON nv_schema.ai_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_act_user ON nv_schema.ai_activity(user_id);

-- EDJ access deny audit (optional P1)
CREATE TABLE IF NOT EXISTS nv_schema.nv_edj_access_denials (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  caller_app_id INTEGER,
  caller_platform TEXT,
  caller_org_id TEXT,
  reason TEXT NOT NULL DEFAULT 'forbidden',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edj_denials_job ON nv_schema.nv_edj_access_denials(job_id);
CREATE INDEX IF NOT EXISTS idx_edj_denials_created ON nv_schema.nv_edj_access_denials(created_at DESC);

-- async_job_queue (EDJ mirror — must exist before index below; idempotent)
CREATE TABLE IF NOT EXISTS nv_schema.async_job_queue (
  id            SERIAL PRIMARY KEY,
  job_id        TEXT NOT NULL UNIQUE,
  job_type      TEXT NOT NULL,
  status        TEXT DEFAULT 'queued',
  priority      TEXT DEFAULT 'normal',
  input         JSONB DEFAULT '{}'::jsonb,
  output        JSONB,
  error_message TEXT,
  user_id       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_async_jobs_user ON nv_schema.async_job_queue(user_id, created_at DESC);

-- async_job_queue / router_decisions index review (10K load)
CREATE INDEX IF NOT EXISTS idx_async_job_queue_status_created
  ON nv_schema.async_job_queue(status, created_at DESC)
  WHERE status IN ('queued', 'processing', 'retry');

CREATE INDEX IF NOT EXISTS idx_nv_router_decisions_created
  ON nv_router_decisions(ts DESC);
