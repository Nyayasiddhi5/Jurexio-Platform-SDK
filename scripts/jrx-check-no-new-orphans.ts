/**
 * nv-check-no-new-orphans.ts
 * NYV-WIRING-BUDGET-001 (2026-05-10) — orphan-budget guardrail.
 *
 * Re-runs the wiring audit and compares total orphan count vs the committed
 * budget at docs/audit/jrx-orphan-budget.json. Fails CI if orphans GREW.
 * Allowed (in fact encouraged) to shrink as the team wires features.
 *
 * Bootstrap a new budget after wiring work:
 *   npx tsx scripts/jrx-wiring-audit.ts
 *   echo '{"max":'$(jq .totals.orphan docs/audit/jrx-wiring-audit.json)'}' \
 *     > docs/audit/jrx-orphan-budget.json
 *   git add docs/audit/jrx-orphan-budget.json
 *
 * Run via: npm run guardrail:no-new-orphans
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT = path.join(ROOT, 'docs', 'audit', './jrx-wiring-audit.json');
const BUDGET = path.join(ROOT, 'docs', 'audit', './jrx-orphan-budget.json');

function ensureBudget(currentOrphans: number): number {
  if (!fs.existsSync(BUDGET)) {
    fs.mkdirSync(path.dirname(BUDGET), { recursive: true });
    fs.writeFileSync(BUDGET, JSON.stringify({ max: currentOrphans, bootstrappedAt: new Date().toISOString() }, null, 2));
    console.warn(`[NV-WIRING-BUDGET] bootstrapped budget at ${currentOrphans} orphans → ${path.relative(ROOT, BUDGET)}`);
    return currentOrphans;
  }
  return (JSON.parse(fs.readFileSync(BUDGET, 'utf8')) as { max: number }).max;
}

// NV-WIRING-BUDGET-001 Slice-6 (2026-05-10) — allowlist of intentional orphans
// (KEEP-BARREL / KEEP-CLI / KEEP-CONTRACT). Effective orphan count = raw orphans
// − allowlisted-and-still-orphan. Rationale: barrels and CLI scripts will never
// be reachable from src/index.ts BFS by design; counting them inflates the
// budget and obscures real "needs wiring" work.
const ALLOWLIST = path.join(ROOT, 'docs', 'audit', './jrx-orphan-allowlist.json');

interface AllowlistEntry { file: string; category: string; reason: string }
interface AllowlistFile { _validCategories?: string[]; entries?: AllowlistEntry[] }

function loadAllowlist(): { set: Set<string>; entries: AllowlistEntry[]; valid: string[] } {
  if (!fs.existsSync(ALLOWLIST)) return { set: new Set(), entries: [], valid: [] };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')) as AllowlistFile;
  return { set: new Set((raw.entries ?? []).map(e => e.file)), entries: raw.entries ?? [], valid: raw._validCategories ?? [] };
}

function validateAllowlist(allow: ReturnType<typeof loadAllowlist>, allOrphans: string[]): string[] {
  const errs: string[] = [];
  const orphanSet = new Set(allOrphans);
  for (const e of allow.entries) {
    if (!e.file || !e.category || !e.reason) errs.push(`  malformed entry (need file/category/reason): ${JSON.stringify(e)}`);
    if (allow.valid.length && !allow.valid.includes(e.category)) errs.push(`  ${e.file}: invalid category "${e.category}" (must be one of ${allow.valid.join(', ')})`);
    if (e.reason && e.reason.length < 20) errs.push(`  ${e.file}: reason too short (<20 chars) — explain WHY this is intentionally orphan`);
    if (e.file && !orphanSet.has(e.file) && fs.existsSync(path.join(ROOT, e.file))) {
      errs.push(`  ${e.file}: STALE — file is no longer orphan (now wired/used-internal); remove from allowlist`);
    }
    if (e.file && !fs.existsSync(path.join(ROOT, e.file))) {
      errs.push(`  ${e.file}: STALE — file does not exist; remove from allowlist`);
    }
  }
  return errs;
}

function main(): void {
  console.log('[NV-WIRING-BUDGET] regenerating wiring audit…');
  execFileSync('npx', ['tsx', path.join(ROOT, 'scripts', './jrx-wiring-audit.ts')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8')) as {
    totals: { orphan: number; total: number; wired: number };
    buckets: Record<string, { orphan: string[] }>;
  };
  const allowed = loadAllowlist();
  const allOrphans: string[] = Object.values(audit.buckets).flatMap(b => b.orphan);
  const allowErrs = validateAllowlist(allowed, allOrphans);
  if (allowErrs.length) {
    console.error('[NV-WIRING-BUDGET] ✗ allowlist validation failed:');
    for (const e of allowErrs) console.error(e);
    process.exit(1);
  }
  const allowedHits = allOrphans.filter(f => allowed.set.has(f));
  const effectiveOrphans = allOrphans.filter(f => !allowed.set.has(f));
  const current = effectiveOrphans.length;
  const budget = ensureBudget(current);

  console.log(`[NV-WIRING-BUDGET] effective orphans: ${current} / budget ${budget}  (wired ${audit.totals.wired} / total ${audit.totals.total}; allowlisted ${allowedHits.length} of ${allOrphans.length} raw)`);

  if (current > budget) {
    console.error(`[NV-WIRING-BUDGET] ✗ orphans grew by ${current - budget} (was ${budget}, now ${current}).`);
    console.error('  New unwired files were added. Either:');
    console.error('   - wire the new files into a route/middleware/service that is reachable from src/index.ts, OR');
    console.error('   - if the growth is intentional (e.g. a new in-progress feature), bump the budget:');
    console.error(`     echo '{"max":${current}}' > docs/audit/jrx-orphan-budget.json && git add docs/audit/jrx-orphan-budget.json`);
    process.exit(1);
  }

  if (current < budget) {
    console.log(`[NV-WIRING-BUDGET] ✓ orphans shrank by ${budget - current}. Consider tightening budget:`);
    console.log(`    echo '{"max":${current}}' > docs/audit/jrx-orphan-budget.json && git add docs/audit/jrx-orphan-budget.json`);
  } else {
    console.log('[NV-WIRING-BUDGET] ✓ orphan count unchanged.');
  }
  process.exit(0);
}

main();
