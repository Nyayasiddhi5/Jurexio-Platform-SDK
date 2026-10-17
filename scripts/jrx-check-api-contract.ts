/**
 * jrx-check-api-contract.ts
 * JRX-API-CONTRACT-001 (2026-05-10)
 *
 * Backward-compatibility guardrail for the published HTTP API.
 *
 * What it does:
 *   1. Regenerates the current OpenAPI snapshot in-memory using the same
 *      static walker as `scripts/generate-openapi-spec.ts`.
 *   2. Diffs the live (method, path) set against the committed baseline at
 *      `docs/openapi/jurexio-v5.openapi.json`.
 *   3. FAILS (exit 1) if ANY (method, path) present in the baseline is
 *      missing from current — that is a breaking change for live SDK clients.
 *   4. PASSES on additions — backward-compatible by design.
 *   5. Reports counts of additions / removals / unchanged.
 *
 * To intentionally remove a route (e.g. real deprecation past sunset):
 *   1. Regenerate baseline:   npx tsx scripts/generate-openapi-spec.ts
 *   2. Commit the new baseline in the SAME PR as the route removal, with a
 *      changelog entry referencing the version-bump.
 *
 * This is the third jrx-check guardrail (joins auth-header + script-db).
 * Run via: npm run guardrail:api-contract
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'docs', 'openapi', 'jurexio-v5.openapi.json');

interface OpenAPIDoc {
  paths?: Record<string, Record<string, unknown>>;
  info?: { title?: string; version?: string };
}

function loadBaseline(): OpenAPIDoc {
  if (!fs.existsSync(BASELINE)) {
    console.error(`[NV-API-CONTRACT] baseline missing at ${BASELINE}`);
    console.error('  Bootstrap with: npx tsx scripts/generate-openapi-spec.ts && git add docs/openapi/');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as OpenAPIDoc;
}

function regenerateLive(): OpenAPIDoc {
  // Run the existing generator into a tmp file so we don't clobber the
  // committed baseline during a check. The generator always writes to
  // docs/openapi/jurexio-v5.openapi.json, so we snapshot+restore.
  const backup = fs.readFileSync(BASELINE);
  try {
    execFileSync('npx', ['tsx', path.join(ROOT, 'scripts', 'generate-openapi-spec.ts')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const live = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as OpenAPIDoc;
    return live;
  } finally {
    // restore baseline so the check is non-destructive
    fs.writeFileSync(BASELINE, backup);
  }
}

function flatten(doc: OpenAPIDoc): Set<string> {
  const out = new Set<string>();
  for (const [p, methods] of Object.entries(doc.paths ?? {})) {
    for (const m of Object.keys(methods ?? {})) {
      out.add(`${m.toUpperCase()} ${p}`);
    }
  }
  return out;
}

function main(): void {
  console.log('[NV-API-CONTRACT] regenerating live OpenAPI snapshot…');
  const live = regenerateLive();
  const baseline = loadBaseline();

  const liveOps = flatten(live);
  const baseOps = flatten(baseline);

  const removed: string[] = [];
  for (const op of baseOps) if (!liveOps.has(op)) removed.push(op);

  const added: string[] = [];
  for (const op of liveOps) if (!baseOps.has(op)) added.push(op);

  const unchanged = liveOps.size - added.length;

  console.log(`[NV-API-CONTRACT] baseline:  ${baseOps.size} operations`);
  console.log(`[NV-API-CONTRACT] live:      ${liveOps.size} operations`);
  console.log(`[NV-API-CONTRACT] unchanged: ${unchanged}`);
  console.log(`[NV-API-CONTRACT] added:     ${added.length} (allowed — backward compatible)`);
  console.log(`[NV-API-CONTRACT] removed:   ${removed.length}`);

  if (added.length > 0 && added.length <= 25) {
    console.log('  Additions:');
    for (const op of added.sort()) console.log(`    + ${op}`);
  } else if (added.length > 25) {
    console.log(`  Additions (first 25 of ${added.length}):`);
    for (const op of added.sort().slice(0, 25)) console.log(`    + ${op}`);
  }

  if (removed.length > 0) {
    console.error('');
    console.error('[NV-API-CONTRACT] ✗ BREAKING CHANGE — operations removed from published API:');
    for (const op of removed.sort()) console.error(`    - ${op}`);
    console.error('');
    console.error('  This will break SDK clients pinned to v5.0.0. To proceed:');
    console.error('   1. Verify the removal is intentional and version-bumped.');
    console.error('   2. Regenerate baseline: npx tsx scripts/generate-openapi-spec.ts');
    console.error('   3. Commit the new baseline + a CHANGELOG entry in the same PR.');
    process.exit(1);
  }

  console.log('[NV-API-CONTRACT] ✓ contract preserved — no breaking removals.');
  process.exit(0);
}

main();
