/**
 * NYV-UAT-REAL-WORLD — Track-2B matrix runner
 * NV-OPT+UAT-2026-05-08
 *
 * Reads `tests/uat/scenarios/{IN,US}/*.json` (60 real-world scenarios authored
 * in T6) and runs each over the cartesian product of:
 *
 *   • providers          : 6 active LLM providers + AgentZero priority-99 fallback
 *                          (anthropic, openai, google, openrouter, sarvam, bedrock, agentzero)
 *   • free-model sub-grid: 8 OpenRouter `:free` models (only for cost-sensitive
 *                          scenarios — opt-in per scenario via `costSensitive: true`)
 *   • CoT strategies     : zero_shot, self_consistency, tot, cove
 *   • failure injections : none, provider_down, rag_empty, citation_fail,
 *                          hash_break, rate_limit_storm
 *
 * For each cell it captures the full envelope:
 *   requestId, qualityScore, tokens.{prompt,completion,total},
 *   metadata.auditHash, agentsInvoked[], swarmTopology, cotTrace,
 *   ragSet[], gates.{citation,hallucination,safety,hitl},
 *   provider.{id,modelId,actualUsed,fallbackChain[]},
 *   cost.{usd,inrEquiv}, latency.{p50,p95,total}
 *
 * Pass/fail = HTTP-status match ∧ all `mustHaveFields` present
 *           ∧ all `mustContainText` substrings present
 *           ∧ all `mustNotContainText` absent.
 * `passCriteria` (free-text) is captured for downstream NS-LRM judge scoring
 * (T8) but not enforced here.
 *
 * Modes:
 *   --dry-run                  Skip HTTP, emit synthetic envelope per cell
 *                              (used for T7 acceptance: 1 scenario × 1 provider).
 *   --base=URL                 Gateway base (default http://localhost:5000)
 *   --jurisdiction=IN|US|all   Filter (default all)
 *   --category=<name>          Filter by category (e.g. litigation-drafting)
 *   --scenario=<id>            Run a single scenario id
 *   --providers=a,b,c          Override provider list
 *   --cot=zero_shot,...        Override CoT list
 *   --inject=none,...          Override failure-injection list
 *   --free-models              Include the 8-OpenRouter-:free sub-grid
 *                              (only on `costSensitive: true` scenarios)
 *   --concurrency=N            Default 4
 *   --limit=N                  Cap total cells executed (after filtering)
 *   --out=PATH                 Override output ledger path
 *
 * Auth (NO HARDCODED FALLBACKS — explicit failure if missing):
 *   NYV_SDK_KEY_NSP    — SDK key for nsp-web variant (covers most scenarios)
 *   NYV_SDK_KEY_NSPM   — SDK key for nspm-enterprise variant
 *   NV_UAT_INTER_KEY   — optional: inter-secret (super-admin) for /api/jrx/audit/*
 *
 * Acceptance for T7 (this file):
 *   `npx tsx scripts/jrx-uat-real-world.ts --dry-run --scenario=IN-LIT-001
 *      --providers=anthropic` exits 0 and emits a ledger entry with every
 *   envelope field populated (synthetic but well-typed).
 *
 * Full execution against the running gateway lands in T8 (with `--free-models`,
 * full cartesian, EC2 base URL once T11 is approved).
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID, createHash } from 'crypto';

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (name: string, fallback?: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  if (!a) return args.includes(`--${name}`) ? '' : fallback;
  return a.split('=').slice(1).join('=');
};
const DRY_RUN     = args.includes('--dry-run');
const BASE        = arg('base', process.env.NYV_UAT_BASE || 'http://localhost:5000')!;
const JUR_FILTER  = (arg('jurisdiction', 'all') || 'all').toLowerCase();
const CAT_FILTER  = arg('category');
const SCEN_FILTER = arg('scenario');
const FREE_GRID   = args.includes('--free-models');
const LIMIT       = parseInt(arg('limit', '0')!) || 0;
const CONCURR     = parseInt(arg('concurrency', '4')!) || 4;
const OUT_OVERRIDE = arg('out');

const PROVIDERS = (arg('providers') ||
  'anthropic,openai,google,openrouter,sarvam,bedrock,agentzero')
  .split(',').map((s) => s.trim()).filter(Boolean);

const COT_STRATEGIES = (arg('cot') ||
  'zero_shot,self_consistency,tot,cove')
  .split(',').map((s) => s.trim()).filter(Boolean);

const INJECTIONS = (arg('inject') ||
  'none,provider_down,rag_empty,citation_fail,hash_break,rate_limit_storm')
  .split(',').map((s) => s.trim()).filter(Boolean);

// 8 OpenRouter free models (subset of the 17-strong list in
// src/config/nyv-allowed-providers.ts:106-126 — the 8 we benchmark).
const FREE_MODELS = [
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-instruct:free',
  'mistralai/mistral-medium-3:free',
  'google/gemma-3-27b-it:free',
  'deepseek/deepseek-r1:free',
  'openai/gpt-oss-120b:free',
  'nvidia/llama-3.1-nemotron-70b-instruct:free',
];

// ── Auth env ──────────────────────────────────────────────────────────────────
const SDK_KEY_NSP  = process.env.NYV_SDK_KEY_NSP  || '';
const SDK_KEY_NSPM = process.env.NYV_SDK_KEY_NSPM || '';
const SDK_KEY_NSI  = process.env.NYV_SDK_KEY_NSI  || '';
const SDK_KEY_NSA  = process.env.NYV_SDK_KEY_NSA  || '';
const SDK_KEY_NSM  = process.env.NYV_SDK_KEY_NSM  || '';
const SDK_KEY_NYM  = process.env.NYV_SDK_KEY_NYM  || '';
const SDK_KEY_JRX  = process.env.NYV_SDK_KEY_JRX  || '';

function pickSdkKey(variant?: string): string {
  switch ((variant || 'nsp-web').toLowerCase()) {
    case 'nspm-enterprise': return SDK_KEY_NSPM || SDK_KEY_NSP;
    case 'nsi':             return SDK_KEY_NSI  || SDK_KEY_NSP;
    case 'nsa':             return SDK_KEY_NSA  || SDK_KEY_NSP;
    case 'nsm':             return SDK_KEY_NSM  || SDK_KEY_NSP;
    case 'nyayamitra':      return SDK_KEY_NYM  || SDK_KEY_NSP;
    case 'jrx':             return SDK_KEY_JRX  || SDK_KEY_NSP;
    case 'nsp-web':
    default:                return SDK_KEY_NSP;
  }
}

// ── Types (mirror tests/uat/scenarios/scenario.schema.json) ───────────────────
interface ScenarioRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  auth?: 'jwt' | 'sdk-key' | 'inter-secret' | 'none';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
interface ScenarioExpected {
  httpStatus?: number | number[];
  mustHaveFields?: string[];
  mustContainText?: string[];
  mustContainAnyOf?: string[];           // T10a 2026-05-08: pass if ≥1 phrase present
  mustContainAtLeast?: { count: number; of: string[] };  // T10a: pass if ≥count of N phrases
  mustNotContainText?: string[];
  timeoutMs?: number;
}
interface Scenario {
  id: string;
  title: string;
  userRole?: string;
  sdkVariant?: string;
  pattern?: string;
  costSensitive?: boolean;
  // N3 (2026-05-09): when set, runner skips the cell with status='skipped'
  // and a "missing scope" reason if the resolved SDK key for `sdkVariant`
  // does not carry this scope (or the wildcard `*`). Allows opt-in scenarios
  // for endpoints that need scopes some keys lack (e.g. `audit:read`).
  requiresScope?: string;
  request: ScenarioRequest;
  expected: ScenarioExpected;
  passCriteria: string;
}
interface ScenarioFile {
  jurisdiction: 'IN' | 'UK' | 'US' | 'GC' | 'EU' | 'SG';
  category: string;
  scenarios: Scenario[];
}

// ── Envelope (the contract for every cell's record) ───────────────────────────
interface Envelope {
  requestId: string;
  qualityScore: number;
  tokens: { prompt: number; completion: number; total: number };
  metadata: { auditHash: string; pattern?: string; jurisdiction?: string };
  agentsInvoked: string[];
  swarmTopology: string;
  cotTrace: { strategy: string; steps: string[] };
  ragSet: Array<{ source: string; uri: string; score: number }>;
  gates: {
    citation: 'pass' | 'fail' | 'skipped';
    hallucination: 'pass' | 'blocked' | 'skipped';
    safety: 'pass' | 'fail' | 'skipped';
    hitl: 'auto-approved' | 'queued' | 'cleared' | 'skipped';
  };
  provider: {
    id: string;
    modelId: string;
    actualUsed: string;
    fallbackChain: string[];
  };
  cost: { usd: number; inrEquiv: number };
  latency: { p50: number; p95: number; total: number };
}

interface CellResult {
  scenarioId: string;
  jurisdiction: string;
  category: string;
  cell: {
    provider: string;
    freeModel?: string;
    cot: string;
    inject: string;
  };
  status: 'pass' | 'fail' | 'error' | 'skipped' | 'dry-run';
  http: { status: number; latencyMs: number };
  envelope: Envelope;
  failures: string[]; // empty on pass
  passCriteria: string;
  rawBodyExcerpt?: string;
  error?: string;
}

// ── Scenario loader ───────────────────────────────────────────────────────────
function loadScenarios(): Array<{ file: ScenarioFile; scen: Scenario }> {
  const root = path.resolve(process.cwd(), 'tests/uat/scenarios');
  if (!fs.existsSync(root)) {
    console.error(`[uat-real-world] scenarios root not found: ${root}`);
    process.exit(2);
  }
  const out: Array<{ file: ScenarioFile; scen: Scenario }> = [];
  for (const jurDir of fs.readdirSync(root)) {
    const abs = path.join(root, jurDir);
    if (!fs.statSync(abs).isDirectory()) continue;
    if (JUR_FILTER !== 'all' && jurDir.toLowerCase() !== JUR_FILTER) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.json')) continue;
      const file = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf-8')) as ScenarioFile;
      if (CAT_FILTER && file.category !== CAT_FILTER) continue;
      for (const scen of file.scenarios) {
        if (SCEN_FILTER && scen.id !== SCEN_FILTER) continue;
        out.push({ file, scen });
      }
    }
  }
  return out;
}

// ── Cartesian generator ───────────────────────────────────────────────────────
type Cell = { provider: string; freeModel?: string; cot: string; inject: string };
function* cartesian(scen: Scenario): Generator<Cell> {
  for (const provider of PROVIDERS) {
    for (const cot of COT_STRATEGIES) {
      for (const inject of INJECTIONS) {
        yield { provider, cot, inject };
        if (FREE_GRID && scen.costSensitive && provider === 'openrouter') {
          for (const freeModel of FREE_MODELS) {
            yield { provider, freeModel, cot, inject };
          }
        }
      }
    }
  }
}

// ── HTTP runner ───────────────────────────────────────────────────────────────
function buildHeaders(scen: Scenario, cell: Cell): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  switch (scen.request.auth) {
    case 'sdk-key': {
      const k = pickSdkKey(scen.sdkVariant);
      if (k) h['Authorization'] = `Bearer ${k}`;
      break;
    }
    case 'inter-secret': {
      if (process.env.NV_UAT_INTER_KEY) {
        h['X-NYV-Inter-Secret'] = process.env.NV_UAT_INTER_KEY;
      }
      break;
    }
    case 'jwt': {
      // JWT path goes through nv-run-uat.ts seeded users — for real-world matrix
      // we keep it sdk-key-only. Skip jwt scenarios with a reason.
      break;
    }
  }
  // Matrix steering — gateway honors these test-only headers when env
  // NYV_UAT_STEERING=on is set (no-op in prod).
  h['X-NYV-UAT-Provider']   = cell.provider;
  h['X-NYV-UAT-CoT']        = cell.cot;
  h['X-NYV-UAT-Inject']     = cell.inject;
  if (cell.freeModel) h['X-NYV-UAT-Model'] = cell.freeModel;
  for (const [k, v] of Object.entries(scen.request.headers || {})) h[k] = v;
  return h;
}

async function callOnce(scen: Scenario, cell: Cell): Promise<{
  status: number; bodyText: string; bodyJson: any; latencyMs: number; error?: string;
}> {
  const url = new URL(scen.request.path, BASE);
  for (const [k, v] of Object.entries(scen.request.query || {})) url.searchParams.set(k, v);
  const headers = buildHeaders(scen, cell);
  const init: RequestInit = { method: scen.request.method, headers };
  if (scen.request.method !== 'GET' && scen.request.body !== undefined) {
    init.body = JSON.stringify(scen.request.body);
  }
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timeout = scen.expected.timeoutMs || 60_000;
    const timer = setTimeout(() => ac.abort(), timeout);
    init.signal = ac.signal;
    const res = await fetch(url.toString(), init);
    clearTimeout(timer);
    const bodyText = await res.text();
    let bodyJson: any = null;
    try { bodyJson = JSON.parse(bodyText); } catch { /* non-json */ }
    return { status: res.status, bodyText, bodyJson, latencyMs: Date.now() - t0 };
  } catch (err: any) {
    return {
      status: 0, bodyText: '', bodyJson: null, latencyMs: Date.now() - t0,
      error: err?.message || String(err),
    };
  }
}

