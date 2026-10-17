#!/usr/bin/env node
/**
 * NV-MSG-GUARDRAIL — catalog migration tracker (incremental, non-blocking on legacy).
 *
 * - FAIL: files in MIGRATED still emit raw `{ success:false, error }` responses
 * - WARN: legacy backlog count (bulk migration tracked separately)
 *
 * Run: node scripts/jrx-message-catalog-guardrail.mjs
 * CI:  npm run guardrail:message-catalog
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ROUTES = join(ROOT, 'src/routes');

/** Fully migrated — guardrail enforces catalog-only errors. */
const MIGRATED = new Set([
  'nv5/_auth.ts',
  '_nv5-orch-auth.ts',
  'jrx-statutes-routes.ts',
  'jrx-ecosystem-document-routes.ts',
  'jrx-auth-routes.ts',
  'jrx-feature-flags-routes.ts',
  'jrx-shared-docs-routes.ts',
  'jrx-api-keys-routes.ts',
  'jrx-my-approvals-routes.ts',
  'jrx-rag-audit-routes.ts',
  'jrx-universal-chat-routes.ts',
  'jrx-gateway-routes.ts',
  'jrx-completions-routes.ts',
  'jrx-orchestration-routes.ts',
  'jrx-user-profile-routes.ts',
  'jrx-rag-routes.ts',
  'jrx-rls-routes.ts',
  'jrx-web-scraper-routes.ts',
  'jrx-iso-compliance-routes.ts',
  'jrx-jrx-legal-tools-routes.ts',
  'jrx-agent-routes.ts',
]);

const RAW_ERROR_RE = /res\.status\(\d+\)\.json\(\{\s*success:\s*false,\s*error:/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const failures = [];
let legacyRawTotal = 0;
let legacyFiles = 0;

for (const file of walk(ROUTES)) {
  const rel = file.replace(ROUTES + '/', '');
  const text = readFileSync(file, 'utf8');
  const rawMatches = text.match(RAW_ERROR_RE);
  if (!rawMatches?.length) continue;
  if (MIGRATED.has(rel)) {
    failures.push({ rel, raw: rawMatches.length });
    continue;
  }
  legacyFiles += 1;
  legacyRawTotal += rawMatches.length;
}

if (legacyFiles) {
  console.log(`jrx-message-catalog-guardrail: legacy backlog ${legacyRawTotal} raw errors across ${legacyFiles} route files (bulk migration open)`);
}

if (failures.length) {
  console.error('jrx-message-catalog-guardrail: FAIL — migrated routes still use raw errors');
  for (const f of failures) console.error(`  [fail] ${f.rel} (${f.raw} raw)`);
  process.exit(1);
}

console.log('jrx-message-catalog-guardrail: PASS (migrated routes catalog-clean)');
