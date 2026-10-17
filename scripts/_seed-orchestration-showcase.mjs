#!/usr/bin/env node
/**
 * One-shot admin seed for Orchestration Hub demo KPIs (nysdev / UAT).
 * Idempotent — tops up sparse tables; demo-labeled rows where supported.
 *
 * Usage:
 *   DATABASE_URL_ADMIN=… node scripts/_seed-orchestration-showcase.mjs
 *   # or on EC2 via scripts/_ec2-seed-orchestration-showcase.sh (SSM)
 *
 * NV-SECRETS-001: never log connection strings — only prints counts.
 */
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn =
  process.env.DATABASE_URL_ADMIN ??
  process.env.NYV_DATABASE_URL ??
  process.env.DATABASE_URL;
if (!conn) {
  console.error('FATAL: set DATABASE_URL_ADMIN (or DATABASE_URL)');
  process.exit(2);
}

function sslConfig(url) {
  if (/sslmode=disable/i.test(url)) return false;
  return { rejectUnauthorized: false };
}

const pool = new pg.Pool({ connectionString: conn, ssl: sslConfig(conn), max: 4 });

async function q(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows;
}

async function count(label, sql) {
  const r = await q(sql);
  const n = Number(r[0]?.n ?? r[0]?.count ?? 0);
  return { label, n };
}

const COUNT_QUERIES = [
  ['agent_metrics_24h', `SELECT COUNT(*)::int AS n FROM nv_schema.nv_agent_metrics WHERE window_start > NOW() - interval '24 hours'`],
  ['router_decisions_7d', `SELECT COUNT(*)::int AS n FROM nv_router_decisions WHERE ts > NOW() - interval '7 days'`],
  ['memory_entries', `SELECT COUNT(*)::int AS n FROM nv_schema.memory_entries`],
  ['mem0_memories', `SELECT COUNT(*)::int AS n FROM nv_schema.mem0_memories`],
  ['digital_twins', `SELECT COUNT(*)::int AS n FROM nv_schema.nv_digital_twins WHERE status != 'archived'`],
  ['ai_activity_7d', `SELECT COUNT(*)::int AS n FROM nv_schema.ai_activity WHERE created_at > NOW() - interval '7 days'`],
  ['data_lineage_7d', `SELECT COUNT(*)::int AS n FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days'`],
  ['bias_analysis_log', `SELECT COUNT(*)::int AS n FROM nv_schema.bias_analysis_log`],
  ['agent_chains', `SELECT COUNT(*)::int AS n FROM nv_schema.agent_chains`],
  ['grpo_runs', `SELECT COUNT(*)::int AS n FROM nv_schema.nv_grpo_runs`],
  ['grpo_episodes', `SELECT COUNT(*)::int AS n FROM nv_schema.nv_grpo_episodes`],
  ['ai_feedback', `SELECT COUNT(*)::int AS n FROM nv_schema.ai_feedback`],
  ['policies_active', `SELECT COUNT(*)::int AS n FROM nv_policies WHERE status = 'active'`],
  ['consent_demo_7d', `SELECT COUNT(*)::int AS n FROM nv_schema.nv_consent_records WHERE granted_at > NOW() - interval '7 days' AND (org_id LIKE '10%' OR org_id LIKE '11%')`],
];

async function snapshot(phase) {
  console.log(`\n=== ${phase} ===`);
  const rows = [];
  for (const [label, sql] of COUNT_QUERIES) {
    rows.push(await count(label, sql));
  }
  for (const { label, n } of rows) console.log(`${label}=${n}`);
  return Object.fromEntries(rows.map(({ label, n }) => [label, n]));
}

