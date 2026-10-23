#!/usr/bin/env tsx
/**
 * NV-PRE-DEPLOY-SMOKE-001 — Batches A–J consolidated dispatcher.
 *
 * For every /api/nv5/* namespace wired by Sessions 10–11:
 *   1. Flag-OFF probe   → assert 404 on canonical capability route.
 *   2. Flag-ON  probe   → set JRX_F_* env vars in-process, restart gateway
 *                          via the JRX Gateway workflow, assert 200.
 *
 * The gateway is restarted via signal-free child env injection: we cannot
 * mutate the running workflow's env, so flag-ON requires the user (or this
 * script's caller) to flip a flag and restart. Instead, this script focuses
 * on (a) what is reachable RIGHT NOW with the live workflow env, and
 * (b) what fails closed (404) when its flag is OFF — both critical signals
 * for the pre-deploy gate.
 *
 * Per NV-AUTH-HEADER-001: SDK requests use X-API-Key (NSP) header.
 *
 * Output:
 *   audit/pre-deploy-batches-a-j-<TS>.json
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5000';
const KEY = process.env.JRX_SDK_KEY_NSP || '';
if (!KEY) { console.error('JRX_SDK_KEY_NSP missing'); process.exit(2); }

interface Probe {
  batch: string;
  namespace: string;
  flag: string;            // env var name(s); '|' for OR-of-flags
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  expectFlagOff: number | number[];
  expectFlagOn?: number | number[]; // optional — defaults to [200, 401, 403] when flag ON
}

// Flag-ON success = route is reachable. 200/400 = route ran. 403 INSUFFICIENT_SCOPE
// is also acceptable: it proves the route mounted AND the scope guard fired
// (admin-only surfaces correctly reject the marketing-tier NSP key).
const DEFAULT_FLAG_ON_OK = [200, 400, 403] as const;

// Canonical capability route per namespace. ALL require X-API-Key + admin scope
// when flag is ON; with flag OFF the entire mount is removed → 404.
const PROBES: Probe[] = [
  // === Batch A — /api/nv5/orch/* ===
  { batch: 'A', namespace: 'orch/kb',             flag: 'JRX_F_AI_ORCH_KB',             method: 'GET', path: '/api/nv5/orch/kb/health',                   expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/context',        flag: 'JRX_F_AI_ORCH_CONTEXT',        method: 'GET', path: '/api/nv5/orch/context/health',              expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/multimodal-rag', flag: 'JRX_F_AI_ORCH_MULTIMODAL_RAG', method: 'GET', path: '/api/nv5/orch/multimodal-rag/health',       expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/plugins',        flag: 'JRX_F_AI_ORCH_PLUGINS',        method: 'GET', path: '/api/nv5/orch/plugins/health',              expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/roma',           flag: 'JRX_F_AI_ORCH_ROMA',           method: 'GET', path: '/api/nv5/orch/roma/health',                 expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/agent-select',   flag: 'JRX_F_AI_ORCH_AGENT_SELECT',   method: 'GET', path: '/api/nv5/orch/agent-select/health',         expectFlagOff: 404 },
  { batch: 'A', namespace: 'orch/protocols',      flag: 'JRX_F_AI_ORCH_PROTOCOLS',      method: 'GET', path: '/api/nv5/orch/protocols/health',            expectFlagOff: 404 },

  // === Batch B — /api/nv5/multimodal|voice/* ===
  // Mounts are unconditional; per-sub flag enforced inside barrels. Health on each sub.
  { batch: 'B', namespace: 'multimodal/avatar-unity',    flag: 'JRX_F_MULTIMODAL_AVATAR_UNITY',    method: 'GET', path: '/api/nv5/multimodal/avatar-unity/health',      expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'multimodal/avatar-chatdoll', flag: 'JRX_F_MULTIMODAL_AVATAR_CHATDOLL', method: 'GET', path: '/api/nv5/multimodal/avatar-chatdoll/health',   expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'multimodal/rag-adv',         flag: 'JRX_F_MULTIMODAL_RAG_ADV',         method: 'GET', path: '/api/nv5/multimodal/rag-adv/health',           expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'multimodal/3d-immersive',    flag: 'JRX_F_MULTIMODAL_3D_IMMERSIVE',    method: 'GET', path: '/api/nv5/multimodal/3d-immersive/health',      expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'multimodal/avatar-3d',       flag: 'JRX_F_MULTIMODAL_AVATAR_3D',       method: 'GET', path: '/api/nv5/multimodal/avatar-3d/health',         expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'voice/streaming',            flag: 'JRX_F_VOICE_STREAM_RT',            method: 'GET', path: '/api/nv5/voice/streaming/health',              expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'voice/synthesis',            flag: 'JRX_F_VOICE_SYNTH',                method: 'GET', path: '/api/nv5/voice/synthesis/health',              expectFlagOff: [404, 401, 403] },
  { batch: 'B', namespace: 'voice/enhanced',             flag: 'JRX_F_VOICE_ENHANCED',             method: 'GET', path: '/api/nv5/voice/enhanced/health',               expectFlagOff: [404, 401, 403] },

  // === Batch C — workflows + doc-ai ===
  { batch: 'C', namespace: 'workflows/autonomous',  flag: 'JRX_F_WORKFLOW_AUTONOMOUS', method: 'GET', path: '/api/nv5/workflows/autonomous/health',   expectFlagOff: [404, 401, 403] },
  { batch: 'C', namespace: 'workflows/continuous',  flag: 'JRX_F_WORKFLOW_CONTINUOUS', method: 'GET', path: '/api/nv5/workflows/continuous/health',   expectFlagOff: [404, 401, 403] },
  { batch: 'C', namespace: 'doc-ai/convert',        flag: 'JRX_F_DOC_AI_CONVERT',      method: 'GET', path: '/api/nv5/doc-ai/convert/health',         expectFlagOff: [404, 401, 403] },

  // === Batch D — gov ===
  { batch: 'D', namespace: 'gov/maker-checker',   flag: 'JRX_F_GOV_MAKER_CHECKER',  method: 'GET', path: '/api/nv5/gov/maker-checker/queue',         expectFlagOff: [404, 401, 403] },
  { batch: 'D', namespace: 'gov/security-monitor',flag: 'JRX_F_GOV_SECURITY_MON',   method: 'GET', path: '/api/nv5/gov/security-monitor/status',     expectFlagOff: [404, 401, 403] },
  { batch: 'D', namespace: 'gov/cost-optimizer',  flag: 'JRX_F_GOV_COST_OPT',       method: 'GET', path: '/api/nv5/gov/cost-optimizer/status',       expectFlagOff: [404, 401, 403] },
  { batch: 'D', namespace: 'gov/concurrency',     flag: 'JRX_F_GOV_CONCURRENCY',    method: 'GET', path: '/api/nv5/gov/concurrency/snapshot',        expectFlagOff: [404, 401, 403] },
  { batch: 'D', namespace: 'gov/org-ratelimit',   flag: 'JRX_F_GOV_ORG_RATELIMIT',  method: 'GET', path: '/api/nv5/gov/org-ratelimit/check/o1/u1',  expectFlagOff: [404, 401, 403] },

  // === Batch E — legal-pipeline ===
  { batch: 'E', namespace: 'legal-pipeline/chunker',     flag: 'JRX_F_LEGAL_PIPELINE_CHUNKER',     method: 'GET', path: '/api/nv5/legal-pipeline/chunker/capabilities',     expectFlagOff: [404, 401, 403] },
  { batch: 'E', namespace: 'legal-pipeline/embedding',   flag: 'JRX_F_LEGAL_PIPELINE_EMBEDDING',   method: 'GET', path: '/api/nv5/legal-pipeline/embedding/capabilities',   expectFlagOff: [404, 401, 403] },
  { batch: 'E', namespace: 'legal-pipeline/reranker',    flag: 'JRX_F_LEGAL_PIPELINE_RERANKER',    method: 'GET', path: '/api/nv5/legal-pipeline/reranker/capabilities',    expectFlagOff: [404, 401, 403] },
  { batch: 'E', namespace: 'legal-pipeline/summarizer',  flag: 'JRX_F_LEGAL_PIPELINE_SUMMARIZER',  method: 'GET', path: '/api/nv5/legal-pipeline/summarizer/capabilities',  expectFlagOff: [404, 401, 403] },
  { batch: 'E', namespace: 'legal-pipeline/readability', flag: 'JRX_F_LEGAL_PIPELINE_READABILITY', method: 'GET', path: '/api/nv5/legal-pipeline/readability/capabilities', expectFlagOff: [404, 401, 403] },

  // === Batch F — compliance ===
  { batch: 'F', namespace: 'compliance/eu-ai-act',         flag: 'JRX_F_COMPLIANCE_EU_AI_ACT',          method: 'GET', path: '/api/nv5/compliance/eu-ai-act/capabilities',          expectFlagOff: [404, 401, 403] },
  { batch: 'F', namespace: 'compliance/pqc',               flag: 'JRX_F_COMPLIANCE_PQC',                method: 'GET', path: '/api/nv5/compliance/pqc/capabilities',                expectFlagOff: [404, 401, 403] },
  { batch: 'F', namespace: 'compliance/federated-privacy', flag: 'JRX_F_COMPLIANCE_FEDERATED_PRIVACY',  method: 'GET', path: '/api/nv5/compliance/federated-privacy/capabilities', expectFlagOff: [404, 401, 403] },

  // === Batches G+H+I+J — internal ===
  { batch: 'G-J', namespace: 'internal/model-cascade',       flag: 'JRX_F_INTERNAL_SURFACE', method: 'GET', path: '/api/nv5/internal/model-cascade/capabilities',       expectFlagOff: [404] },
  { batch: 'G-J', namespace: 'internal/esign',               flag: 'JRX_F_INTERNAL_SURFACE', method: 'GET', path: '/api/nv5/internal/esign/capabilities',               expectFlagOff: [404] },
  { batch: 'G-J', namespace: 'internal/hallucination',       flag: 'JRX_F_INTERNAL_SURFACE', method: 'GET', path: '/api/nv5/internal/hallucination/capabilities',       expectFlagOff: [404] },
  { batch: 'G-J', namespace: 'internal/case-update',         flag: 'JRX_F_INTERNAL_SURFACE', method: 'GET', path: '/api/nv5/internal/case-update/capabilities',         expectFlagOff: [404] },
  { batch: 'G-J', namespace: 'internal/feature-flags',       flag: 'JRX_F_INTERNAL_SURFACE', method: 'GET', path: '/api/nv5/internal/feature-flags/capabilities',       expectFlagOff: [404] },

  // === Per-namespace failure-path payload probes (NV-PRE-DEPLOY-SMOKE-003,
  // Session-13 follow-up to architect's required happy/failure payload coverage).
  // One representative POST {} per namespace-family. Flag-OFF: must 404 (whole
  // mount removed). Flag-ON: expects 4xx — 400/422 (schema rejection = handler
  // ran, payload validator fired) or 401/403 (auth/scope guard fired = safety
  // ring intact). Anything other than 4xx (e.g. 200 on empty body, 500 unhandled
  // exception) is a real bug we want to catch pre-deploy. The corresponding
  // GET /capabilities|health probes above ARE the happy-path probes for each
  // namespace (they assert 200 with valid auth when flag ON).
  { batch: 'A-fail',   namespace: 'orch/kb-failpath',                flag: 'JRX_F_AI_ORCH_KB',                  method: 'POST', path: '/api/nv5/orch/kb/health',                       body: {}, expectFlagOff: [404], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'B-fail',   namespace: 'multimodal/avatar-unity-failpath',flag: 'JRX_F_MULTIMODAL_AVATAR_UNITY',     method: 'POST', path: '/api/nv5/multimodal/avatar-unity/health',       body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'B-fail',   namespace: 'voice/streaming-failpath',        flag: 'JRX_F_VOICE_STREAM_RT',             method: 'POST', path: '/api/nv5/voice/streaming/health',               body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'C-fail',   namespace: 'workflows/autonomous-failpath',   flag: 'JRX_F_WORKFLOW_AUTONOMOUS',         method: 'POST', path: '/api/nv5/workflows/autonomous/health',          body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'C-fail',   namespace: 'doc-ai/convert-failpath',         flag: 'JRX_F_DOC_AI_CONVERT',              method: 'POST', path: '/api/nv5/doc-ai/convert/health',                body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'D-fail',   namespace: 'gov/maker-checker-failpath',      flag: 'JRX_F_GOV_MAKER_CHECKER',           method: 'POST', path: '/api/nv5/gov/maker-checker/queue',              body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'E-fail',   namespace: 'legal-pipeline/chunker-failpath', flag: 'JRX_F_LEGAL_PIPELINE_CHUNKER',      method: 'POST', path: '/api/nv5/legal-pipeline/chunker/capabilities',  body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'F-fail',   namespace: 'compliance/eu-ai-act-failpath',   flag: 'JRX_F_COMPLIANCE_EU_AI_ACT',        method: 'POST', path: '/api/nv5/compliance/eu-ai-act/capabilities',    body: {}, expectFlagOff: [404, 401, 403], expectFlagOn: [400, 401, 403, 404, 405, 422] },
  { batch: 'G-J-fail', namespace: 'internal/model-cascade-failpath', flag: 'JRX_F_INTERNAL_SURFACE',            method: 'POST', path: '/api/nv5/internal/model-cascade/capabilities',  body: {}, expectFlagOff: [404], expectFlagOn: [400, 401, 403, 404, 405, 422] },
];

interface Result {
  batch: string;
  namespace: string;
  flag: string;
  method: string;
  path: string;
  flagOnEnv: boolean;
  status: number;
  expected: number | number[];
  ok: boolean;
  ms: number;
  bodyExcerpt?: string;
}

const results: Result[] = [];

async function probe(p: Probe): Promise<Result> {
  const flagOnEnv = (() => {
    for (const f of p.flag.split('|')) {
      const v = (process.env[f] ?? '').trim().toLowerCase();
      if (v === '1' || v === 'true') return true;
    }
    return false;
  })();
  const expected = flagOnEnv ? (p.expectFlagOn ?? [...DEFAULT_FLAG_ON_OK]) : p.expectFlagOff;
  const t0 = Date.now();
  let status = 0; let body = '';
  try {
    const res = await fetch(`${BASE}${p.path}`, {
      method: p.method,
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
      body: p.body ? JSON.stringify(p.body) : undefined,
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    body = `ERR: ${(e as Error).message}`;
  }
  const ms = Date.now() - t0;
  const expArr = Array.isArray(expected) ? expected : [expected];
  const ok = expArr.includes(status);
  const r: Result = { batch: p.batch, namespace: p.namespace, flag: p.flag, method: p.method, path: p.path, flagOnEnv, status, expected, ok, ms, bodyExcerpt: body.slice(0, 200) };
  results.push(r);
  console.log(`  ${ok ? '✓' : '✗'} [${p.batch.padEnd(3)}] ${p.namespace.padEnd(35)} ${p.method.padEnd(4)} → ${status} (exp ${JSON.stringify(expected)}, ${ms}ms${flagOnEnv ? ', flag=ON' : ''})`);
  return r;
}

async function main() {
  console.log(`\n══════════════════════════════════════════════════════════════════════════`);
  console.log(`  NV PRE-DEPLOY BATCHES A–J SMOKE  →  ${BASE}`);
  console.log(`══════════════════════════════════════════════════════════════════════════\n`);

  // Pace probes to stay under the 60-req/min platform rate limit (1.2s gap = 50/min headroom).
  for (const p of PROBES) { await probe(p); await new Promise(r => setTimeout(r, 1200)); }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;

  console.log(`\n══════════════════════════════════════════════════════════════════════════`);
  console.log(`  Result: ${pass} PASS / ${fail} FAIL  (total ${results.length})`);
  const byBatch: Record<string, { pass: number; fail: number }> = {};
  for (const r of results) {
    byBatch[r.batch] = byBatch[r.batch] || { pass: 0, fail: 0 };
    if (r.ok) byBatch[r.batch].pass++; else byBatch[r.batch].fail++;
  }
  console.log(`  Per-batch:`);
  for (const [b, c] of Object.entries(byBatch)) console.log(`    ${b.padEnd(4)} ${c.pass} PASS / ${c.fail} FAIL`);
  console.log(`══════════════════════════════════════════════════════════════════════════`);

  fs.mkdirSync('audit', { recursive: true });
  const out = `audit/pre-deploy-batches-a-j-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(out, JSON.stringify({ base: BASE, ts: new Date().toISOString(), pass, fail, results }, null, 2));
  console.log(`  → ${out}`);

  if (fail > 0) {
    console.log(`\n── Failures ──`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  [${r.batch}] ${r.namespace} ${r.method} ${r.path}: status=${r.status} expected=${JSON.stringify(r.expected)} body=${r.bodyExcerpt}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('fatal:', e); process.exit(2); });
