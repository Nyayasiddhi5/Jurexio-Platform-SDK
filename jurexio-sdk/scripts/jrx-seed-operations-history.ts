/**
 * jrx-seed-operations-history.ts (2026-05-13)
 *
 * Seeds realistic operational history so the Operations Hub shows real
 * Jurexio-ecosystem (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) activity:
 *   - nv_orchestration_jobs        (~280 jobs over last 14 days)
 *   - nv_sdk_usage_metrics         (~720 SDK calls over last 7 days)
 *   - nv_audit_logs                (~220 audit events)
 * Idempotent: re-running tops up totals to the target floor.
 * NV-DB-SCRIPT-001 compliant.
 */
import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_orchestration_jobs': [
    'id', 'type', 'status', 'agent_id', 'input', 'output', 'error',
    'started_at', 'completed_at', 'app_id', 'created_at',
  ],
  'public.nv_sdk_usage_metrics': [
    'app_id', 'endpoint', 'method', 'status_code', 'latency_ms',
    'tokens_in', 'tokens_out', 'cost_usd', 'agent_id', 'recorded_at',
  ],
  'public.nv_audit_logs': [
    'action', 'metadata', 'created_at', 'resource_type', 'resource_id',
  ],
} as const;

type Sql = ReturnType<typeof makePgSql>;

const PLATFORMS = ['NSP', 'NSPM', 'NSI', 'NSA', 'NSM', 'NYM', 'JRX'] as const;
const JURISDICTIONS = ['IN', 'US', 'UK', 'EU', 'SG', 'GC'] as const;
const ENDPOINTS = [
  '/api/jrx/intelligence/classify', '/api/jrx/intelligence/research', '/api/jrx/intelligence/predict',
  '/api/jrx/intelligence/translate', '/api/jrx/intelligence/sentiment', '/api/jrx/orchestrate',
  '/api/jrx/agents/execute', '/api/jrx/sdk/docs-pipeline/parse', '/api/jrx/sdk/docs-pipeline/summarize',
  '/api/jrx/ai/chat', '/api/jrx/jrx/triage', '/api/jrx/nym/answer',
];
const MODELS = [
  { id: 'gpt-4.1',           provider: 'openai',     priceIn: 2.0, priceOut: 8.0 },
  { id: 'claude-sonnet-4-6', provider: 'anthropic',  priceIn: 3.0, priceOut: 15.0 },
  { id: 'gemini-2.5-flash',  provider: 'google',     priceIn: 0.075, priceOut: 0.30 },
  { id: 'gemini-2.5-pro',    provider: 'google',     priceIn: 1.25, priceOut: 5.0 },
  { id: 'sarvam-m',          provider: 'sarvam',     priceIn: 0.20, priceOut: 0.80 },
  { id: 'llama-4-scout',     provider: 'openrouter', priceIn: 0.18, priceOut: 0.55 },
];
const AGENT_KINDS = [
  'contract-analyst', 'compliance-reviewer', 'litigation-strategist', 'precedent-researcher',
  'pii-redactor', 'translator', 'tax-advisor', 'corporate-secretary', 'data-protection-officer',
  'arbitration-specialist', 'patent-examiner', 'consumer-rights-advisor', 'criminal-defence-aide',
];
const TASK_KINDS = ['classification', 'research', 'drafting', 'translation', 'summarisation', 'orchestration'];

