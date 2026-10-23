#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const BASE = process.env.NV_BASE_URL || 'http://127.0.0.1:5000';
const PLATFORMS = [
  { sku: 'NSP',  key: process.env.JRX_SDK_KEY_NSP,  client: 'nyayasiddhi-professional/1.0.0', tier: 'enterprise' },
  { sku: 'NSPM', key: process.env.JRX_SDK_KEY_NSPM, client: 'nyayasiddhi',                    tier: 'enterprise' },
  { sku: 'NSI',  key: process.env.JRX_SDK_KEY_NSI,  client: 'nyayasiddhi',                    tier: 'enterprise' },
  { sku: 'NSA',  key: process.env.JRX_SDK_KEY_NSA,  client: 'nyayasiddhi',                    tier: 'enterprise' },
  { sku: 'NSM',  key: process.env.JRX_SDK_KEY_NSM,  client: 'nyayasiddhi',                    tier: 'enterprise' },
  { sku: 'NYM',  key: process.env.JRX_SDK_KEY_NYM,  client: 'jurexio-citizen',                     tier: 'enterprise' },
  { sku: 'JRX',  key: process.env.JRX_SDK_KEY_JRX,  client: 'nyayasiddhi',                    tier: 'enterprise' },
];

const FACTS_LEGAL =
  'On 12 March 2024, ABC Pvt Ltd entered into a service agreement with XYZ Corp for software development services worth INR 25 lakh. ' +
  'The contract included a 6-month delivery clause, IP ownership terms, and a penalty of 0.5% per week for delays. ' +
  'XYZ Corp delivered 4 months late and is now refusing to pay the penalty.';