const AGENT_KEYS = [
  'Q-001', 'A-001', 'A-002', 'A-003', 'A-004', 'A-005', 'A-006', 'A-007', 'A-008', 'A-009',
  'A-010', 'A-011', 'A-012', 'A-013', 'A-014', 'A-015', 'A-016', 'A-017', 'A-018', 'A-019',
  'A-020', 'A-021', 'A-022', 'A-023', 'A-024', 'A-025', 'A-026', 'A-027', 'A-028', 'A-029',
  'A-030', 'A-031', 'A-032', 'A-033', 'A-034', 'A-035', 'A-036', 'A-037', 'A-038', 'A-039',
  'A-040', 'A-041', 'A-042', 'A-043', 'A-044', 'A-045', 'A-046', 'A-047', 'A-048', 'A-049',
  'A-050', 'A-051', 'A-052', 'A-053', 'A-054', 'A-055', 'A-056', 'A-057', 'A-058', 'A-059',
  'A-060', 'A-061', 'A-062', 'A-063', 'A-064', 'A-065', 'A-066', 'A-067', 'A-068', 'A-069',
  'A-070', 'A-071', 'A-072', 'A-073', 'A-074', 'A-075', 'A-076', 'A-077', 'A-078', 'A-079',
  'A-080', 'A-081', 'A-082', 'A-083', 'A-084', 'A-085', 'A-086', 'A-087', 'A-088', 'A-089',
  'A-090', 'A-091', 'A-092', 'A-093', 'A-094', 'A-095', 'A-096', 'A-097', 'A-098', 'A-099',
  'A-100', 'A-101', 'A-102', 'A-103', 'A-104', 'A-105', 'A-106', 'A-107', 'A-108', 'A-109',
  'A-110', 'A-111', 'A-112', 'A-113', 'A-114', 'A-115', 'A-116', 'A-117', 'A-118', 'A-119',
  'A-120', 'A-121', 'A-122', 'A-123', 'A-124', 'A-125', 'A-126', 'A-127', 'A-128', 'A-129',
  'A-130', 'A-131', 'A-132', 'A-133', 'A-134', 'A-135', 'A-136', 'A-137', 'A-138', 'A-139',
  'A-140', 'A-141', 'A-142', 'A-143', 'A-144', 'A-145', 'A-146', 'A-147',
];

const MODELS = [
  ['google', 'gemini-2.5-flash'],
  ['openai', 'gpt-4.1-mini'],
  ['anthropic', 'claude-sonnet-4-6'],
  ['sarvam', 'sarvam-m'],
];

async function seedAgentMetrics() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.nv_agent_metrics WHERE window_start > NOW() - interval '24 hours'`))[0]?.n ?? 0);
  if (have >= 50) {
    console.log(`  agent_metrics: skip (${have} in 24h)`);
    return;
  }
  let n = 0;
  for (let i = 0; i < AGENT_KEYS.length; i++) {
    const agent = AGENT_KEYS[i];
    const req = 12 + (i % 188);
    const succ = Math.max(1, Math.floor(req * (0.86 + (i % 8) * 0.012)));
    const fail = Math.max(0, req - succ);
    await q(
      `INSERT INTO nv_schema.nv_agent_metrics
         (agent_key, tenant_id, request_count, success_count, failure_count,
          total_latency_ms, total_cost_usd, metrics_window, window_start)
       VALUES ($1, 'demo-tenant', $2, $3, $4, $5, $6, 'day', NOW() - (random() * interval '12 hours'))`,
      [agent, req, succ, fail, req * (480 + (i % 55) * 42), Math.round((req * 0.018 + (i % 17) * 0.008) * 10000) / 10000],
    );
    n++;
  }
  console.log(`  agent_metrics: inserted ${n}`);
}

async function seedRouterDecisions() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_router_decisions WHERE ts > NOW() - interval '7 days'`))[0]?.n ?? 0);
  const TARGET = 80;
  if (have >= TARGET) {
    console.log(`  router_decisions: skip (${have} in 7d)`);
    return;
  }
  const need = TARGET - have;
  let n = 0;
  for (let i = 0; i < need; i++) {
    const idx = i % AGENT_KEYS.length;
    const [prov, model] = MODELS[i % MODELS.length];
    const ok = i % 11 !== 0;
    const reqId = `demo-orch-${String(i).padStart(4, '0')}`; // ≤64 chars
    await q(
      `INSERT INTO nv_router_decisions
         (ts, request_id, agent_id, tier, jurisdiction, task_kind,
          primary_model_id, picked_model_id, picked_provider, fallback_level,
          ok, latency_ms, cost_usd, tokens_in, tokens_out, error_message, meta)
       VALUES (
         NOW() - ($1 || ' hours')::interval,
         $2, $3, 'standard', 'IN', 'orchestration',
         $4, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13::jsonb
       )`,
      [
        (i * 2.1) % 168,
        reqId,
        AGENT_KEYS[idx],
        model,
        prov,
        i % 5 === 0 ? 1 : 0,
        ok,
        420 + (i % 90) * 48,
        Math.round((0.002 + (i % 17) * 0.0008) * 100000) / 100000,
        800 + (i % 40) * 120,
        400 + (i % 30) * 90,
        ok ? null : 'demo: provider_timeout',
        JSON.stringify({ source: 'demo-seed', label: 'orchestration-showcase' }),
      ],
    );
    n++;
  }
  console.log(`  router_decisions: inserted ${n}`);
}