function pick<T>(a: readonly T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function rand(min: number, max: number) { return Math.floor(min + Math.random() * (max - min)); }

async function ensureFloor(sql: Sql, table: string, floor: number, lookbackHours = 24 * 14, tsCol = 'created_at'): Promise<number> {
  const r = await sql([`SELECT COUNT(*)::int AS c FROM ${table} WHERE ${tsCol} >= NOW() - INTERVAL '${lookbackHours} hours'`]);
  return Math.max(0, floor - Number((r as any)[0]?.c ?? 0));
}

async function seedOrchestrationJobs(sql: Sql, agentIds: string[], appIds: string[]) {
  const need = await ensureFloor(sql, 'nv_orchestration_jobs', 280, 24 * 14);
  if (need === 0) { console.log('[ops-history] orchestration_jobs already at floor'); return 0; }
  let inserted = 0;
  const now = Date.now();
  for (let i = 0; i < need; i++) {
    const ageMs = Math.floor(Math.random() * 14 * 24 * 3600 * 1000);
    const startedAt = new Date(now - ageMs).toISOString();
    const durMs = rand(1500, 28_000);
    const completedAt = new Date(now - ageMs + durMs).toISOString();
    const isErr = Math.random() < 0.06; // ~6% error rate
    const status = isErr ? 'failed' : 'completed';
    const taskKind = pick(TASK_KINDS);
    const agentId = pick(agentIds);
    const appId = pick(appIds);
    const platform = pick(PLATFORMS);
    const jurisdiction = pick(JURISDICTIONS);
    const id = `oj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${i}`;
    await sql`
      INSERT INTO nv_orchestration_jobs (
        id, type, status, agent_id, input, output, error,
        started_at, completed_at, app_id, created_at
      ) VALUES (
        ${id},
        ${taskKind},
        ${status},
        ${agentId},
        ${JSON.stringify({ platform, jurisdiction, hint: `${taskKind}@${platform}` })}::jsonb,
        ${isErr ? null : JSON.stringify({ tokens: rand(200, 4000), citations: rand(0, 6), confidence: (0.7 + Math.random() * 0.3).toFixed(3) })}::jsonb,
        ${isErr ? `${pick(['provider_timeout', 'rate_limited', 'guardrail_block', 'invalid_input'])}: ${pick(MODELS).id}` : null},
        ${startedAt},
        ${completedAt},
        ${appId},
        ${startedAt}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    inserted++;
  }
  console.log(`[ops-history] orchestration_jobs inserted=${inserted}`);
  return inserted;
}

async function seedSdkUsage(sql: Sql, appIds: string[], agentIds: string[]) {
  const need = await ensureFloor(sql, 'nv_sdk_usage_metrics', 720, 24 * 7, 'recorded_at');
  if (need === 0) { console.log('[ops-history] sdk_usage_metrics already at floor'); return 0; }
  let inserted = 0;
  const now = Date.now();
  for (let i = 0; i < need; i++) {
    const ageMs = Math.floor(Math.random() * 7 * 24 * 3600 * 1000);
    const recordedAt = new Date(now - ageMs).toISOString();
    const m = pick(MODELS);
    const tokIn = rand(180, 3800);
    const tokOut = rand(60, 1800);
    const cost = (tokIn / 1000) * (m.priceIn / 1000) + (tokOut / 1000) * (m.priceOut / 1000);
    const isErr = Math.random() < 0.04;
    const status = isErr ? pick([429, 500, 502, 504]) : 200;
    const lat = isErr ? rand(8000, 25_000) : rand(180, 4200);
    await sql`
      INSERT INTO nv_sdk_usage_metrics (
        app_id, endpoint, method, status_code, latency_ms,
        tokens_in, tokens_out, cost_usd, agent_id, recorded_at
      ) VALUES (
        ${pick(appIds)}, ${pick(ENDPOINTS)}, ${'POST'}, ${status}, ${lat},
        ${tokIn}, ${tokOut}, ${cost.toFixed(6)}, ${pick(agentIds)}, ${recordedAt}
      )
    `;
    inserted++;
  }
  console.log(`[ops-history] sdk_usage_metrics inserted=${inserted}`);
  return inserted;
}

async function seedAuditLogs(sql: Sql) {
  const need = await ensureFloor(sql, 'nv_audit_logs', 220, 24 * 14);
  if (need === 0) { console.log('[ops-history] audit_logs already at floor'); return 0; }
  const ACTIONS = [
    'sdk.key.rotated', 'agent.execute', 'orchestration.start', 'orchestration.complete',
    'compliance.assessment.run', 'policy.assigned', 'hitl.decision.approved', 'hitl.decision.rejected',
    'regulatory.feed.ingested', 'rag.collection.indexed', 'pii.detection.flagged', 'auth.login.success',
    'auth.login.failed', 'governance.framework.published',
  ];
  let inserted = 0;
  const now = Date.now();
  for (let i = 0; i < need; i++) {
    const ageMs = Math.floor(Math.random() * 14 * 24 * 3600 * 1000);
    const ts = new Date(now - ageMs).toISOString();
    const action = pick(ACTIONS);
    const platform = pick(PLATFORMS);
    const jurisdiction = pick(JURISDICTIONS);
    await sql`
      INSERT INTO nv_audit_logs (
        action, metadata, created_at, resource_type, resource_id
      ) VALUES (
        ${action},
        ${JSON.stringify({ platform, jurisdiction, source: 'jurexio-ops-history', actor: 'system', org_id: pick([1, 2, 3, 4]) })}::jsonb,
        ${ts},
        ${action.split('.')[0]},
        ${`${action}_${i}`}
      )
    `;
    inserted++;
  }
  console.log(`[ops-history] audit_logs inserted=${inserted}`);
  return inserted;
}

async function main() {
  if (!process.env.DATABASE_URL && process.env.JRX_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.JRX_DATABASE_URL;
  }
  const sql = makePgSql();
  console.log('[ops-history] starting');
  await assertColumns(sql, './jrx-seed-operations-history', REQUIRED_COLUMNS);

  // Resolve agents + apps
  const agents = (await sql`SELECT agent_id FROM legal_agents WHERE is_enabled = true LIMIT 60`) as Array<{ agent_id: string }>;
  const agentIds = agents.map(a => a.agent_id).filter(Boolean);
  if (agentIds.length === 0) {
    AGENT_KINDS.forEach(k => agentIds.push(`fallback-${k}`));
  }

  const apps = (await sql`SELECT id FROM nv_sdk_applications LIMIT 30`) as Array<{ id: string }>;
  const appIds = apps.map(a => a.id).filter(Boolean);
  if (appIds.length === 0) {
    appIds.push(...['app-nsp-replit', 'app-nspm-replit', 'app-nsi-replit', 'app-nsa-replit', 'app-nsm-replit', 'app-nym-replit', 'app-jrx-replit']);
  }

  await seedOrchestrationJobs(sql, agentIds, appIds);
  await seedSdkUsage(sql, appIds, agentIds);
  await seedAuditLogs(sql);

  await sql.end();
  console.log('[ops-history] done');
}

main().catch(e => { console.error('[ops-history] FAIL', e); process.exit(1); });
