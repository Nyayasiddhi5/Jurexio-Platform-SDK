#!/usr/bin/env node
/**
 * NV-REAL-DATA-002 — flags console pages that still ship hardcoded KPI / fake API key rows.
 * Run: node scripts/jrx-console-live-data-audit.mjs
 * CI: npm run guardrail:console-live-data
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PAGES = join(ROOT, 'client/src/pages');

const BANNED_PATTERNS = [
  { id: 'fake-api-key-row', re: /nyv_live_sk_/ },
  { id: 'static-grpo-score', re: /jrx-agent-001.*12,450|12,450 episodes/ },
  { id: 'hardcoded-mcp-53', re: /['"]53['"].*MCP|MCP Tools Live['"].*value:\s*['"]53['"]/ },
  { id: 'hardcoded-2.4M-calls', re: /2\.4M/ },
  { id: 'initPlatforms-array', re: /initPlatforms\s*=\s*\[/ },
  { id: 'static-hallucination-kpi', re: /Hallucination Rate['"].*value:\s*['"]0\.8%/ },
  { id: 'static-citation-kpi', re: /Citation Accuracy['"].*value:\s*['"]97\.4%/ },
  { id: 'static-llm-340ms', re: /Avg Response['"].*value:\s*['"]340ms/ },
  { id: 'static-rag-106ms', re: /Total RAG Latency['"].*~106ms/ },
];

const ALLOWLIST = new Set([
  'sdk-key-management.tsx', // may display masked key prefixes by design
  'sdk-playground.tsx',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(PAGES)) {
  const base = file.split('/').pop();
  if (ALLOWLIST.has(base)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { id, re } of BANNED_PATTERNS) {
    if (re.test(text)) hits.push({ file: file.replace(ROOT + '/', ''), id });
  }
}

if (hits.length) {
  console.error('jrx-console-live-data-audit: FAIL');
  for (const h of hits) console.error(`  [${h.id}] ${h.file}`);
  process.exit(1);
}
console.log('jrx-console-live-data-audit: PASS (no banned static patterns in console pages)');
