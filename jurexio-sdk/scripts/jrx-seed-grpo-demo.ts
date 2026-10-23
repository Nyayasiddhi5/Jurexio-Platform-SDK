/**
 * Demo G1B — GRPO Training seed (task #335, 2026-05-13).
 *
 * Populates the data sources read by the /orchestration/grpo-training page:
 *   nv_schema.nv_grpo_runs                  — ≥ 3 sample runs
 *   nv_schema.nv_grpo_policy_snapshots      — referenced by /api/jrx/governance/orchestration/policies
 *   nv_schema.ai_feedback                   — ≥ 30 feedback rows so the leaderboard
 *                                             (getTopPerformingAgents) returns non-empty
 *   nv_schema.agent_learning_sessions       — ≥ 5 GRPO suggestions (jsonb suggestions[])
 *
 * Idempotent: re-running tops up to the floor; existing rows preserved.
 *
 * NV-DB-SCRIPT-001: makePgSql shim, not the neon HTTP driver.
 * NV-NAMING-001: jrx-* prefix. Standalone, not auto-mounted in production.
 *
 * Dev-only guard: refuses to run when NODE_ENV === 'production' unless
 * NV_E2E_BYPASS=1 is set (matches NV-UAT-DEFAULT-ORG-001 gating).
 */
import { randomUUID } from 'crypto';
import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

const isProd = process.env.NODE_ENV === 'production';
const bypass = process.env.NV_E2E_BYPASS === '1';
if (isProd && !bypass) {
  console.log('[jrx-seed-grpo-demo] skipped — NODE_ENV=production and NV_E2E_BYPASS!=1');
  process.exit(0);
}

const sql = makePgSql(process.env.JRX_DATABASE_URL ?? process.env.DATABASE_URL!);

const TARGET_RUNS = 3;
const TARGET_FEEDBACK = 30;
const TARGET_SUGGESTIONS = 5;
const TARGET_SNAPSHOTS = 3;

const AGENTS = [
  { key: 'nsp-contract-analyst',     route: '/api/jrx/gateway/documents/analyze',   pattern: 'analysis' },
  { key: 'nspm-matter-coordinator',  route: '/api/jrx/orchestrate',                  pattern: 'orchestration' },
  { key: 'jrx-judicial-research',    route: '/api/jrx/gateway/research/query',       pattern: 'research' },
  { key: 'nsm-policy-analyst',       route: '/api/jrx/intelligence/classify',        pattern: 'classification' },
  { key: 'nym-citizen-helper',       route: '/api/jrx/intelligence/summarize',       pattern: 'summarisation' },
] as const;

const JURISDICTIONS = ['US', 'IN'] as const;