async function seedMemoryEntries() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.memory_entries`))[0]?.n ?? 0);
  if (have >= 40) {
    console.log(`  memory_entries: skip (${have})`);
    return;
  }
  const scopes = ['session', 'matter', 'client', 'jurisdictional', 'longterm'];
  const types = ['fact', 'episodic', 'semantic', 'procedural'];
  let n = 0;
  for (let i = have; i < 45; i++) {
    await q(
      `INSERT INTO nv_schema.memory_entries
         (user_id, tenant_id, memory_type, scope, matter_id, session_id, key, value, importance, access_count, created_at)
       VALUES (
         'demo-admin', 'demo-tenant', $1, $2,
         $3, $4, $5,
         $6::jsonb, $7, $8, NOW() - ($9 || ' hours')::interval
       )
       ON CONFLICT DO NOTHING`,
      [
        types[i % types.length],
        scopes[i % scopes.length],
        i % 3 === 0 ? `matter-demo-${(i % 8) + 1}` : null,
        i % 2 === 0 ? `sess-demo-${(i % 12) + 1}` : null,
        `demo-key-${i}`,
        JSON.stringify({ text: `[DEMO] Memory fixture ${i} — India contract clause recall`, source: 'orchestration-showcase' }),
        0.4 + (i % 10) * 0.05,
        i % 20,
        (i * 3.7) % 720,
      ],
    );
    n++;
  }
  console.log(`  memory_entries: inserted ~${n}`);
}

async function seedMem0Memories() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.mem0_memories`))[0]?.n ?? 0);
  if (have >= 25) {
    console.log(`  mem0_memories: skip (${have})`);
    return;
  }
  let n = 0;
  for (let i = have; i < 30; i++) {
    const id = randomUUID();
    const agent = AGENT_KEYS[i % AGENT_KEYS.length];
    await q(
      `INSERT INTO nv_schema.mem0_memories
         (id, agent_id, namespace, type, content, summary, tags, importance, strength, metadata, created_at, last_accessed_at, last_reinforced_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, NOW() - ($11 || ' hours')::interval, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        agent,
        i % 2 === 0 ? 'cam:IN' : 'cam:US',
        i % 3 === 0 ? 'episodic' : 'factual',
        `[DEMO mem0] Agent ${agent} recalled BNSS §103 application pattern (${i})`,
        `Demo CAM memory ${i}`,
        JSON.stringify(['demo', 'orchestration-showcase', 'IN']),
        0.55 + (i % 8) * 0.04,
        0.9,
        JSON.stringify({ demo: true, seededBy: 'orchestration-showcase' }),
        (i * 4.2) % 500,
      ],
    );
    n++;
  }
  console.log(`  mem0_memories: inserted ~${n}`);
}

async function seedDigitalTwins() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.nv_digital_twins WHERE status != 'archived'`))[0]?.n ?? 0);
  if (have >= 3) {
    console.log(`  digital_twins: skip (${have})`);
    return;
  }
  const twins = [
    { id: 'demo-twin-senior-counsel-in', type: 'senior_counsel', entity: 'adv-sharma-demo', name: '[DEMO] Senior Counsel — Delhi HC' },
    { id: 'demo-twin-compliance-officer', type: 'compliance_officer', entity: 'dpo-patel-demo', name: '[DEMO] DPDPA Compliance Officer' },
    { id: 'demo-twin-litigation-strategist', type: 'litigation_strategist', entity: 'lit-iyer-demo', name: '[DEMO] Litigation Strategist — Bombay HC' },
    { id: 'demo-twin-corporate-ma', type: 'corporate_ma', entity: 'corp-khan-demo', name: '[DEMO] M&A Corporate Counsel' },
    { id: 'demo-twin-citizen-helper', type: 'citizen_helper', entity: 'nym-citizen-demo', name: '[DEMO] NYM Citizen Helper' },
  ];
  let n = 0;
  for (const t of twins) {
    const r = await q(
      `INSERT INTO nv_schema.nv_digital_twins (twin_id, organization_id, entity_id, twin_type, status, profile, created_at, updated_at)
       VALUES ($1, '1', $2, $3, 'active', $4::jsonb, NOW(), NOW())
       ON CONFLICT (twin_id) DO NOTHING
       RETURNING twin_id`,
      [t.id, t.entity, t.type, JSON.stringify({ displayName: t.name, demo: true, jurisdiction: 'IN', persona: t.type })],
    );
    if (r.length) n++;
  }
  console.log(`  digital_twins: inserted ${n}`);
}