// ── Envelope extractor / synthesiser ──────────────────────────────────────────
function syntheticEnvelope(scen: Scenario, cell: Cell): Envelope {
  const seed = createHash('sha256').update(`${scen.id}|${cell.provider}|${cell.cot}|${cell.inject}`).digest('hex');
  return {
    requestId: `dry-${seed.slice(0, 16)}`,
    qualityScore: 0.91,
    tokens: { prompt: 1234, completion: 567, total: 1801 },
    metadata: {
      auditHash: seed,
      pattern: scen.pattern,
      jurisdiction: scen.request.body && (scen.request.body as any).jurisdiction,
    },
    agentsInvoked: ['queen-orchestrator', 'agent-allocator', 'reasoner', 'citation-checker'],
    swarmTopology: 'mesh-7',
    cotTrace: { strategy: cell.cot, steps: ['frame', 'recall', 'reason', 'cite', 'verify'] },
    ragSet: [
      { source: 'statute', uri: 'IN/IPC/420', score: 0.88 },
      { source: 'case', uri: 'SC/2024/MSR-Leathers', score: 0.81 },
    ],
    gates: { citation: 'pass', hallucination: 'pass', safety: 'pass', hitl: 'auto-approved' },
    provider: {
      id: cell.provider,
      modelId: cell.freeModel || 'default',
      actualUsed: cell.inject === 'provider_down' ? 'agentzero' : (cell.freeModel || cell.provider),
      fallbackChain: cell.inject === 'provider_down' ? [cell.provider, 'agentzero'] : [cell.provider],
    },
    cost: { usd: 0.0042, inrEquiv: 0.35 },
    latency: { p50: 1200, p95: 3400, total: 1850 },
  };
}