async function ensureTables(): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS nv_schema`;

  await sql`
    CREATE TABLE IF NOT EXISTS nv_schema.nv_grpo_runs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_key     TEXT,
      route           TEXT,
      agent_id        TEXT,
      jurisdiction    TEXT,
      task_hash       TEXT,
      response_snippet TEXT,
      reward          NUMERIC(6,4) DEFAULT 0,
      policy_updated  BOOLEAN DEFAULT FALSE,
      total_episodes  INT DEFAULT 0,
      avg_reward      NUMERIC(6,4) DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // task #335: align fresh-environment shape with the live dev/prod schema
  // so a brand-new DB doesn't get a CREATE-IF-NOT-EXISTS table whose columns
  // disagree with the INSERT below. Both tables are owned by Drizzle
  // migrations in real life — the CREATE here is a last-resort safety net
  // for greenfield local dev.
  await sql`
    CREATE TABLE IF NOT EXISTS nv_schema.nv_grpo_policy_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_snapshot JSONB DEFAULT '{}'::jsonb,
      update_count    INT DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS nv_schema.ai_feedback (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         TEXT,
      tenant_id       TEXT,
      request_id      TEXT,
      agent_key       TEXT,
      rating          INT,
      thumbs          TEXT,
      comment         TEXT,
      response_snippet TEXT,
      tags            JSONB DEFAULT '[]'::jsonb,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS nv_schema.agent_learning_sessions (
      id                     SERIAL PRIMARY KEY,
      agent_key              TEXT NOT NULL DEFAULT '',
      feedback_sample_count  INT DEFAULT 0,
      suggestions            JSONB DEFAULT '[]'::jsonb,
      approved               BOOLEAN DEFAULT FALSE,
      applied_at             TIMESTAMPTZ,
      created_at             TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/**
 * task #346: guard against silent schema drift.
 *
 * The `CREATE TABLE IF NOT EXISTS` block above is a greenfield-dev safety
 * net only — in real environments these tables are owned by Drizzle
 * migrations and the CREATE is a no-op. That means if the live table shape
 * diverges from what the INSERTs below assume, the seeder used to blow up
 * mid-run with a column-not-found error (see task #335 fallout for
 * `nv_grpo_policy_snapshots` and `ai_feedback`).
 *
 * `assertColumns` reads `information_schema.columns` for each target table
 * and verifies every column the INSERTs reference actually exists. Missing
 * columns produce a single, clear error listing the table and the absent
 * names — fail-loud, not fail-silent.
 */
const REQUIRED_COLUMNS = {
  'nv_schema.nv_grpo_runs': [
    'pattern_key', 'route', 'agent_id', 'jurisdiction', 'task_hash',
    'response_snippet', 'reward', 'policy_updated', 'total_episodes', 'avg_reward',
  ],
  'nv_schema.nv_grpo_policy_snapshots': ['policy_snapshot', 'update_count'],
  'nv_schema.ai_feedback': [
    'user_id', 'tenant_id', 'request_id', 'agent_key', 'rating', 'thumbs',
    'comment', 'response_snippet', 'tags',
  ],
  'nv_schema.agent_learning_sessions': [
    'agent_key', 'feedback_sample_count', 'suggestions', 'approved',
  ],
} as const;

async function countRuns(): Promise<number> {
  const r: any[] = await sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_grpo_runs`;
  return Number(r?.[0]?.c ?? 0);
}
async function countSnapshots(): Promise<number> {
  const r: any[] = await sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_grpo_policy_snapshots`;
  return Number(r?.[0]?.c ?? 0);
}
async function countFeedback(): Promise<number> {
  const r: any[] = await sql`SELECT COUNT(*)::int AS c FROM nv_schema.ai_feedback`;
  return Number(r?.[0]?.c ?? 0);
}
async function countSuggestions(): Promise<number> {
  const r: any[] = await sql`SELECT COUNT(*)::int AS c FROM nv_schema.agent_learning_sessions`;
  return Number(r?.[0]?.c ?? 0);
}

async function seedRuns(): Promise<number> {
  const have = await countRuns();
  let inserted = 0;
  for (let i = have; i < TARGET_RUNS * AGENTS.length; i++) {
    const agent = AGENTS[i % AGENTS.length];
    const jur = JURISDICTIONS[i % JURISDICTIONS.length];
    const reward = 0.55 + ((i * 7) % 35) / 100; // 0.55..0.90
    const episodes = 25 + (i % 50);
    const avg = 0.45 + ((i * 11) % 40) / 100;
    const taskHash = `task_${randomUUID().slice(0, 12)}`;
    const snippet = `Episode ${i + 1}: agent ${agent.key} produced a ${reward >= 0.75 ? 'high' : 'medium'}-reward response.`;
    await sql`
      INSERT INTO nv_schema.nv_grpo_runs
        (pattern_key, route, agent_id, jurisdiction, task_hash, response_snippet,
         reward, policy_updated, total_episodes, avg_reward)
      VALUES
        (${agent.pattern}, ${agent.route}, ${agent.key}, ${jur}, ${taskHash}, ${snippet},
         ${reward}, ${i % 4 === 0}, ${episodes}, ${avg})
    `;
    inserted++;
  }
  return inserted;
}

async function seedSnapshots(): Promise<number> {
  const have = await countSnapshots();
  let inserted = 0;
  for (let i = have; i < TARGET_SNAPSHOTS * AGENTS.length; i++) {
    const agent = AGENTS[i % AGENTS.length];
    const version = 1 + Math.floor(i / AGENTS.length);
    const avg = 0.6 + ((i * 13) % 30) / 100;
    const episodes = 100 + (i * 17) % 250;
    const params = JSON.stringify({
      learningRate: 0.0001,
      kl_coef: 0.02,
      group_size: 8,
      tempBoost: ((i % 3) + 1) * 0.05,
    });
    const notes = `Auto-generated snapshot v${version} for ${agent.key}`;
    // task #335: real table is (id, policy_snapshot, update_count, created_at).
    // Pack all the demo metadata into the policy_snapshot jsonb blob.
    const snap = JSON.stringify({
      pattern_key: agent.pattern, agent_id: agent.key, version,
      params: JSON.parse(params), avg_reward: avg, total_episodes: episodes, notes,
    });
    await sql`
      INSERT INTO nv_schema.nv_grpo_policy_snapshots (policy_snapshot, update_count)
      VALUES (${snap}::jsonb, ${version})
    `;
    inserted++;
  }
  return inserted;
}

async function seedFeedback(): Promise<number> {
  const have = await countFeedback();
  let inserted = 0;
  for (let i = have; i < TARGET_FEEDBACK * AGENTS.length; i++) {
    const agent = AGENTS[i % AGENTS.length];
    // Mostly positive (rating 4-5), a few mixed (1-3) so the leaderboard
    // shows realistic variance across agents.
    const rating = (i % 7 === 0) ? 2 : (i % 5 === 0) ? 3 : (i % 3 === 0) ? 4 : 5;
    const thumbs = rating >= 4 ? 'up' : rating <= 2 ? 'down' : null;
    const response = `Sample response from ${agent.key}: legal answer text…`;
    const tags = JSON.stringify(rating <= 3 ? ['needs-improvement'] : ['accurate']);
    // task #335: real ai_feedback shape (no query/response columns).
    await sql`
      INSERT INTO nv_schema.ai_feedback
        (user_id, tenant_id, request_id, agent_key, rating, thumbs, comment, response_snippet, tags)
      VALUES
        (${`demo-user-${i % 9}`}, ${`org-demo-${i % 4}`}, ${`req_demo_${randomUUID().slice(0, 10)}`},
         ${agent.key}, ${rating}, ${thumbs}, ${rating <= 2 ? 'Could be more precise' : null},
         ${response.slice(0, 200)}, ${tags}::jsonb)
    `;
    inserted++;
  }
  return inserted;
}

async function seedSuggestions(): Promise<number> {
  const have = await countSuggestions();
  let inserted = 0;
  for (let i = have; i < TARGET_SUGGESTIONS * AGENTS.length; i++) {
    const agent = AGENTS[i % AGENTS.length];
    const suggestions = [
      { id: randomUUID(), kind: 'system_prompt', summary: `Tighten citation requirement for ${agent.key}`, confidence: 0.82, sample_count: 14 },
      { id: randomUUID(), kind: 'temperature',   summary: `Reduce temperature 0.7 → 0.4 for deterministic ${agent.pattern} tasks`, confidence: 0.71, sample_count: 11 },
      { id: randomUUID(), kind: 'few_shot',      summary: `Add 2 high-rated exemplars to ${agent.key} few-shot pool`,             confidence: 0.66, sample_count: 9 },
    ];
    await sql`
      INSERT INTO nv_schema.agent_learning_sessions
        (agent_key, feedback_sample_count, suggestions, approved)
      VALUES
        (${agent.key}, ${30 + (i % 25)}, ${JSON.stringify(suggestions)}::jsonb, ${i % 4 === 0})
    `;
    inserted++;
  }
  return inserted;
}

async function main(): Promise<void> {
  console.log('▶ Demo G1B — seeding GRPO training tables');
  await ensureTables();
  console.log('  ✓ tables ensured');
  await assertColumns(sql, './jrx-seed-grpo-demo', REQUIRED_COLUMNS);
  console.log('  ✓ schema columns asserted (no drift)');

  const r1 = await seedRuns();
  const r2 = await seedSnapshots();
  const r3 = await seedFeedback();
  const r4 = await seedSuggestions();

  console.log(`  ✓ nv_grpo_runs:                +${r1}`);
  console.log(`  ✓ nv_grpo_policy_snapshots:    +${r2}`);
  console.log(`  ✓ ai_feedback:                 +${r3}`);
  console.log(`  ✓ agent_learning_sessions:     +${r4}`);

  const totals = {
    runs:        await countRuns(),
    snapshots:   await countSnapshots(),
    feedback:    await countFeedback(),
    suggestions: await countSuggestions(),
  };
  console.log('  Final totals:', totals);

  await sql.end();
  console.log('✅ done');
}

main().catch(async (e) => {
  console.error('FATAL', e);
  try { await sql.end(); } catch { /* ignore */ }
  process.exit(1);
});
