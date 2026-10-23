/**
 * NV-MODEL-CATALOG-AUDIT-001 — one-shot audit of the LLM cascade.
 *
 * Answers a question the boot validator only answers as pass/fail: which of the
 * models we believe we have are actually resolvable in the catalog, and which
 * cascade entries point at ids that do not exist (NV-CASCADE-DRIFT-001).
 *
 * Read-only. Safe to run anywhere; does not call any provider.
 *
 * Usage: npx tsx scripts/jrx-audit-model-cascade.ts
 */
import { validateCascadeModelIds } from '../src/services/intelligent-router/jrx-cascade-validator.js';

function main(): void {
  const report = validateCascadeModelIds() as unknown as Record<string, unknown>;

  console.log('');
  console.log('NV-MODEL-CATALOG-AUDIT-001 — cascade model id resolution');
  console.log('='.repeat(78));
  console.log('');
  console.log('Report keys:', Object.keys(report).join(', '));
  console.log('');
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}

main();
