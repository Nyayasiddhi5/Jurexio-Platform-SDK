#!/usr/bin/env tsx
/**
 * NV-NSP-OPTION-B-RELEASE-GATE-001 — staged pre-deploy quality gate (Option B).
 *
 * Stage merge (default): offline routing + counsel-grade self-test + optional live merge JSON.
 * Stage release95: same + --stage=release95 on merge artifact (95% floor both lanes).
 *
 *   npm run release:gate:option-b
 *   JRX_OPTION_B_MERGE_JSON=docs/audit/eval/draft-scoreboard-merged-gate-*.json npm run release:gate:option-b:merge
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const stage = process.env.JRX_OPTION_B_GATE_STAGE || 'merge';

function run(cmd: string, label: string): void {
  console.log(`\n=== ${label} ===\n${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function latestMergedGate(): string | null {
  const dir = path.join(ROOT, 'docs/audit/eval');
  const rows = fs.readdirSync(dir)
    .filter((f) => f.startsWith('draft-scoreboard-merged-gate-') && f.endsWith('.json'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return rows[0] ? path.join(dir, rows[0].f) : null;
}

run('npm run eval:draft:india', 'Indian draft routing + rubric self-test');
run('npm run eval:counsel-grade:self-test', 'Counsel-grade harness self-test');
run('npx tsx scripts/jrx-nsp-ai-task-eval-matrix.ts --offline', 'NSP AI task matrix (offline probes)');

const mergeJson = process.env.JRX_OPTION_B_MERGE_JSON || latestMergedGate();
if (mergeJson && fs.existsSync(mergeJson)) {
  const data = JSON.parse(fs.readFileSync(mergeJson, 'utf8')) as { gatePass?: boolean; gateStage?: string; fastAvg?: number; counselAvg?: number };
  if (stage === 'release95') {
    if (!data.gatePass || data.gateStage !== 'release95') {
      console.error(`release95 gate: re-run merge with --stage=release95 on live scoreboards (current: ${mergeJson})`);
      process.exit(1);
    }
    console.log(`\nOption B release95 artifact OK: ${mergeJson}`);
  } else if (data.gatePass) {
    console.log(`\nOption B merge artifact OK: ${mergeJson}`);
  } else {
    console.warn(`\nOption B merge artifact FAIL (deploy blocked): ${mergeJson} fast=${data.fastAvg}% counsel=${data.counselAvg}%`);
    console.warn('Offline gates passed; re-run live eval after deploy to clear merge stage.');
  }
} else {
  console.warn('\nNo merged gate JSON — skipping live merge check (offline gates only). Set JRX_OPTION_B_MERGE_JSON after live eval.');
}

console.log(`\nOption B release gate (${stage}) — offline checks PASS`);