async function seedAgentChains() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.agent_chains`))[0]?.n ?? 0);
  if (have >= 8) {
    console.log(`  agent_chains: skip (${have})`);
    return;
  }
  const chains = [
    { name: 'BMAD: Contract review — IN demo', description: '[DEMO] Analyst→Architect→Developer→QA', steps: [{ agentKey: 'A-001', role: 'analyst' }, { agentKey: 'A-012', role: 'architect' }, { agentKey: 'A-024', role: 'developer' }, { agentKey: 'A-036', role: 'qa' }] },
    { name: 'BMAD: DPDPA impact assessment', description: '[DEMO] BMAD workflow for DPDPA §10', steps: [{ agentKey: 'A-005', role: 'analyst' }, { agentKey: 'A-018', role: 'architect' }] },
    { name: 'A2A: Queen → specialist handoff', description: '[DEMO] ROMA L5 collaboration chain', steps: [{ agentKey: 'Q-001', role: 'coordinator' }, { agentKey: 'A-042', role: 'specialist' }] },
    { name: 'A2A: Citation verify pipeline', description: '[DEMO] Multi-agent citation pipeline', steps: [{ agentKey: 'A-033', role: 'researcher' }, { agentKey: 'A-044', role: 'verifier' }] },
    { name: 'BMAD Cluster: Cross-border M&A', description: '[DEMO] IN+US cluster', steps: [{ agentKey: 'A-050', role: 'analyst' }, { agentKey: 'A-051', role: 'architect' }, { agentKey: 'A-052', role: 'developer' }] },
  ];
  let n = 0;
  for (const c of chains) {
    const r = await q(
      `INSERT INTO nv_schema.agent_chains (name, description, steps, user_id, tenant_id, created_at)
       SELECT $1, $2, $3::jsonb, 'demo-admin', 'demo-tenant', NOW() - (random() * interval '5 days')
       WHERE NOT EXISTS (SELECT 1 FROM nv_schema.agent_chains WHERE name = $1)
       RETURNING id`,
      [c.name, c.description, JSON.stringify(c.steps)],
    );
    if (r.length) n++;
  }
  console.log(`  agent_chains: inserted ${n}`);
}

async function seedBiasAnalysis() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.bias_analysis_log`))[0]?.n ?? 0);
  if (have >= 15) {
    console.log(`  bias_analysis_log: skip (${have})`);
    return;
  }
  let n = 0;
  for (let i = have; i < 20; i++) {
    await q(
      `INSERT INTO nv_schema.bias_analysis_log
         (agent_key, session_id, composite_score, overall_severity, flagged, dimension_scores, signal_count, analysed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW() - ($8 || ' hours')::interval)`,
      [
        AGENT_KEYS[i % AGENT_KEYS.length],
        `demo-cam-sess-${i}`,
        0.72 + (i % 10) * 0.02,
        i % 7 === 0 ? 'high' : 'medium',
        i % 9 === 0,
        JSON.stringify([{ dimension: 'jurisdiction_parity', score: 0.88 }, { dimension: 'protected_attr', score: 0.91 }]),
        2 + (i % 4),
        (i * 5.5) % 720,
      ],
    );
    n++;
  }
  console.log(`  bias_analysis_log: inserted ~${n}`);
}

