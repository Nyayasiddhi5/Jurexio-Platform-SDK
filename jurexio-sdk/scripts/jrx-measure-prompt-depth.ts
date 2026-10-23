/**
 * NV-AGENT-PROMPT-DEPTH-001 — measure the real token cost of each depth rung
 * against a genuine registry agent prompt, not a synthetic fixture.
 *
 * Run: npx tsx scripts/jrx-measure-prompt-depth.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseAgentPromptBundle,
  buildActiveAgentLayer,
  resolveAgentPromptDepth,
} from '../src/services/jrx-agent-prompt-bundle.js';

const tok = (s: string) => Math.ceil(s.length / 4);

const registryPath = path.join(process.cwd(), 'src', 'data', './jrx-agents-registry.json');
if (!fs.existsSync(registryPath)) {
  console.error(`registry not found at ${registryPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const agents: any[] = Array.isArray(raw) ? raw : (raw.agents || []);
const withXml = agents.filter(a => typeof a?.systemPrompt === 'string'
  && a.systemPrompt.includes('<section_1_identity>'));

console.log(`agents in registry: ${agents.length}`);
console.log(`agents with XML constitution: ${withXml.length}\n`);

const rows: Array<Record<string, number>> = [];
for (const a of withXml) {
  const b = parseAgentPromptBundle(a.systemPrompt, a.id || 'unknown');
  rows.push({
    full: tok(b.full),
    core: tok(buildActiveAgentLayer(b, { depth: 'core' })),
    standard: tok(buildActiveAgentLayer(b, { depth: 'standard' })),
    full_quality: tok(buildActiveAgentLayer(b, { depth: 'full_quality' })),
  });
}

const avg = (k: string) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
const max = (k: string) => Math.max(...rows.map(r => r[k]));

console.log('mean tokens per rung (across all XML agents):');
for (const k of ['core', 'standard', 'full_quality', 'full']) {
  console.log(`  ${k.padEnd(13)} mean=${String(avg(k)).padStart(6)}  max=${String(max(k)).padStart(6)}`);
}

console.log('\ndelta vs previous behaviour (core was what partner traffic got):');
console.log(`  standard      +${avg('standard') - avg('core')} tok mean`);
console.log(`  full_quality  +${avg('full_quality') - avg('core')} tok mean`);
console.log(`  (turn1_full blob would have been +${avg('full') - avg('core')} tok — the all-or-nothing alternative)`);

console.log('\nrung selected per task class, with that class\'s prompt budget:');
for (const [cls, budget] of [
  ['micro_faq', 600], ['classify', 1_200], ['chat', 2_500],
  ['research', 8_000], ['drafting', 24_000],
] as Array<[string, number]>) {
  const depth = resolveAgentPromptDepth({ taskClass: cls, maxPromptTokens: budget });
  const cost = avg(depth);
  const pct = ((cost / budget) * 100).toFixed(0);
  console.log(`  ${cls.padEnd(10)} budget=${String(budget).padStart(6)}  depth=${depth.padEnd(13)} promptCost≈${String(cost).padStart(5)} (${pct}% of budget)`);
}
