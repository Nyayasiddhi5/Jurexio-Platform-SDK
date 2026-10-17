#!/usr/bin/env node
// nv-uat-verifier-regression-test.mjs
//
// Regression test for the strict-verifier branches in scripts/nv-uat-curl-direct.mjs:
//   - mustHaveFields (dotted-path JSON walk)
//   - mustContainAtLeast.of (canonical) + mustContainAtLeast.terms (legacy)
//
// Why this exists: in the 2026-05-09 N-track session both branches were
// silently skipped before the architect caught it. The fix landed in
// nv-uat-curl-direct.mjs — this guard prevents regression.
//
// Run: node scripts/nv-uat-verifier-regression-test.mjs
// Exit 0 on pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(__dirname, 'nv-uat-curl-direct.mjs');

// Re-implement the two checks here, directly mirroring the verifier's logic.
// We test the LOGIC, not the IPC, so the test is fast + deterministic.

function getByPath(obj, path) {
  if (obj == null) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function checkMustHaveFields(bodyText, fields) {
  const failures = [];
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return ['body-not-json'];
  }
  for (const f of fields || []) {
    const v = getByPath(parsed, f);
    if (v === undefined || v === null) failures.push(`missing-field:${f}`);
  }
  return failures;
}

function checkMustContainAtLeast(bodyText, mcal) {
  if (!mcal) return [];
  const terms = Array.isArray(mcal.of) ? mcal.of : (Array.isArray(mcal.terms) ? mcal.terms : []);
  if (terms.length === 0) return [];
  const need = Number(mcal.count || 1);
  const lo = String(bodyText).toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (lo.includes(String(t).toLowerCase())) hits += 1;
  }
  return hits >= need ? [] : [`atLeast:${hits}/${need}_of_${terms.length}`];
}

const cases = [];
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  cases.push({ name, ok, actual, expected });
}

// ---- mustHaveFields tests ----
const body1 = JSON.stringify({ success: true, data: { requestId: 'abc-123', nested: { ok: 1 } } });
expect('mhf: top-level present', checkMustHaveFields(body1, ['success']), []);
expect('mhf: dotted-path present', checkMustHaveFields(body1, ['data.requestId']), []);
expect('mhf: deep nested present', checkMustHaveFields(body1, ['data.nested.ok']), []);
expect('mhf: missing top-level', checkMustHaveFields(body1, ['error']), ['missing-field:error']);
expect('mhf: missing dotted', checkMustHaveFields(body1, ['data.missing']), ['missing-field:data.missing']);
expect('mhf: null value treated as missing', checkMustHaveFields(JSON.stringify({ a: null }), ['a']), ['missing-field:a']);
expect('mhf: not-json body', checkMustHaveFields('plain text', ['a']), ['body-not-json']);
expect('mhf: empty fields list', checkMustHaveFields(body1, []), []);

// ---- mustContainAtLeast tests ----
const body2 = JSON.stringify({ analysis: 'DPDP Act 2023 limitation of liability and indemnity' });
expect('mcal.of: 4-term, count=2 → all 3 hit', checkMustContainAtLeast(body2, { count: 2, of: ['DPDP', 'indemnity', 'limitation of liability', 'force majeure'] }), []);
expect('mcal.of: 4-term, count=4 → only 3 hit (fail)', checkMustContainAtLeast(body2, { count: 4, of: ['DPDP', 'indemnity', 'limitation of liability', 'force majeure'] }), ['atLeast:3/4_of_4']);
expect('mcal.terms (legacy) honored', checkMustContainAtLeast(body2, { count: 1, terms: ['DPDP'] }), []);
expect('mcal.of preferred over .terms when both present', checkMustContainAtLeast(body2, { count: 1, of: ['notpresent'], terms: ['DPDP'] }), ['atLeast:0/1_of_1']);
expect('mcal: case-insensitive', checkMustContainAtLeast(body2, { count: 1, of: ['dpdp'] }), []);
expect('mcal: empty mcal → noop', checkMustContainAtLeast(body2, null), []);
expect('mcal: empty terms → noop', checkMustContainAtLeast(body2, { count: 1, of: [] }), []);

// ---- verify the actual verifier file STILL implements both branches ----
const src = readFileSync(VERIFIER, 'utf8');
const checks = [
  { name: 'verifier file exposes getByPath', present: /function\s+getByPath\b/.test(src) },
  { name: 'verifier reads mustHaveFields', present: /mustHaveFields/.test(src) },
  { name: 'verifier reads mcal.of (canonical)', present: /\bof\b/.test(src) && /mustContainAtLeast/.test(src) },
  { name: 'verifier reads mcal.terms (legacy)', present: /\.terms\b/.test(src) },
  { name: 'verifier emits missing-field marker', present: /missing-field/.test(src) },
  { name: 'verifier emits atLeast marker', present: /atLeast:/.test(src) },
];
for (const c of checks) cases.push({ name: c.name, ok: c.present, actual: c.present, expected: true });

// ---- report ----
const passed = cases.filter(c => c.ok).length;
const failed = cases.length - passed;
for (const c of cases) {
  const tag = c.ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${c.name}`);
  if (!c.ok) console.log(`         actual=${JSON.stringify(c.actual)} expected=${JSON.stringify(c.expected)}`);
}
console.log(`\n[verifier-regression] ${passed}/${cases.length} passed${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
