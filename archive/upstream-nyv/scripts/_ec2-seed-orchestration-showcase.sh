#!/usr/bin/env bash
# Orchestration Hub showcase seed + API probe — runs ON nysdev via SSM.
# Self-contained SQL (no repo deploy required). NV-SECRETS-001: no secret values logged.
set -euo pipefail

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null | tr -d '\r\n')"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/')"
if [ -z "$ADM" ]; then echo "FATAL: DATABASE_URL_ADMIN not set"; exit 1; fi
echo "ADMIN_URL_LEN=${#ADM}"

run_sql() {
  docker run --rm --network host -e PGURL="$ADM" -v "$1:/sql.sql:ro" postgres:16-alpine \
    sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /sql.sql'
}

TMP_ENSURE=/tmp/jrx-orch-ensure-$$.sql
cat > "$TMP_ENSURE" <<'EOSQL'
CREATE SCHEMA IF NOT EXISTS nv_schema;

CREATE TABLE IF NOT EXISTS nv_schema.mem0_memories (
  id uuid PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  namespace text NOT NULL DEFAULT 'default',
  type text NOT NULL DEFAULT 'episodic',
  content text NOT NULL,
  summary text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  importance real NOT NULL DEFAULT 0.5,
  strength real NOT NULL DEFAULT 1,
  access_count integer NOT NULL DEFAULT 0,
  embedding double precision[],
  embedding_model text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  last_reinforced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nv_schema.nv_digital_twins (
  twin_id varchar(128) PRIMARY KEY,
  organization_id varchar(128),
  entity_id varchar(256) NOT NULL,
  twin_type varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  profile jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nv_schema.memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  tenant_id text,
  memory_type text NOT NULL DEFAULT 'fact',
  scope text NOT NULL DEFAULT 'longterm',
  matter_id text,
  session_id text,
  key text,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance double precision DEFAULT 0.5,
  access_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nv_schema.ai_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id text NOT NULL UNIQUE,
  user_id text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'IN',
  pattern_key text,
  route text,
  template_mode text NOT NULL DEFAULT 'STRICT',
  risk_score integer NOT NULL DEFAULT 0,
  prompt_hash text NOT NULL,
  blocked boolean NOT NULL DEFAULT false,
  model_provider text,
  model_name text,
  tokens_used integer DEFAULT 0,
  cost_usd numeric(12,6) DEFAULT 0,
  latency_ms integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  jurisdiction_validated boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS nv_schema.data_lineage_events (
  id serial PRIMARY KEY,
  request_id text DEFAULT '',
  user_id text DEFAULT '',
  org_id text DEFAULT '',
  input_hash text DEFAULT '',
  agent_key text DEFAULT '',
  model_used text DEFAULT '',
  provider text DEFAULT '',
  rag_sources jsonb DEFAULT '[]'::jsonb,
  pii_detected jsonb DEFAULT '[]'::jsonb,
  output_hash text DEFAULT '',
  latency_ms integer DEFAULT 0,
  compliance_flags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nv_schema.bias_analysis_log (
  id serial PRIMARY KEY,
  agent_key text,
  session_id text,
  composite_score double precision,
  overall_severity text,
  flagged boolean DEFAULT false,
  dimension_scores jsonb DEFAULT '[]'::jsonb,
  signal_count integer DEFAULT 0,
  analysed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nv_schema.agent_chains (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_id text DEFAULT '',
  tenant_id text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
EOSQL
echo "=== ENSURE showcase tables ==="
run_sql "$TMP_ENSURE"
rm -f "$TMP_ENSURE"

TMP=/tmp/jrx-orch-showcase-$$.sql
cat > "$TMP" <<'EOSQL'
\echo === BEFORE ===
SELECT 'agent_metrics_24h' AS k, COUNT(*)::int AS n FROM nv_schema.nv_agent_metrics WHERE window_start > NOW() - interval '24 hours'
UNION ALL SELECT 'router_decisions_7d', COUNT(*)::int FROM nv_router_decisions WHERE ts > NOW() - interval '7 days'
UNION ALL SELECT 'memory_entries', COUNT(*)::int FROM nv_schema.memory_entries
UNION ALL SELECT 'mem0_memories', COUNT(*)::int FROM nv_schema.mem0_memories
UNION ALL SELECT 'digital_twins', COUNT(*)::int FROM nv_schema.nv_digital_twins WHERE status != 'archived'
UNION ALL SELECT 'ai_activity_7d', COUNT(*)::int FROM nv_schema.ai_activity WHERE created_at > NOW() - interval '7 days'
UNION ALL SELECT 'data_lineage_7d', COUNT(*)::int FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days'
UNION ALL SELECT 'bias_analysis_log', COUNT(*)::int FROM nv_schema.bias_analysis_log
UNION ALL SELECT 'agent_chains', COUNT(*)::int FROM nv_schema.agent_chains
UNION ALL SELECT 'grpo_runs', COUNT(*)::int FROM nv_schema.nv_grpo_runs
UNION ALL SELECT 'ai_feedback', COUNT(*)::int FROM nv_schema.ai_feedback
UNION ALL SELECT 'policies_active', COUNT(*)::int FROM nv_policies WHERE status = 'active';

\echo === AGENT METRICS ===
INSERT INTO nv_schema.nv_agent_metrics
  (agent_key, tenant_id, request_count, success_count, failure_count,
   total_latency_ms, total_cost_usd, metrics_window, window_start)
SELECT agent_key, 'demo-tenant', req,
       GREATEST(1, FLOOR(req * (0.86 + (idx % 8) * 0.012))::int),
       GREATEST(0, req - GREATEST(1, FLOOR(req * (0.86 + (idx % 8) * 0.012))::int)),
       req * (480 + (idx % 55) * 42),
       ROUND((req * 0.018 + (idx % 17) * 0.008)::numeric, 4),
       'day', NOW() - (random() * interval '12 hours')
FROM (
  SELECT agent_key, (ord - 1) AS idx, 12 + ((ord - 1) % 188) AS req
  FROM unnest(ARRAY[
    'Q-001','A-001','A-002','A-003','A-004','A-005','A-006','A-007','A-008','A-009',
    'A-010','A-011','A-012','A-013','A-014','A-015','A-016','A-017','A-018','A-019',
    'A-020','A-021','A-022','A-023','A-024','A-025','A-026','A-027','A-028','A-029',
    'A-030','A-031','A-032','A-033','A-034','A-035','A-036','A-037','A-038','A-039',
    'A-040','A-041','A-042','A-043','A-044','A-045','A-046','A-047','A-048','A-049',
    'A-050','A-051','A-052','A-053','A-054','A-055','A-056','A-057','A-058','A-059',
    'A-060','A-061','A-062','A-063','A-064','A-065','A-066','A-067','A-068','A-069',
    'A-070','A-071','A-072','A-073','A-074','A-075','A-076','A-077','A-078','A-079',
    'A-080','A-081','A-082','A-083','A-084','A-085','A-086','A-087','A-088','A-089',
    'A-090','A-091','A-092','A-093','A-094','A-095','A-096','A-097','A-098','A-099',
    'A-100','A-101','A-102','A-103','A-104','A-105','A-106','A-107','A-108','A-109',
    'A-110','A-111','A-112','A-113','A-114','A-115','A-116','A-117','A-118','A-119',
    'A-120','A-121','A-122','A-123','A-124','A-125','A-126','A-127','A-128','A-129',
    'A-130','A-131','A-132','A-133','A-134','A-135','A-136','A-137','A-138','A-139',
    'A-140','A-141','A-142','A-143','A-144','A-145','A-146','A-147'
  ]) WITH ORDINALITY AS t(agent_key, ord)
) s
WHERE (SELECT COUNT(*) FROM nv_schema.nv_agent_metrics WHERE window_start > NOW() - interval '24 hours') < 50;

\echo === ROUTER DECISIONS (demo-labeled) ===
INSERT INTO nv_router_decisions
  (ts, request_id, agent_id, tier, jurisdiction, task_kind,
   primary_model_id, picked_model_id, picked_provider, fallback_level,
   ok, latency_ms, cost_usd, tokens_in, tokens_out, error_message, meta)
SELECT
  NOW() - ((g.i * 2.1) || ' hours')::interval,
  'demo-orch-' || lpad(g.i::text, 4, '0'),
  (ARRAY['Q-001','A-001','A-012','A-024','A-036','A-048','A-060','A-072'])[1 + (g.i % 8)],
  'standard', 'IN', 'orchestration',
  m.model, m.model, m.prov,
  CASE WHEN g.i % 5 = 0 THEN 1 ELSE 0 END,
  g.i % 11 <> 0,
  420 + (g.i % 90) * 48,
  ROUND((0.002 + (g.i % 17) * 0.0008)::numeric, 5),
  800 + (g.i % 40) * 120,
  400 + (g.i % 30) * 90,
  CASE WHEN g.i % 11 = 0 THEN 'demo: provider_timeout' ELSE NULL END,
  '{"source":"demo-seed","label":"orchestration-showcase"}'::jsonb
FROM generate_series(
  0,
  GREATEST(0, 80 - (SELECT COUNT(*)::int FROM nv_router_decisions WHERE ts > NOW() - interval '7 days') - 1)
) AS g(i)
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('google','gemini-2.5-flash'), ('openai','gpt-4.1-mini'),
    ('anthropic','claude-sonnet-4-6'), ('sarvam','sarvam-m')
  ) AS t(prov, model)
  OFFSET (g.i % 4) LIMIT 1
) m;

\echo === MEMORY ENTRIES ===
INSERT INTO nv_schema.memory_entries
  (user_id, tenant_id, memory_type, scope, matter_id, session_id, key, value, importance, access_count, created_at)
SELECT
  'demo-admin', 'demo-tenant',
  (ARRAY['fact','episodic','semantic','procedural'])[1 + (i % 4)],
  (ARRAY['session','matter','client','jurisdictional','longterm'])[1 + (i % 5)],
  CASE WHEN i % 3 = 0 THEN 'matter-demo-' || ((i % 8) + 1) ELSE NULL END,
  CASE WHEN i % 2 = 0 THEN 'sess-demo-' || ((i % 12) + 1) ELSE NULL END,
  'demo-key-' || i,
  jsonb_build_object('text', '[DEMO] Memory fixture ' || i, 'source', 'orchestration-showcase'),
  0.4 + (i % 10) * 0.05, i % 20,
  NOW() - ((i * 3.7) || ' hours')::interval
FROM generate_series(
  (SELECT COUNT(*)::int FROM nv_schema.memory_entries),
  GREATEST((SELECT COUNT(*)::int FROM nv_schema.memory_entries), 44)
) AS s(i)
WHERE (SELECT COUNT(*) FROM nv_schema.memory_entries) < 40;

\echo === MEM0 MEMORIES ===
INSERT INTO nv_schema.mem0_memories
  (id, agent_id, namespace, type, content, summary, tags, importance, strength, metadata, created_at, last_accessed_at, last_reinforced_at)
SELECT
  gen_random_uuid(),
  (ARRAY['Q-001','A-001','A-012','A-024','A-036'])[1 + (i % 5)],
  CASE WHEN i % 2 = 0 THEN 'cam:IN' ELSE 'cam:US' END,
  CASE WHEN i % 3 = 0 THEN 'episodic' ELSE 'factual' END,
  '[DEMO mem0] BNSS application pattern fixture ' || i,
  'Demo CAM memory ' || i,
  '["demo","orchestration-showcase","IN"]'::jsonb,
  0.55 + (i % 8) * 0.04, 0.9,
  '{"demo":true,"seededBy":"orchestration-showcase"}'::jsonb,
  NOW() - ((i * 4.2) || ' hours')::interval, NOW(), NOW()
FROM generate_series(
  0,
  GREATEST(0, 29 - (SELECT COUNT(*)::int FROM nv_schema.mem0_memories))
) AS s(i)
WHERE (SELECT COUNT(*) FROM nv_schema.mem0_memories) < 25;

\echo === DIGITAL TWINS ===
INSERT INTO nv_schema.nv_digital_twins (twin_id, organization_id, entity_id, twin_type, status, profile, created_at, updated_at)
VALUES
  ('demo-twin-senior-counsel-in', '1', 'adv-sharma-demo', 'senior_counsel', 'active',
   '{"displayName":"[DEMO] Senior Counsel — Delhi HC","demo":true,"jurisdiction":"IN"}'::jsonb, NOW(), NOW()),
  ('demo-twin-compliance-officer', '1', 'dpo-patel-demo', 'compliance_officer', 'active',
   '{"displayName":"[DEMO] DPDPA Compliance Officer","demo":true}'::jsonb, NOW(), NOW()),
  ('demo-twin-litigation-strategist', '1', 'lit-iyer-demo', 'litigation_strategist', 'active',
   '{"displayName":"[DEMO] Litigation Strategist","demo":true}'::jsonb, NOW(), NOW()),
  ('demo-twin-corporate-ma', '1', 'corp-khan-demo', 'corporate_ma', 'active',
   '{"displayName":"[DEMO] M&A Corporate Counsel","demo":true}'::jsonb, NOW(), NOW()),
  ('demo-twin-citizen-helper', '1', 'nym-citizen-demo', 'citizen_helper', 'active',
   '{"displayName":"[DEMO] NYM Citizen Helper","demo":true}'::jsonb, NOW(), NOW())
ON CONFLICT (twin_id) DO NOTHING;

\echo === AGENT CHAINS (A2A / BMAD) ===
INSERT INTO nv_schema.agent_chains (name, description, steps, user_id, tenant_id, created_at)
SELECT v.chain_name, v.chain_desc, v.steps::jsonb, 'demo-admin', 'demo-tenant', NOW() - (random() * interval '5 days')
FROM (VALUES
  ('BMAD: Contract review — IN demo', '[DEMO] Analyst→Architect→Developer→QA',
   '[{"agentKey":"A-001","role":"analyst"},{"agentKey":"A-012","role":"architect"},{"agentKey":"A-024","role":"developer"},{"agentKey":"A-036","role":"qa"}]'),
  ('BMAD: DPDPA impact assessment', '[DEMO] BMAD workflow',
   '[{"agentKey":"A-005","role":"analyst"},{"agentKey":"A-018","role":"architect"}]'),
  ('A2A: Queen → specialist handoff', '[DEMO] ROMA L5 collaboration',
   '[{"agentKey":"Q-001","role":"coordinator"},{"agentKey":"A-042","role":"specialist"}]'),
  ('A2A: Citation verify pipeline', '[DEMO] Multi-agent citation',
   '[{"agentKey":"A-033","role":"researcher"},{"agentKey":"A-044","role":"verifier"}]')
) AS v(chain_name, chain_desc, steps)
WHERE NOT EXISTS (SELECT 1 FROM nv_schema.agent_chains c WHERE c.name = v.chain_name)
  AND (SELECT COUNT(*) FROM nv_schema.agent_chains) < 8;

\echo === BIAS ANALYSIS (CAM reviews) ===
INSERT INTO nv_schema.bias_analysis_log
  (agent_key, session_id, composite_score, overall_severity, flagged, dimension_scores, signal_count, analysed_at)
SELECT
  (ARRAY['Q-001','A-001','A-012','A-024'])[1 + (i % 4)],
  'demo-cam-sess-' || i,
  0.72 + (i % 10) * 0.02,
  CASE WHEN i % 7 = 0 THEN 'high' ELSE 'medium' END,
  i % 9 = 0,
  '[{"dimension":"jurisdiction_parity","score":0.88}]'::jsonb,
  2 + (i % 4),
  NOW() - ((i * 5.5) || ' hours')::interval
FROM generate_series(
  (SELECT COUNT(*)::int FROM nv_schema.bias_analysis_log),
  GREATEST((SELECT COUNT(*)::int FROM nv_schema.bias_analysis_log), 19)
) AS s(i)
WHERE (SELECT COUNT(*) FROM nv_schema.bias_analysis_log) < 15;

\echo === DATA LINEAGE ===
INSERT INTO nv_schema.data_lineage_events
  (request_id, user_id, org_id, agent_key, model_used, provider, input_hash, output_hash,
   rag_sources, pii_detected, latency_ms, compliance_flags, created_at)
SELECT
  'demo-lin-' || lpad(i::text, 4, '0'),
  'demo-admin', '1',
  (ARRAY['Q-001','A-001','A-012'])[1 + (i % 3)],
  'gemini-2.5-flash', 'google',
  'sha256:demo-in-' || i, 'sha256:demo-out-' || i,
  '[{"source":"demo-statute-corpus"}]'::jsonb,
  CASE WHEN i % 8 = 0 THEN '["AADHAAR"]'::jsonb ELSE '[]'::jsonb END,
  380 + (i % 50) * 22,
  '["grounded","citation_verified"]'::jsonb,
  NOW() - ((i * 3.1) || ' hours')::interval
FROM generate_series(
  0,
  GREATEST(0, 34 - (SELECT COUNT(*)::int FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days'))
) AS s(i)
WHERE (SELECT COUNT(*) FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days') < 30;

\echo === AI ACTIVITY backfill (if sparse) ===
INSERT INTO nv_schema.ai_activity
  (trace_id, user_id, jurisdiction, pattern_key, route, template_mode,
   risk_score, prompt_hash, blocked, model_provider, model_name,
   tokens_used, latency_ms, created_at, jurisdiction_validated)
SELECT
  'trace-orch-demo-' || lpad(i::text, 5, '0'),
  '_global',
  (ARRAY['IN','US','EU','UK','SG','GC'])[1 + (i % 6)],
  (ARRAY['react','cot','graph-rag','hitl-gate'])[1 + (i % 4)],
  (ARRAY['/api/jrx/orchestrate','/api/jrx/orchestrate/stream','/api/jrx/ai/chat'])[1 + (i % 3)],
  'STRICT', (i * 3) % 60, md5('trace-orch-' || i), i % 47 = 0,
  'google', 'gemini-2.5-flash', 200 + (i % 40) * 90, 80 + (i % 50) * 35,
  NOW() - ((i * 10) || ' minutes')::interval, true
FROM generate_series(1, 200) AS s(i)
WHERE (SELECT COUNT(*) FROM nv_schema.ai_activity WHERE created_at > NOW() - interval '7 days') < 700
ON CONFLICT (trace_id) DO NOTHING;

\echo === AFTER ===
SELECT 'agent_metrics_24h' AS k, COUNT(*)::int AS n FROM nv_schema.nv_agent_metrics WHERE window_start > NOW() - interval '24 hours'
UNION ALL SELECT 'router_decisions_7d', COUNT(*)::int FROM nv_router_decisions WHERE ts > NOW() - interval '7 days'
UNION ALL SELECT 'memory_entries', COUNT(*)::int FROM nv_schema.memory_entries
UNION ALL SELECT 'mem0_memories', COUNT(*)::int FROM nv_schema.mem0_memories
UNION ALL SELECT 'digital_twins', COUNT(*)::int FROM nv_schema.nv_digital_twins WHERE status != 'archived'
UNION ALL SELECT 'ai_activity_7d', COUNT(*)::int FROM nv_schema.ai_activity WHERE created_at > NOW() - interval '7 days'
UNION ALL SELECT 'data_lineage_7d', COUNT(*)::int FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days'
UNION ALL SELECT 'bias_analysis_log', COUNT(*)::int FROM nv_schema.bias_analysis_log
UNION ALL SELECT 'agent_chains', COUNT(*)::int FROM nv_schema.agent_chains
UNION ALL SELECT 'grpo_runs', COUNT(*)::int FROM nv_schema.nv_grpo_runs
UNION ALL SELECT 'ai_feedback', COUNT(*)::int FROM nv_schema.ai_feedback
UNION ALL SELECT 'policies_active', COUNT(*)::int FROM nv_policies WHERE status = 'active';
EOSQL

run_sql "$TMP"
rm -f "$TMP"

echo "=== API PROBE (JWT) ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
BASE="http://127.0.0.1:5000"
ORIGIN="https://console.nyayasiddhi.online"
curl -sS -o /tmp/jrx-login.json -w 'login_http=%{http_code}\n' -m 20 \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"$PW\"}" \
  "$BASE/api/jrx/auth/login"
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/jrx-login.json')).get('token',''))" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then echo "probe=SKIP(no_token)"; exit 0; fi

for ep in \
  "orch-dash|$BASE/api/jrx/orchestration/dashboard" \
  "swarm-stats|$BASE/api/jrx/swarm/stats" \
  "swarm-topo|$BASE/api/jrx/swarm/topologies?limit=5" \
  "cam-dash|$BASE/api/nyayavigya/cam/dashboard" \
  "router|$BASE/api/jrx/orchestration/router-decisions?limit=5" \
  "memory|$BASE/api/jrx/cam/entries?limit=5" \
  "grpo|$BASE/api/jrx/compliance/grpo" \
  "policies|$BASE/api/jrx/policies?limit=5" \
  "activity|$BASE/api/jrx/activity/recent?limit=5" \
  "chains|$BASE/api/jrx/orchestration/chains" \
  "health|$BASE/api/jrx/health"
do
  name="${ep%%|*}"; url="${ep#*|}"
  curl -sS -o "/tmp/jrx-probe-${name}.json" -w "${name}_http=%{http_code}\n" -m 25 \
    -H "Authorization: Bearer $TOKEN" "$url"
done

python3 - <<'PY'
import json

def load(p):
    try:
        return json.load(open(p))
    except Exception:
        return {}

def cnt(d, *keys, default="ABSENT"):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    if isinstance(cur, list):
        return len(cur)
    return cur if cur is not None else default

print("--- probe summary ---")
h = load("/tmp/jrx-probe-health.json")
print("health_totalAgents=", h.get("totalAgents", h.get("services", {}).get("agents", {}).get("totalAgents", "ABSENT")))
od = load("/tmp/jrx-probe-orch-dash.json")
data = od.get("data") or od
print("orch_dash_memoryEntries=", data.get("memoryEntries", "ABSENT"))
rd = load("/tmp/jrx-probe-router.json")
print("router_decisions=", cnt(rd, "data", "decisions") or cnt(rd, "recent"))
mem = load("/tmp/jrx-probe-memory.json")
print("cam_entries=", cnt(mem, "data", "entries") or cnt(mem, "entries"))
act = load("/tmp/jrx-probe-activity.json")
print("activity_events=", cnt(act, "data", "events"))
ss = load("/tmp/jrx-probe-swarm-stats.json")
print("swarm_total=", ss.get("total", ss.get("data", {}).get("total", "ABSENT")))
PY

echo "=== DONE ==="
