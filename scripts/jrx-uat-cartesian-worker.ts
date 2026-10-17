// @ts-nocheck
/**
 * nv-uat-cartesian-worker.ts (N6, 2026-05-09)
 * ─────────────────────────────────────────────────────────────────────────────
 * BullMQ-backed cartesian UAT runner. Designed for the full-10k matrix
 * (60 scenarios × 7 jurisdictions × 4 CoT × 6 providers + 8 free-models × 60).
 *
 * USAGE
 *   # Producer (enqueues N jobs, returns immediately):
 *   npx tsx scripts/jrx-uat-cartesian-worker.ts produce \
 *     --providers=anthropic,openai,google,openrouter,sarvam,bedrock,agentzero \
 *     --jurisdictions=IN,US,UK,EU,SG,GC \
 *     --cots=zero_shot,few_shot,react,tot \
 *     --inject=none
 *
 *   # Worker (long-running consumer, can run in parallel on N machines):
 *   npx tsx scripts/jrx-uat-cartesian-worker.ts work --concurrency=8
 *
 *   # Drain (waits for queue empty, writes consolidated ledger):
 *   npx tsx scripts/jrx-uat-cartesian-worker.ts drain --out=audit/uat-cartesian-FULL.json
 *
 * WHY BULLMQ NOT BASH-WRAPPED RUNNER
 *   The bash tool wrapping in this Repl truncates at 115s, killing any
 *   foreground runner before the matrix completes. BullMQ persists jobs to
 *   Redis (NYV_REDIS_TCP_URL — already configured) so a producer-worker
 *   split can survive arbitrary tool restarts and parallelize across
 *   multiple worker processes.
 *
 * NOT EXECUTED IN THIS SESSION — 4-6 hr wall-clock + ~$40 LLM cost.
 * Code is shipped; user runs it in a dedicated session with budget.
 */

import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = process.env.NYV_GATEWAY_URL || 'http://localhost:5000';
const REDIS_URL = process.env.NYV_REDIS_TCP_URL || process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error('[uat-cart-worker] NYV_REDIS_TCP_URL is required');
  process.exit(2);
}
const QUEUE_NAME = './jrx-uat-cartesian';

// Reuse the runner's expectation evaluator
async function loadEvaluator() {
  const m = await import('./jrx-uat-real-world.js').catch(() => null);
  return m;
}

interface CartesianJobData {
  scenarioId: string;
  jurisdiction: string;
  category: string;
  scenarioPath: string;
  provider: string;
  cot: string;
  inject: string;
  freeModel?: string;
}

interface CartesianJobResult {
  scenarioId: string;
  status: 'pass' | 'fail' | 'error';
  httpStatus: number;
  latencyMs: number;
  failures: string[];
  costUsd: number;
  tokensTotal: number;
}

function parseConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

function loadAllScenarios(): { file: string; jurisdiction: string; category: string; scenarios: any[] }[] {
  const root = join(process.cwd(), 'tests/uat/scenarios');
  const out: any[] = [];
  for (const jur of readdirSync(root)) {
    const jurDir = join(root, jur);
    try {
      for (const f of readdirSync(jurDir)) {
        if (!f.endsWith('.json')) continue;
        const full = join(jurDir, f);
        const d = JSON.parse(readFileSync(full, 'utf8'));
        out.push({
          file: full,
          jurisdiction: d.jurisdiction || jur,
          category: d.category || f.replace('.json',''),
          scenarios: d.scenarios || [],
        });
      }
    } catch {}
  }
  return out;
}

async function produce(args: Record<string,string>) {
  const providers = (args.providers || 'anthropic,openai,google,openrouter,sarvam,bedrock,agentzero').split(',');
  const jurisdictions = new Set((args.jurisdictions || 'IN,US,UK,EU,SG,GC').split(','));
  const cots = (args.cots || 'zero_shot,few_shot,react,tot').split(',');
  const inject = args.inject || 'none';
  const freeModels = args.freeModels ? args.freeModels.split(',') : [];
  const conn = parseConnection();
  const queue = new Queue<CartesianJobData>(QUEUE_NAME, { connection: conn });

  const all = loadAllScenarios();
  let enqueued = 0;
  for (const file of all) {
    if (!jurisdictions.has(file.jurisdiction)) continue;
    for (const scen of file.scenarios) {
      for (const p of providers) {
        for (const c of cots) {
          await queue.add('cell', {
            scenarioId: scen.id,
            jurisdiction: file.jurisdiction,
            category: file.category,
            scenarioPath: file.file,
            provider: p,
            cot: c,
            inject,
          }, { removeOnComplete: false, removeOnFail: false, attempts: 2 });
          enqueued++;
        }
      }
      for (const fm of freeModels) {
        await queue.add('cell', {
          scenarioId: scen.id,
          jurisdiction: file.jurisdiction,
          category: file.category,
          scenarioPath: file.file,
          provider: 'openrouter',
          cot: 'zero_shot',
          inject,
          freeModel: fm,
        }, { removeOnComplete: false, removeOnFail: false, attempts: 2 });
        enqueued++;
      }
    }
  }
  console.log(`[uat-cart-worker] enqueued ${enqueued} cells. Run with: nv-uat-cartesian-worker.ts work`);
  await queue.close();
}

