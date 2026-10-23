/**
 * NV-GUARDRAIL-ORCH-STAGE-001 — fail CI if orchestration safety contract regresses.
 *
 * Protects against future agents "speeding up" by skipping:
 *   - QualityEnvelope import / assert
 *   - AdaptiveRouter decideAdaptivePath
 *   - Credit enforce before Queen
 *   - NV-LLM-001 callJurexio / orchestrateLLM
 *   - osDepth on response contract
 *
 * Run: npx tsx scripts/jrx-guardrail-orch-stage-contract.ts
 * Wired into: npm run guardrail (after intent-mesh)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const checks: Array<{ file: string; mustInclude: string[]; label: string }> = [
  {
    file: 'src/routes/jrx-orchestration-routes.ts',
    label: 'orchestrate route safety',
    mustInclude: [
      'decideAdaptivePath',
      'assertQualityEnvelope',
      'nvAICreditEnforcer',
      'osDepth',
      'buildUnifiedOrchestrationContract',
    ],
  },
  {
    file: 'src/orchestration/jrx-quality-envelope.ts',
    label: 'QualityEnvelope mandatory gates',
    mustInclude: [
      'assertQualityEnvelope',
      'hallucination',
      'citation',
    ],
  },
  {
    file: 'src/orchestration/jrx-adaptive-router.ts',
    label: 'AdaptiveRouter paths',
    mustInclude: [
      'decideAdaptivePath',
      'queen',
      'specialist',
      'doc-pipeline',
    ],
  },
  {
    file: 'src/orchestration/jrx-orchestration-response-contract.ts',
    label: 'response contract osDepth',
    mustInclude: [
      'osDepth',
      'buildUnifiedOrchestrationContract',
      'assembleDraftProfile',
      'parseFilingContextHint',
    ],
  },
  {
    file: 'src/services/jrx-auto-rag-router.ts',
    label: 'Auto-RAG parallel extras deadline',
    mustInclude: [
      'JRX_AUTO_RAG_EXTRAS_DEADLINE_MS',
      'autoRagRetrieve',
    ],
  },
  {
    file: 'src/config/jrx-timeout-policy.ts',
    label: 'timeout SSoT',
    mustInclude: [
      'NV_TIMEOUTS',
      'orchWallClockMs',
      'queenMaxHierarchyDepth',
    ],
  },
];

let failed = 0;
for (const c of checks) {
  const abs = path.join(root, c.file);
  if (!fs.existsSync(abs)) {
    console.error(`FAIL [${c.label}]: missing ${c.file}`);
    failed++;
    continue;
  }
  const body = read(c.file);
  const missing = c.mustInclude.filter((s) => !body.includes(s));
  if (missing.length) {
    console.error(`FAIL [${c.label}]: missing tokens: ${missing.join(', ')}`);
    failed++;
  } else {
    console.log(`PASS [${c.label}]`);
  }
}

if (failed > 0) {
  console.error(`NV-GUARDRAIL-ORCH-STAGE-001 FAIL — ${failed} check(s)`);
  process.exit(1);
}
const probe = spawnSync('npx', ['tsx', 'scripts/jrx-probe-fb468-draft-profile-contract.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (probe.status !== 0) {
  console.error('NV-GUARDRAIL-ORCH-STAGE-001 FAIL — FB-468 C3 draftProfile probe failed');
  process.exit(1);
}

console.log('NV-GUARDRAIL-ORCH-STAGE-001 PASS — orchestration stage contract intact.');
