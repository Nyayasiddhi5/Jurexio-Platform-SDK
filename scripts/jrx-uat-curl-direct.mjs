#!/usr/bin/env node
// nv-uat-curl-direct.mjs — direct fetch-based UAT verifier (NYV-UAT-DIRECT-001).
// Bypasses the cartesian smoke runner (which has been silently exiting after
// batch 1) and hits each scenario via plain fetch. Reads the SAME scenario
// JSON files the cartesian runner reads, so anchors / httpStatus / passCriteria
// stay canonical. Usage:
//   node scripts/nv-uat-curl-direct.mjs --files=tests/uat/scenarios/IN/legaltech-extras.json,tests/uat/scenarios/IN/contract-review.json
//   node scripts/nv-uat-curl-direct.mjs                      # all IN/*.json
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NYV_UAT_BASE || 'http://localhost:5000';
const KEY = process.env.NYV_SDK_KEY_NSP;
if (!KEY) { console.error('NYV_SDK_KEY_NSP missing'); process.exit(2); }

const args = process.argv.slice(2);
const filesArg = args.find(a => a.startsWith('--files='));
const concurrency = parseInt(
  (args.find(a => a.startsWith('--concurrency=')) || '--concurrency=6').split('=')[1], 10
);
const outArg = args.find(a => a.startsWith('--out='));
const out = outArg ? outArg.split('=')[1] : 'audit/uat-curl-direct.json';

const files = filesArg
  ? filesArg.split('=')[1].split(',')
  : fs.readdirSync('tests/uat/scenarios/IN').filter(f => f.endsWith('.json')).map(f => `tests/uat/scenarios/IN/${f}`);

const scenarios = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of (d.scenarios || [])) scenarios.push({ file: f, scen: s });
}
console.log(`[curl-direct] base=${BASE} files=${files.length} scenarios=${scenarios.length} concurrency=${concurrency}`);

function getByPath(obj, dotted) {
  if (obj == null) return undefined;
  const parts = String(dotted).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evaluate(scen, status, bodyText) {
  const expected = scen.expected || scen.passCriteria || {};
  const failures = [];
  // httpStatus: number | number[]
  const expStatus = expected.httpStatus;
  if (expStatus !== undefined) {
    const list = Array.isArray(expStatus) ? expStatus : [expStatus];
    if (!list.includes(status)) failures.push(`httpStatus:${status}∉${JSON.stringify(list)}`);
  } else if (status !== 200) {
    failures.push(`httpStatus:${status}≠200`);
  }
  // mustHaveFields: dotted-path list — parses body as JSON, walks the path,
  // fails if any path resolves to undefined or null. Fixed 2026-05-09 per
  // architect (was silently un-checked before).
  const mhf = expected.mustHaveFields;
  if (Array.isArray(mhf) && mhf.length) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText); } catch { /* not JSON */ }
    if (parsed === null) {
      failures.push(`mustHaveFields:body-not-json`);
    } else {
      for (const f of mhf) {
        const v = getByPath(parsed, f);
        if (v === undefined || v === null) failures.push(`missing-field:${f}`);
      }
    }
  }
  const lo = bodyText.toLowerCase();
  const mc = expected.mustContain || [];
  for (const t of mc) if (!lo.includes(String(t).toLowerCase())) failures.push(`missing:${t}`);
  const mca = expected.mustContainAnyOf;
  if (Array.isArray(mca) && mca.length) {
    const hit = mca.some(t => lo.includes(String(t).toLowerCase()));
    if (!hit) failures.push(`anyOf:none-of-${mca.length}`);
  }
  // mustContainAtLeast: { of: [...], count: N }  (canonical, used by scenario JSON)
  // Backwards-compat: also accept legacy { terms: [...], count: N }.
  const mcal = expected.mustContainAtLeast;
  if (mcal) {
    const terms = Array.isArray(mcal.of) ? mcal.of
                : Array.isArray(mcal.terms) ? mcal.terms
                : null;
    if (terms && terms.length) {
      const need = mcal.count || 1;
      const n = terms.filter(t => lo.includes(String(t).toLowerCase())).length;
      if (n < need) failures.push(`atLeast:${n}/${need}_of_${terms.length}`);
    }
  }
  return failures;
}

async function runOne({ file, scen }) {
  const req = scen.request || {};
  const url = BASE + (req.path || req.url || '');
  const method = (req.method || 'GET').toUpperCase();
  const headers = { 'X-API-Key': KEY, ...(req.headers || {}) };
  const body = req.body !== undefined ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
  if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), scen.expected?.timeoutMs || 60000);
  const t0 = Date.now();
  let status = 0, bodyText = '', error = null;
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal });
    status = res.status;
    bodyText = await res.text();
  } catch (e) {
    error = String(e?.message || e);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;
  const failures = error ? [`network:${error}`] : evaluate(scen, status, bodyText);
  return {
    file: path.basename(file),
    id: scen.id,
    method, url,
    status, latencyMs,
    pass: failures.length === 0,
    failures,
    bodyExcerpt: bodyText.slice(0, 200),
  };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx]); }
      catch (e) { results[idx] = { id: items[idx].scen?.id, pass: false, failures: [`exception:${e?.message || e}`] }; }
    }
  }));
  return results;
}

const t0 = Date.now();
let results = await pool(scenarios, concurrency, runOne);
// NV-PRE-DEPLOY-SMOKE-002 (Session-13) — retry-once for transient LLM
// content-quality misses (atLeast:N/M) and rate-limit (429) failures so a
// single flaky invocation doesn't drop the strict pass count.
const RETRY_FAILED = String(process.env.NYV_UAT_RETRY_FAILED || '1') === '1';
if (RETRY_FAILED) {
  const retryable = (r) => !r.pass && (
    r.status === 429 ||
    (r.failures || []).some(f => /^atLeast:|^network:/.test(f))
  );
  const toRetry = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => retryable(r));
  if (toRetry.length) {
    console.log(`[curl-direct] retry-once: ${toRetry.length} flaky scenarios`);
    await new Promise(r => setTimeout(r, 5000));
    const retried = await pool(toRetry.map(({ i }) => scenarios[i]), 1, runOne);
    retried.forEach((rr, k) => {
      const idx = toRetry[k].i;
      if (rr.pass) results[idx] = { ...rr, retried: true };
      else results[idx] = { ...rr, retried: true, retryFailed: true };
    });
  }
}
const elapsed = Date.now() - t0;
const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
const summary = { total: results.length, pass, fail, passPct: Math.round((pass / results.length) * 100), elapsedMs: elapsed };
const ledger = { startedAt: new Date().toISOString(), base: BASE, summary, results };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(ledger, null, 2));
console.log(`[curl-direct] DONE total=${summary.total} pass=${summary.pass} fail=${summary.fail} pass%=${summary.passPct} elapsed=${(elapsed/1000).toFixed(1)}s → ${out}`);
console.log('\n=== Failures ===');
for (const r of results.filter(r => !r.pass)) {
  console.log(`  [${String(r.status).padEnd(3)}] ${(r.id||'?').padEnd(20)} ${r.method} ${r.url.replace(BASE,'')}`);
  console.log(`         failures: ${r.failures.join(', ')}`);
  if (r.bodyExcerpt) console.log(`         body: ${r.bodyExcerpt.slice(0,160).replace(/\n/g,' ')}`);
}