async function executeCell(d: CartesianJobData): Promise<CartesianJobResult> {
  const file = JSON.parse(readFileSync(d.scenarioPath, 'utf8'));
  const scen = (file.scenarios || []).find((s: any) => s.id === d.scenarioId);
  if (!scen) throw new Error(`scenario not found: ${d.scenarioId}`);
  const url = new URL(scen.request.path, BASE);
  const headers: Record<string,string> = {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NYV_SDK_KEY_NSP || '',
    'X-NYV-UAT-Provider': d.provider,
    'X-NYV-UAT-CoT': d.cot,
    'X-NYV-UAT-Inject': d.inject,
  };
  if (d.freeModel) headers['X-NYV-UAT-Model'] = d.freeModel;
  const init: any = { method: scen.request.method, headers };
  if (scen.request.method !== 'GET' && scen.request.body !== undefined) {
    init.body = JSON.stringify(scen.request.body);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), scen.expected.timeoutMs || 60_000);
  init.signal = ac.signal;
  const t0 = Date.now();
  let httpStatus = 0, bodyText = '', bodyJson: any = null, error: string | undefined;
  try {
    const res = await fetch(url.toString(), init);
    httpStatus = res.status;
    bodyText = await res.text();
    try { bodyJson = JSON.parse(bodyText); } catch {}
  } catch (e: any) {
    error = e?.message || String(e);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;

  const failures: string[] = [];
  const want = scen.expected.httpStatus;
  if (want !== undefined) {
    const ok = Array.isArray(want) ? want.includes(httpStatus) : httpStatus === want;
    if (!ok) failures.push(`http_status:${httpStatus}!=${JSON.stringify(want)}`);
  }
  const hay = (bodyText || '').toLowerCase();
  for (const s of scen.expected.mustContainText || []) {
    if (!hay.includes(s.toLowerCase())) failures.push(`missing_text:${s}`);
  }
  if (scen.expected.mustContainAnyOf) {
    const hits = scen.expected.mustContainAnyOf.filter((s: string) => hay.includes(s.toLowerCase()));
    if (hits.length === 0) failures.push(`missing_any_of:${scen.expected.mustContainAnyOf.length}`);
  }
  if (scen.expected.mustContainAtLeast) {
    const hits = scen.expected.mustContainAtLeast.of.filter((s: string) => hay.includes(s.toLowerCase()));
    if (hits.length < scen.expected.mustContainAtLeast.count) {
      failures.push(`at_least_${scen.expected.mustContainAtLeast.count}_of_${scen.expected.mustContainAtLeast.of.length}_only_${hits.length}`);
    }
  }
  return {
    scenarioId: d.scenarioId,
    status: error ? 'error' : (failures.length ? 'fail' : 'pass'),
    httpStatus,
    latencyMs,
    failures,
    costUsd: bodyJson?.data?.cost?.usd || 0,
    tokensTotal: bodyJson?.data?.tokens?.total || 0,
  };
}

async function work(args: Record<string,string>) {
  const conn = parseConnection();
  const concurrency = Number(args.concurrency || 8);
  const w = new Worker<CartesianJobData, CartesianJobResult>(QUEUE_NAME, async (job: Job<CartesianJobData>) => {
    return await executeCell(job.data);
  }, { connection: conn, concurrency });
  w.on('completed', (job, r) => {
    console.log(`[done] ${r.status} ${job.data.scenarioId} ${job.data.provider}/${job.data.cot} http=${r.httpStatus} ${r.latencyMs}ms`);
  });
  w.on('failed', (job, e) => {
    console.error(`[fail] ${job?.data?.scenarioId} ${job?.data?.provider}: ${e?.message}`);
  });
  console.log(`[uat-cart-worker] worker started (concurrency=${concurrency}). Ctrl-C to stop.`);
}

async function drain(args: Record<string,string>) {
  const conn = parseConnection();
  const queue = new Queue(QUEUE_NAME, { connection: conn });
  const events = new QueueEvents(QUEUE_NAME, { connection: conn });
  const out = args.out || `audit/uat-cartesian-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  mkdirSync(dirname(out), { recursive: true });

  while (true) {
    const counts = await queue.getJobCounts();
    if ((counts.waiting || 0) === 0 && (counts.active || 0) === 0) break;
    console.log(`[drain] waiting=${counts.waiting} active=${counts.active} completed=${counts.completed} failed=${counts.failed}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  const completed = await queue.getJobs(['completed'], 0, 50000);
  const failed = await queue.getJobs(['failed'], 0, 50000);
  const results = [
    ...completed.map(j => ({ data: j.data, result: j.returnvalue })),
    ...failed.map(j => ({ data: j.data, error: j.failedReason })),
  ];
  const summary = {
    total: results.length,
    pass: results.filter((r: any) => r.result?.status === 'pass').length,
    fail: results.filter((r: any) => r.result?.status === 'fail').length,
    error: results.filter((r: any) => r.error || r.result?.status === 'error').length,
    totalCostUsd: results.reduce((s: number, r: any) => s + (r.result?.costUsd || 0), 0),
    totalTokens: results.reduce((s: number, r: any) => s + (r.result?.tokensTotal || 0), 0),
  };
  writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  console.log(`[drain] wrote ${out}`);
  console.log(JSON.stringify(summary, null, 2));
  await events.close();
  await queue.close();
}

function parseArgs(argv: string[]): Record<string,string> {
  const out: Record<string,string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
(async () => {
  if (cmd === 'produce') await produce(args);
  else if (cmd === 'work') { await work(args); await new Promise(()=>{}); }
  else if (cmd === 'drain') await drain(args);
  else {
    console.error('usage: nv-uat-cartesian-worker.ts {produce|work|drain} [--key=val ...]');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