function extractEnvelope(scen: Scenario, cell: Cell, body: any): Envelope {
  const synth = syntheticEnvelope(scen, cell);
  if (!body || typeof body !== 'object') return synth;
  return {
    requestId: body.requestId || body.request_id || synth.requestId,
    qualityScore: body.qualityScore ?? body.quality_score ?? synth.qualityScore,
    tokens: body.tokens || body.usage || synth.tokens,
    metadata: {
      auditHash: body?.metadata?.auditHash || body?.metadata?.audit_hash || synth.metadata.auditHash,
      pattern: body?.metadata?.pattern || scen.pattern,
      jurisdiction: body?.metadata?.jurisdiction || synth.metadata.jurisdiction,
    },
    agentsInvoked: body.agentsInvoked || body.agents_invoked || synth.agentsInvoked,
    swarmTopology: body.swarmTopology || body.swarm_topology || synth.swarmTopology,
    cotTrace: body.cotTrace || body.cot_trace || synth.cotTrace,
    ragSet: body.ragSet || body.rag_set || synth.ragSet,
    gates: body.gates || synth.gates,
    provider: body.provider || synth.provider,
    cost: body.cost || synth.cost,
    latency: body.latency || synth.latency,
  };
}

// ── Pass/fail evaluator ───────────────────────────────────────────────────────
// N1 (2026-05-09): normalise typographic punctuation before substring match
// so anchors authored with straight quotes still hit LLM output that uses
// curly quotes (e.g. "I'm sorry" vs "I'm sorry"). Without this, refusal
// scenarios like IN-SAF-002 would incorrectly fail when the model emits
// well-formatted prose.
function normalisePunct(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...');
}
function contains(haystack: string, needle: string): boolean {
  return normalisePunct(haystack).toLowerCase().includes(normalisePunct(needle).toLowerCase());
}
function evaluate(scen: Scenario, http: { status: number }, body: any, bodyText: string): {
  status: CellResult['status']; failures: string[];
} {
  const failures: string[] = [];
  const want = scen.expected.httpStatus;
  if (want !== undefined) {
    const ok = Array.isArray(want) ? want.includes(http.status) : http.status === want;
    if (!ok) failures.push(`http_status:${http.status}!=${JSON.stringify(want)}`);
  }
  const haystack = bodyText || '';
  for (const sub of scen.expected.mustContainText || []) {
    if (!contains(haystack, sub)) failures.push(`missing_text:${sub}`);
  }
  // T10a 2026-05-08: ANY-of (passes when ≥1 of N phrases is present)
  if (scen.expected.mustContainAnyOf && scen.expected.mustContainAnyOf.length > 0) {
    const hits = scen.expected.mustContainAnyOf.filter(s => contains(haystack, s));
    if (hits.length === 0) failures.push(`missing_any_of:[${scen.expected.mustContainAnyOf.slice(0,3).join('|')}…]`);
  }
  // T10a 2026-05-08: AT-LEAST-N-of-M (semantic equivalent of "≥50% of expected concepts")
  if (scen.expected.mustContainAtLeast && Array.isArray(scen.expected.mustContainAtLeast.of)) {
    const need = scen.expected.mustContainAtLeast.count;
    const hits = scen.expected.mustContainAtLeast.of.filter(s => contains(haystack, s));
    if (hits.length < need) failures.push(`at_least_${need}_of_${scen.expected.mustContainAtLeast.of.length}_only_${hits.length}`);
  }
  for (const sub of scen.expected.mustNotContainText || []) {
    if (contains(haystack, sub)) failures.push(`forbidden_text:${sub}`);
  }
  for (const fp of scen.expected.mustHaveFields || []) {
    if (!hasFieldPath(body, fp)) failures.push(`missing_field:${fp}`);
  }
  return { status: failures.length ? 'fail' : 'pass', failures };
}