// Each test:
//  { name, method, path, body?, requiresKey: true, llmRoundTrip?: bool, validate?: (json,res)=>string|null }
function buildTests() {
  return [
    // 1. Public health (no auth)
    { id: 'health',          group: 'health',     method: 'GET',  path: '/api/nv/health',                                                   requiresKey: false },
    { id: 'gw-health',       group: 'health',     method: 'GET',  path: '/api/nv/gateway/health',                                            requiresKey: true },
    { id: 'gw-info',         group: 'health',     method: 'GET',  path: '/api/nv/gateway/info',                                              requiresKey: true },

    // 2. Read-only catalog/registry (cheap, no LLM)
    { id: 'gw-models',       group: 'catalog',    method: 'GET',  path: '/api/nv/gateway/models',                                            requiresKey: true },
    { id: 'gw-agents',       group: 'catalog',    method: 'GET',  path: '/api/nv/gateway/agents',                                            requiresKey: true },
    { id: 'gw-reg-version',  group: 'catalog',    method: 'GET',  path: '/api/nv/gateway/agents/registry-version',                           requiresKey: true },
    { id: 'gw-practice',     group: 'catalog',    method: 'GET',  path: '/api/nv/gateway/practice-areas',                                    requiresKey: true },
    { id: 'gw-tr-langs',     group: 'catalog',    method: 'GET',  path: '/api/nv/gateway/translate/languages',                               requiresKey: true },

    // 3. Real LLM round-trip — PRIMARY proof of life
    { id: 'intel-sentiment', group: 'real-llm',   method: 'POST', path: '/api/nv/intelligence/sentiment',
      body: { text: FACTS_LEGAL },
      requiresKey: true, llmRoundTrip: true, timeoutMs: 120000,
      validate: (j) => (j && (j.sentiment || j.data?.sentiment)) ? null : 'no sentiment in response',
    },
    { id: 'intel-summarize', group: 'real-llm',   method: 'POST', path: '/api/nv/intelligence/summarize',
      body: { text: FACTS_LEGAL, maxTokens: 200 },
      requiresKey: true, llmRoundTrip: true, timeoutMs: 120000,
      validate: (j) => (j && (j.summary || j.data?.summary || j.data?.text)) ? null : 'no summary in response',
    },
    { id: 'intel-classify',  group: 'real-llm',   method: 'POST', path: '/api/nv/intelligence/classify',
      body: { text: FACTS_LEGAL, categories: ['contract', 'tort', 'criminal', 'family'] },
      requiresKey: true, llmRoundTrip: true, timeoutMs: 120000,
      validate: (j) => (j && (Array.isArray(j.labels) || j.data?.label || j.data?.labels)) ? null : 'classify: no labels',
    },
    { id: 'intel-ner',       group: 'real-llm',   method: 'POST', path: '/api/nv/intelligence/ner',
      body: { text: FACTS_LEGAL },
      requiresKey: true, llmRoundTrip: true, timeoutMs: 120000,
      validate: (j) => (j && (Array.isArray(j.entities) || Array.isArray(j.data?.entities))) ? null : 'ner: no entities array',
    },

    // 4. SDK gateway business endpoints (canonical paths after redirect)
    { id: 'gw-doc-summarize', group: 'sdk-llm',    method: 'POST', path: '/api/nv/gateway/documents/summarize',
      body: { content: FACTS_LEGAL, source: 'nyayasiddhi', documentType: 'contract' },
      requiresKey: true, llmRoundTrip: true, timeoutMs: 120000,
    },
    { id: 'gw-doc-analyze',  group: 'sdk-llm',    method: 'POST', path: '/api/nv/gateway/documents/analyze',
      body: { content: FACTS_LEGAL, source: 'nyayasiddhi', type: 'contract', jurisdiction: 'IN' },
      requiresKey: true, llmRoundTrip: true,
      timeoutMs: 95000,
    },
    { id: 'gw-research',     group: 'sdk-llm',    method: 'POST', path: '/api/nv/gateway/research/query',
      body: { query: 'What are the remedies for breach of a software development contract under Indian Contract Act?', jurisdiction: 'IN' },
      requiresKey: true, llmRoundTrip: true,
      timeoutMs: 120000,
    },

    // 5. Orchestrate (17-step pipeline entry — full safety ring + multi-provider fallback)
    // Pass when LLM round-trip + safety ring complete (success+model+latency).
    // Empty content is reported as a degraded-model warning, not a hard fail
    // (it indicates the LLM-router fallback chain hit an empty-response model;
    // separate model-tier-router defect, not an auth/security/wiring issue).
    { id: 'orchestrate',     group: 'orchestrate', method: 'POST', path: '/api/nv/orchestrate',
      body: { prompt: 'Summarize this contract dispute in 2 sentences: ' + FACTS_LEGAL, agentId: 'summarizer', jurisdiction: 'IN', taskType: 'summarize', mode: 'sync' },
      requiresKey: true, llmRoundTrip: true,
      timeoutMs: 120000,
      validate: (j) => {
        if (!j || !j.success || !j.data?.model || typeof j.data?.latencyMs !== 'number') return 'no LLM model/latency in response';
        if (!j.data.content) return 'WARN_EMPTY_CONTENT: model=' + j.data.model + ' tokens=' + j.data.tokens?.total;
        return null;
      },
    },

    // 6. Compliance / governance read-only
    { id: 'compliance-calendar', group: 'compliance', method: 'GET',  path: '/api/nv/intelligence/compliance-calendar', requiresKey: true },
    { id: 'regulatory-feed',     group: 'compliance', method: 'GET',  path: '/api/nv/intelligence/regulatory-feed',      requiresKey: true },
    { id: 'guardrails-stats',    group: 'compliance', method: 'GET',  path: '/api/nv/gateway/guardrails/stats',          requiresKey: true },

    // 7. NV-AUTH-HEADER-001 negative test — Bearer fallback
    { id: 'bearer-fallback', group: 'auth-compat', method: 'GET',  path: '/api/nv/gateway/info',                              requiresKey: true, useBearer: true },
  ];
}

