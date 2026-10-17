#!/usr/bin/env npx tsx
/**
 * nv-seed-demo-full.ts — India-then-USA multitenant demo seed orchestrator.
 * Chains existing seed scripts for Console walkthroughs (HITL, compliance,
 * RAG, ops, GRPO, demo tenants). Does not invent data — delegates to nv-seed-*.
 *
 * Usage (from nyayavigya-platform-312/):
 *   NV_DEMO_PASSWORD=… npx tsx scripts/jrx-seed-demo-full.ts
 *   npm run seed:demo-full
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STEPS: Array<{ name: string; script: string; optional?: boolean }> = [
  { name: 'core-seed-all', script: 'scripts/jrx-seed-all.ts' },
  { name: 'models', script: 'scripts/jrx-seed-models.ts', optional: true },
  { name: 'demo-tenants-IN-US', script: 'scripts/jrx-seed-demo-tenants.ts' },
  { name: 'uat-platform-users', script: 'scripts/jrx-seed-uat-platform-users.ts' },
  { name: 'policies', script: 'scripts/jrx-seed-policies.ts', optional: true },
  { name: 'compliance-catalog', script: 'scripts/jrx-seed-compliance-catalog.ts', optional: true },
  { name: 'compliance-evidence', script: 'scripts/jrx-seed-compliance-evidence.ts', optional: true },
  { name: 'hitl-and-ops', script: 'scripts/jrx-seed-hitl-and-ops.ts', optional: true },
  { name: 'activity-and-hitl', script: 'scripts/jrx-seed-activity-and-hitl.ts', optional: true },
  { name: 'rag-starter-IN', script: 'scripts/jrx-seed-rag-starter.ts', optional: true },
  { name: 'rag-collections', script: 'scripts/jrx-seed-rag-collections.ts', optional: true },
  { name: 'operations-history', script: 'scripts/jrx-seed-operations-history.ts', optional: true },
  { name: 'audit-chain-demo', script: 'scripts/jrx-seed-audit-chain-demo.ts', optional: true },
  { name: 'grpo-demo', script: 'scripts/jrx-seed-grpo-demo.ts', optional: true },
  { name: 'firm-snapshot', script: 'scripts/jrx-seed-firm-snapshot-demo.ts', optional: true },
];

function run(step: (typeof STEPS)[number]): boolean {
  const full = path.join(root, step.script);
  console.log(`\n==> ${step.name} (${step.script})`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', full], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    if (step.optional) {
      console.warn(`WARN optional step failed: ${step.name} (exit ${r.status})`);
      return true;
    }
    console.error(`FAIL required step: ${step.name}`);
    return false;
  }
  return true;
}

async function main() {
  if (!process.env.NV_DEMO_PASSWORD && !process.env.UAT_ADMIN_PASSWORD) {
    console.warn('WARN: set NV_DEMO_PASSWORD for user seed passwords');
  }
  for (const step of STEPS) {
    if (!run(step)) process.exit(1);
  }
  console.log('\nDONE seed:demo-full — enable NYV_F_HITL_REGISTRY / NYV_F_GOV_* / NYV_F_COMPLIANCE_* on UAT for gated panels.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