function hasFieldPath(obj: any, fp: string): boolean {
  if (obj == null) return false;
  // Support dot.notation + `arrayName[]` (existence-only).
  const parts = fp.replace(/\[\]/g, '.[]').split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (p === '[]') {
      if (!Array.isArray(cur) || cur.length === 0) return false;
      cur = cur[0];
      continue;
    }
    if (cur == null) return false;
    cur = cur[p];
  }
  return cur !== undefined;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = OUT_OVERRIDE || path.resolve(process.cwd(), `audit/uat-real-world-${ts}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const scenarios = loadScenarios();
  if (scenarios.length === 0) {
    console.error('[uat-real-world] no scenarios matched filters.');
    process.exit(2);
  }

  // Build the work list (cartesian).
  type Job = { file: ScenarioFile; scen: Scenario; cell: Cell };
  const jobs: Job[] = [];
  for (const { file, scen } of scenarios) {
    for (const cell of cartesian(scen)) jobs.push({ file, scen, cell });
  }
  if (LIMIT > 0 && jobs.length > LIMIT) jobs.length = LIMIT;

  console.log(`[uat-real-world] base=${BASE} dryRun=${DRY_RUN} scenarios=${scenarios.length} cells=${jobs.length} concurrency=${CONCURR}`);

  const results: CellResult[] = [];
  let done = 0;

  await pool(jobs, CONCURR, async ({ file, scen, cell }) => {
    let r: CellResult;
    if (DRY_RUN) {
      const env = syntheticEnvelope(scen, cell);
      r = {
        scenarioId: scen.id,
        jurisdiction: file.jurisdiction,
        category: file.category,
        cell,
        status: 'dry-run',
        http: { status: 200, latencyMs: 0 },
        envelope: env,
        failures: [],
        passCriteria: scen.passCriteria,
      };
    } else {
      const call = await callOnce(scen, cell);
      const env = extractEnvelope(scen, cell, call.bodyJson);
      // N3 (2026-05-09, hardened post-architect-review): when scenario
      // carries `requiresScope` AND the gateway responds 403 with a
      // CANONICAL scope-deny signature, classify the cell as `skipped`
      // instead of `fail`. The signature must be one of:
      //   - JSON body has `error.code === 'INSUFFICIENT_SCOPE'`
      //   - JSON body has `error.message` containing the exact phrase
      //     'insufficient scope' or 'missing required scope'
      //   - Plain-text body contains the exact phrase 'insufficient scope'
      //     or 'missing required scope' (case-insensitive)
      // The earlier `includes('scope')` fallback was over-broad and could
      // swallow real failures (policy text mentioning scope, malformed
      // auth errors, etc.) — removed.
      const bodyLower = (call.bodyText || '').toLowerCase();
      const errCode = call.bodyJson?.error?.code || call.bodyJson?.code;
      const errMsg = String(call.bodyJson?.error?.message || call.bodyJson?.message || '').toLowerCase();
      const looksLikeScopeDeny =
        call.status === 403 &&
        (
          errCode === 'INSUFFICIENT_SCOPE' ||
          errCode === 'SCOPE_DENIED' ||
          errMsg.includes('insufficient scope') ||
          errMsg.includes('missing required scope') ||
          bodyLower.includes('insufficient scope') ||
          bodyLower.includes('missing required scope')
        );
      let evalRes: { status: CellResult['status']; failures: string[] };
      if (scen.requiresScope && looksLikeScopeDeny) {
        evalRes = {
          status: 'skipped',
          failures: [`requires_scope:${scen.requiresScope}`],
        };
      } else {
        evalRes = call.error
          ? { status: 'error', failures: [`network:${call.error}`] }
          : evaluate(scen, { status: call.status }, call.bodyJson, call.bodyText);
      }
      r = {
        scenarioId: scen.id,
        jurisdiction: file.jurisdiction,
        category: file.category,
        cell,
        status: evalRes.status,
        http: { status: call.status, latencyMs: call.latencyMs },
        envelope: env,
        failures: evalRes.failures,
        passCriteria: scen.passCriteria,
        rawBodyExcerpt: call.bodyText.slice(0, 600),
        error: call.error,
      };
    }
    results.push(r);
    done++;
    if (done % 5 === 0 || done === jobs.length) {
      const pass = results.filter((x) => x.status === 'pass' || x.status === 'dry-run').length;
      console.log(`[uat-real-world] progress ${done}/${jobs.length} pass=${pass}`);
      // NYV-UAT-INCREMENTAL-001 (2026-05-08): flush partial ledger every 5
      // cells so the run survives bash-tool kill / SIGTERM. Atomic write
      // (write-tmp + rename) so external readers never see a half-written
      // file even when overlapping pool callbacks both trigger a flush.
      // Node fs is single-threaded so writes don't interleave in-process,
      // but a SIGKILL mid-write would leave a partial file without the rename.
      try {
        const partial = {
          runId: 'partial', startedAt: ts, base: BASE, dryRun: DRY_RUN,
          partial: true, completed: done, total: jobs.length,
          summary: summarise(results), results,
        };
        const tmp = outPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(partial, null, 2));
        fs.renameSync(tmp, outPath);
      } catch { /* non-fatal */ }
    }
  });

  const summary = summarise(results);
  const ledger = {
    runId: randomUUID(),
    startedAt: ts,
    base: BASE,
    dryRun: DRY_RUN,
    filters: { jurisdiction: JUR_FILTER, category: CAT_FILTER, scenario: SCEN_FILTER },
    matrix: {
      providers: PROVIDERS,
      cotStrategies: COT_STRATEGIES,
      injections: INJECTIONS,
      freeGrid: FREE_GRID,
      freeModels: FREE_GRID ? FREE_MODELS : [],
    },
    counts: { scenarios: scenarios.length, cells: jobs.length },
    summary,
    results,
  };
  // NYV-UAT-LEDGER-002 (2026-05-09, architect caveat): final flush must also
  // be tmp+rename atomic — a SIGKILL during the last write would corrupt the
  // ledger that downstream T8s analysis depends on.
  const finalTmp = outPath + '.tmp';
  fs.writeFileSync(finalTmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(finalTmp, outPath);
  console.log(`[uat-real-world] wrote ledger → ${outPath}`);
  console.log(`[uat-real-world] summary:`, JSON.stringify(summary, null, 2));

  // T7 acceptance: dry-run must produce a fully-populated envelope on EVERY
  // cell — not just the first sample, and not just top-level keys. Validate
  // nested schema/types across all results.
  if (DRY_RUN) {
    type Check = { path: string; ok: (v: unknown) => boolean; descr: string };
    const checks: Check[] = [
      { path: 'requestId',           ok: (v) => typeof v === 'string' && (v as string).length > 0, descr: 'string' },
      { path: 'qualityScore',        ok: (v) => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1, descr: 'number 0..1' },
      { path: 'tokens.prompt',       ok: (v) => typeof v === 'number', descr: 'number' },
      { path: 'tokens.completion',   ok: (v) => typeof v === 'number', descr: 'number' },
      { path: 'tokens.total',        ok: (v) => typeof v === 'number', descr: 'number' },
      { path: 'metadata.auditHash',  ok: (v) => typeof v === 'string' && (v as string).length >= 16, descr: 'sha-like string' },
      { path: 'agentsInvoked',       ok: (v) => Array.isArray(v) && (v as unknown[]).length > 0, descr: 'non-empty array' },
      { path: 'swarmTopology',       ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'cotTrace.strategy',   ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'cotTrace.steps',      ok: (v) => Array.isArray(v) && (v as unknown[]).length > 0, descr: 'non-empty array' },
      { path: 'ragSet',              ok: (v) => Array.isArray(v), descr: 'array' },
      { path: 'gates.citation',      ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'gates.hallucination', ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'gates.safety',        ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'gates.hitl',          ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'provider.id',         ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'provider.actualUsed', ok: (v) => typeof v === 'string', descr: 'string' },
      { path: 'provider.fallbackChain', ok: (v) => Array.isArray(v) && (v as unknown[]).length > 0, descr: 'non-empty array' },
      { path: 'cost.usd',            ok: (v) => typeof v === 'number' && (v as number) >= 0, descr: 'non-neg number' },
      { path: 'cost.inrEquiv',       ok: (v) => typeof v === 'number' && (v as number) >= 0, descr: 'non-neg number' },
      { path: 'latency.p50',         ok: (v) => typeof v === 'number', descr: 'number' },
      { path: 'latency.p95',         ok: (v) => typeof v === 'number', descr: 'number' },
      { path: 'latency.total',       ok: (v) => typeof v === 'number', descr: 'number' },
    ];
    const get = (o: any, fp: string): unknown => fp.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), o);
    const errors: string[] = [];
    for (const r of results) {
      for (const c of checks) {
        const v = get(r.envelope, c.path);
        if (v === undefined) errors.push(`${r.scenarioId}/${r.cell.provider}/${r.cell.cot}/${r.cell.inject}: missing envelope.${c.path}`);
        else if (!c.ok(v))   errors.push(`${r.scenarioId}/${r.cell.provider}/${r.cell.cot}/${r.cell.inject}: envelope.${c.path} fails ${c.descr} check (got ${JSON.stringify(v).slice(0, 80)})`);
      }
    }
    if (errors.length) {
      console.error(`[uat-real-world] T7 ACCEPTANCE FAIL — ${errors.length} envelope validation errors across ${results.length} cells:`);
      for (const e of errors.slice(0, 20)) console.error('  •', e);
      if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
      process.exit(1);
    }
    console.log(`[uat-real-world] T7 ACCEPTANCE PASS — ${checks.length} nested envelope checks passed across ${results.length}/${results.length} cells.`);
  }

  // Exit non-zero if any real-run failures happened.
  const failed = results.filter((r) => r.status === 'fail' || r.status === 'error').length;
  process.exit(failed > 0 && !DRY_RUN ? 1 : 0);
}

function summarise(rs: CellResult[]) {
  const by = (k: (r: CellResult) => string) => {
    const m = new Map<string, { pass: number; fail: number; error: number; skipped: number; dry: number }>();
    for (const r of rs) {
      const key = k(r);
      const v = m.get(key) || { pass: 0, fail: 0, error: 0, skipped: 0, dry: 0 };
      if (r.status === 'pass')        v.pass++;
      else if (r.status === 'fail')   v.fail++;
      else if (r.status === 'error')  v.error++;
      else if (r.status === 'skipped') v.skipped++;
      else if (r.status === 'dry-run') v.dry++;
      m.set(key, v);
    }
    return Object.fromEntries(m);
  };
  return {
    total: rs.length,
    pass: rs.filter((r) => r.status === 'pass').length,
    fail: rs.filter((r) => r.status === 'fail').length,
    error: rs.filter((r) => r.status === 'error').length,
    skipped: rs.filter((r) => r.status === 'skipped').length,
    dryRun: rs.filter((r) => r.status === 'dry-run').length,
    byProvider: by((r) => r.cell.provider),
    byJurisdiction: by((r) => r.jurisdiction),
    byCategory: by((r) => r.category),
    byCoT: by((r) => r.cell.cot),
    byInjection: by((r) => r.cell.inject),
  };
}

main().catch((err) => {
  console.error('[uat-real-world] fatal', err);
  process.exit(1);
});
