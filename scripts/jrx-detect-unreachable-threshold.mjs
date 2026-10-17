#!/usr/bin/env node
/**
 * NV-GUARDRAIL-UNREACHABLE-THRESHOLD-001 — catch filters that can never fire.
 *
 * This exact defect has now shipped TWICE and cost real money both times:
 *
 *   NV-RAG-CONF-001  `scoreConfidence` was arithmetically capped at 0.5484 and
 *                    then compared against a 0.55 re-retrieval threshold, so the
 *                    branch was unreachable and a second retrieval pass fired on
 *                    100 % of RAG requests.
 *   NV-MEM-DECAY-001 `decayScore` was clamped with `Math.max(MIN_DECAY_SCORE, x)`
 *                    and then filtered by `decayScore >= MIN_DECAY_SCORE`. The
 *                    clamp floor WAS the threshold, so the predicate was always
 *                    true and memory decay never removed anything.
 *
 * Both are invisible to the type checker and to ordinary tests, because the code
 * runs fine — it just silently always takes one branch. The shape is mechanical
 * and therefore checkable: a constant used as a clamp bound in `Math.max`/
 * `Math.min` AND as the right-hand side of a comparison in the same file is
 * almost always a tautology or a contradiction.
 *
 * Deliberately narrow to stay useful rather than noisy: only flags a NAMED
 * constant (not a literal) appearing in both roles. Reports and exits non-zero
 * only with --enforce, matching `jrx-detect-placeholders.mjs`.
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const ENFORCE = process.argv.includes('--enforce');
const EXTRA = process.argv.filter((a) => a.startsWith('--file=')).map((a) => a.slice(7));

/**
 * Strip comments before scanning. Without this the checker flags the very
 * comments that DOCUMENT a past defect — `graph-memory-service.ts` explains
 * NV-MEM-DECAY-001 by quoting `Math.max(MEMORY_DECAY_FLOOR, …)`, which is prose,
 * not a clamp.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * A clamp ASSIGNED to something: `x = Math.max(FLOOR, …)`. The assignment target
 * matters — `Math.min(RING_CAP, limit)` bounds `limit`, so it says nothing about
 * `ring.length`, and flagging `ring.length > RING_CAP` off the back of it is a
 * false positive. Only the clamped quantity itself has a guaranteed bound.
 */
const CLAMP_ASSIGN =
  /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*=\s*Math\.(max|min)\s*\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*,/g;
/** A comparison of a tracked quantity against a named constant. */
const COMPARE =
  /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*([><]=?)\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g;

/** Compare on the trailing identifier: the receiver is often a different loop var. */
const tail = (expr) => expr.split('.').pop();

function listFiles() {
  if (EXTRA.length) return EXTRA;
  const out = execSync(
    "git ls-files 'src/**/*.ts' | grep -v '\\.test\\.ts$' || true",
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return out.split('\n').filter(Boolean);
}

const findings = [];

for (const file of listFiles()) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!raw.includes('Math.max') && !raw.includes('Math.min')) continue;
  const src = stripComments(raw);

  // const name -> { kind, clamped: Set<trailing identifier> }
  const clamps = new Map();
  for (const m of src.matchAll(CLAMP_ASSIGN)) {
    const [, target, kind, constName] = m;
    const entry = clamps.get(constName) ?? { kind, clamped: new Set() };
    entry.kind = kind;
    entry.clamped.add(tail(target));
    clamps.set(constName, entry);
  }
  if (clamps.size === 0) continue;

  for (const m of src.matchAll(COMPARE)) {
    const [, lhs, op, constName] = m;
    const entry = clamps.get(constName);
    if (!entry) continue;
    // The bound only holds for the quantity that was actually clamped.
    if (!entry.clamped.has(tail(lhs))) continue;

    // Math.max(FLOOR, x) guarantees x >= FLOOR  -> `>= FLOOR` always true,
    //                                             `<  FLOOR` always false.
    // Math.min(CAP,   x) guarantees x <= CAP    -> `<= CAP`   always true,
    //                                             `>  CAP`   always false.
    const tautology =
      (entry.kind === 'max' && op === '>=') || (entry.kind === 'min' && op === '<=');
    const contradiction =
      (entry.kind === 'max' && op === '<') || (entry.kind === 'min' && op === '>');
    if (!tautology && !contradiction) continue;

    const line = src.slice(0, m.index).split('\n').length;
    findings.push({
      file,
      line,
      name: constName,
      kind: entry.kind,
      op,
      lhs,
      verdict: tautology ? 'ALWAYS TRUE' : 'ALWAYS FALSE',
      snippet: raw.split('\n')[line - 1]?.trim().slice(0, 120) ?? '',
    });
  }
}

if (findings.length === 0) {
  console.log('[guardrail:unreachable-threshold] OK — no clamp/threshold tautologies found');
  process.exit(0);
}

console.log(
  `[guardrail:unreachable-threshold] ${findings.length} suspected unreachable predicate(s):\n`,
);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    ${f.snippet}`);
  console.log(
    `    '${f.name}' is a Math.${f.kind}() bound AND the RHS of '${f.op}' -> predicate is ${f.verdict}`,
  );
  console.log(
    `    A clamp floor that equals its own threshold cannot be crossed. See NV-RAG-CONF-001 / NV-MEM-DECAY-001.\n`,
  );
}

if (ENFORCE) {
  console.error('[guardrail:unreachable-threshold] FAIL (--enforce)');
  process.exit(1);
}
console.log('[guardrail:unreachable-threshold] advisory only; run with --enforce to fail the build');