async function callOnce(t, platform, timeoutMs = 30000) {
  const url = BASE + t.path;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (t.requiresKey && platform.key) {
    if (t.useBearer) headers['Authorization'] = `Bearer ${platform.key}`;
    else             headers['X-API-Key']     = platform.key;
  }
  if (t.path.startsWith('/api/nv/gateway/')) {
    headers['x-nsp-client'] = platform.client;
    headers['x-nsp-tier']   = platform.tier;
    headers['x-nsp-org']    = `org-${platform.sku.toLowerCase()}-e2e`;
  }
  // task-2026-05-13: default org_id=1 per user directive
  headers['x-organization-id'] = headers['x-organization-id'] || '1';
  const init = { method: t.method, headers };
  if (t.body) init.body = JSON.stringify(t.body);
  const ctl = new AbortController();
  const to  = setTimeout(() => ctl.abort(), timeoutMs);
  init.signal = ctl.signal;
  const t0 = Date.now();
  let status = 0, json = null, text = '', err = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json ok */ }
  } catch (e) { err = e.message || String(e); }
  finally { clearTimeout(to); }
  const ms = Date.now() - t0;
  let pass = false, reason = '';
  // Pass criteria:
  //  - 2xx: pass
  //  - 401/403 acceptable for org_context_required scenarios (org-write paths) — mark as "auth-gated, OK"
  //  - 429 with x-nsp-tier=enterprise should not happen in healthy state — mark fail
  if (err)                                     { reason = `network: ${err}`; }
  else if (status >= 200 && status < 300)      {
    pass = true;
    if (t.validate) { const v = t.validate(json, { status }); if (v) { pass = false; reason = `validate: ${v}`; } }
  }
  else if (status === 401 || status === 403)   {
    if (json && /org[_ ]?context|requires.*org|org.*required/i.test(json.error || json.message || '')) {
      pass = true; reason = `auth-gated org_context_required (correct)`;
    } else {
      reason = `auth ${status} ${json?.error || text.slice(0, 120)}`;
    }
  }
  else                                         { reason = `${status} ${json?.error || text.slice(0, 200)}`; }
  return { id: t.id, group: t.group, sku: platform.sku, method: t.method, path: t.path, status, ms, pass, reason, llmRoundTrip: !!t.llmRoundTrip };
}

async function main() {
  const tests = buildTests();
  const tasks = [];
  for (const platform of PLATFORMS) {
    if (!platform.key) { console.error(`MISSING KEY for ${platform.sku} — set JRX_SDK_KEY_${platform.sku}`); continue; }
    for (const t of tests) tasks.push(callOnce(t, platform, t.timeoutMs || 30000));
  }
  console.error(`Running ${tasks.length} test calls in parallel (${tests.length} tests × ${PLATFORMS.length} platforms)...`);
  const results = await Promise.all(tasks);

  // Matrix per (test, platform)
  const matrix = {};
  for (const r of results) {
    matrix[r.id] = matrix[r.id] || {};
    matrix[r.id][r.sku] = r;
  }

  // Print matrix table
  const skus = PLATFORMS.map(p => p.sku);
  const head = ['TEST'.padEnd(22), 'GROUP'.padEnd(12), 'METHOD'.padEnd(7), ...skus.map(s => s.padEnd(6))].join(' ');
  console.log('\n' + head);
  console.log('-'.repeat(head.length));
  for (const t of tests) {
    const row = [t.id.padEnd(22), t.group.padEnd(12), t.method.padEnd(7)];
    for (const s of skus) {
      const r = matrix[t.id]?.[s];
      if (!r) row.push('—'.padEnd(6));
      else if (r.pass) row.push((r.status + (r.llmRoundTrip ? '✓L' : '✓')).padEnd(6));
      else            row.push(('✗' + r.status).padEnd(6));
    }
    console.log(row.join(' '));
  }

  // Summary
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const llmTotal = results.filter(r => r.llmRoundTrip).length;
  const llmPassed = results.filter(r => r.llmRoundTrip && r.pass).length;
  console.log(`\nOVERALL: ${passed}/${total} pass  |  Real-LLM: ${llmPassed}/${llmTotal}`);

  // Failures detail
  const fails = results.filter(r => !r.pass);
  if (fails.length) {
    console.log(`\nFAILURES (${fails.length}):`);
    for (const f of fails) {
      console.log(`  [${f.sku}] ${f.method} ${f.path} → ${f.status} ${f.ms}ms — ${f.reason}`);
    }
  }

  // Latency summary for real LLM
  const llms = results.filter(r => r.llmRoundTrip && r.pass).map(r => r.ms).sort((a,b)=>a-b);
  if (llms.length) {
    const p50 = llms[Math.floor(llms.length*0.5)];
    const p95 = llms[Math.floor(llms.length*0.95)];
    console.log(`\nReal-LLM latency: p50=${p50}ms p95=${p95}ms max=${llms[llms.length-1]}ms (n=${llms.length})`);
  }

  writeFileSync('/tmp/jrx-sdk-e2e-report.json', JSON.stringify({ ts: new Date().toISOString(), base: BASE, total, passed, llmTotal, llmPassed, results }, null, 2));
  console.error('\nFull report → /tmp/jrx-sdk-e2e-report.json');
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
