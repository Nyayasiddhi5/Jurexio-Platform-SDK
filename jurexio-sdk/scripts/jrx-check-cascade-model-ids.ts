/**
 * NV-CASCADE-DEAD-RUNG-001 (CI guardrail) — every model id in every cascade ladder must
 * resolve in the model catalog.
 *
 * Why this needs to be CI and not just a boot check: `validateCascadeModelIds()` has
 * existed for months and a boot-time warning is easy to miss in a busy log. Two dead
 * rungs shipped anyway and were only found by an architecture audit —
 * `anthropic/claude-sonnet-4-6` (no catalog entry, no alias) in three ladders, and
 * `omniroute/auto` (catalog has only `/auto/{reliable,cheap,free}`).
 *
 * A dead rung is worse than a missing one. It is reached exactly when the preceding
 * models have already failed, so it burns a resolution attempt at the moment the system
 * is already degraded, and it silently shortens a ladder the operator believes is longer.
 *
 * Availability-gated ids (e.g. `sarvam-*` without `SARVAM_API_KEY`) are NOT failures —
 * they exist in the catalog and are filtered at runtime by design. This guardrail only
 * fails on ids that can never resolve.
 */
import { validateCascadeModelIds } from '../src/services/intelligent-router/jrx-cascade-validator.js';

const report = validateCascadeModelIds();

const label = 'NV-CASCADE-DEAD-RUNG-001';
if (report.ok) {
  console.log(
    `  ✓ ${label}: all cascade model ids resolve (${report.idsChecked} ids across ${report.laddersChecked} ladders).`,
  );
  process.exit(0);
}

console.error(`  ✗ ${label}: cascade contains model ids that do not resolve in the catalog.\n`);
for (const issue of report.issues) {
  console.error(`    [${issue.kind}] ${issue.detail}  — ${issue.context}`);
}
console.error(`
    A dead rung is reached only after earlier models fail, so it wastes an attempt
    while the system is already degraded and silently shortens the ladder.

    Fix: either add the model to src/services/intelligent-router/model-catalog.ts
    (with an alias if it is a rename), or remove the id from the ladder.
`);
process.exit(1);