async function seedDataLineage() {
  const have = Number((await q(`SELECT COUNT(*)::int AS n FROM nv_schema.data_lineage_events WHERE created_at > NOW() - interval '7 days'`))[0]?.n ?? 0);
  if (have >= 30) {
    console.log(`  data_lineage_events: skip (${have})`);
    return;
  }
  let n = 0;
  for (let i = have; i < 35; i++) {
    const reqId = `demo-lin-${String(i).padStart(4, '0')}`;
    const [prov, model] = MODELS[i % MODELS.length];
    await q(
      `INSERT INTO nv_schema.data_lineage_events
         (request_id, user_id, org_id, agent_key, model_used, provider, input_hash, output_hash,
          rag_sources, pii_detected, latency_ms, compliance_flags, created_at)
       VALUES ($1, 'demo-admin', '1', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, NOW() - ($11 || ' hours')::interval)`,
      [
        reqId,
        AGENT_KEYS[i % AGENT_KEYS.length],
        model,
        prov,
        `sha256:demo-in-${i}`,
        `sha256:demo-out-${i}`,
        JSON.stringify([{ source: 'demo-statute-corpus', id: `BNSS-${100 + i}` }]),
        i % 8 === 0 ? JSON.stringify(['AADHAAR']) : JSON.stringify([]),
        380 + (i % 50) * 22,
        JSON.stringify(['grounded', 'citation_verified']),
        (i * 3.1) % 168,
      ],
    );
    n++;
  }
  console.log(`  data_lineage_events: inserted ~${n}`);
}

function runTsxSeed(script, optional = true) {
  console.log(`\n>> tsx ${script}`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, script)], {
    cwd: ROOT,
    env: { ...process.env, NV_E2E_BYPASS: '1', DATABASE_URL: conn, NYV_DATABASE_URL: conn },
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    const msg = `WARN: ${script} exit ${r.status}`;
    if (optional) console.warn(msg);
    else throw new Error(msg);
  }
}

async function main() {
  console.log('orchestration-showcase-seed start');
  const before = await snapshot('BEFORE');

  await seedAgentMetrics();
  await seedRouterDecisions();
  await seedMemoryEntries();
  await seedMem0Memories();
  await seedDigitalTwins();
  await seedAgentChains();
  await seedBiasAnalysis();
  await seedDataLineage();

  runTsxSeed('scripts/nv-seed-activity-and-hitl.ts');
  runTsxSeed('scripts/nv-seed-grpo-demo.ts');
  runTsxSeed('scripts/nv-seed-policies.ts');

  const after = await snapshot('AFTER');

  console.log('\n=== TAB DELTA (approx) ===');
  const tabMap = {
    overview: ['agent_metrics_24h', 'memory_entries'],
    live: ['ai_activity_7d'],
    router: ['router_decisions_7d'],
    memory: ['memory_entries', 'mem0_memories'],
    'digital-twin': ['digital_twins'],
    'cam-telemetry': ['router_decisions_7d', 'agent_metrics_24h'],
    a2a: ['agent_chains'],
    bmad: ['agent_chains'],
    grpo: ['grpo_runs', 'grpo_episodes', 'ai_feedback'],
    policies: ['policies_active'],
    trace: ['data_lineage_7d'],
  };
  for (const [tab, keys] of Object.entries(tabMap)) {
    const parts = keys.map((k) => `${k}:${before[k] ?? '?'}→${after[k] ?? '?'}`);
    console.log(`${tab}: ${parts.join(', ')}`);
  }

  console.log('\norchestration-showcase-seed done');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
