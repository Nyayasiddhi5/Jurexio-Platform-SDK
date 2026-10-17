#!/usr/bin/env node
/**
 * NV-NO-PLACEHOLDER-001 — placeholder / fake / stub / duplicate detector.
 *
 * Standing guardrail (requested by product owner 2026-06-29):
 *   "no duplicates, no fake, no placeholder code ever in this platform …
 *    warn if any placeholder code, any fake or duplicate implementation is
 *    planned or done ever."
 *
 * What it flags (high-signal, low false-positive):
 *   1. Placeholder / stub / fake markers in NON-TEST source
 *      (e.g. "[Content would be extracted here in production]", TODO/FIXME,
 *       "not implemented", "stub", "mock"/"dummy"/"fake" in prod code,
 *       "coming soon", "lorem ipsum").
 *   2. Duplicate-implementation smell: a committed `.js` file that has a
 *      sibling `.ts` in src/ (compiled artifact shadowing the real source).
 *
 * Modes:
 *   (default)          warn-only — prints findings, ALWAYS exits 0.
 *   --enforce          exits 1 if findings exceed the recorded baseline
 *                      (i.e. a NEW placeholder/fake/duplicate was introduced).
 *   --update-baseline  rewrites scripts/.nv-placeholder-baseline.json to the
 *                      current findings (use after a real cleanup reduces them).
 *
 * The baseline stores per-finding signatures (path::category::text, line-number
 * independent) so moving code does not trip the check — only genuinely new
 * placeholders do. Cleanups that REMOVE placeholders never fail the check.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, '.nv-placeholder-baseline.json');

const SCAN_ROOTS = ['src', 'client/src', 'shared', 'packages'];

const EXCLUDE_DIR = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage',
  '__tests__', '__mocks__', 'test', 'tests', '__fixtures__',
]);

const isTestFile = (p) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
  /(^|\/)(test|tests|__tests__|__mocks__|e2e|fixtures)(\/|$)/.test(p) ||
  /\.d\.ts$/.test(p);

// ── Detection patterns ──────────────────────────────────────────────────────
// Each: { category, re, comment? } — `re` is run per-line.
const PATTERNS = [
  { category: 'placeholder-prod', re: /\bwould be\b[^\n]*\b(extracted|implemented|generated|computed|returned|fetched|populated|here)\b[^\n]*\bin production\b/i },
  { category: 'placeholder-prod', re: /\[\s*(content|text|value|data|result)[^\]]*\bwould be\b[^\]]*\]/i },
  { category: 'not-implemented', re: /\b(not[\s_-]?implemented|unimplemented)\b/i },
  { category: 'not-implemented', re: /throw\s+new\s+Error\(\s*[`'"][^`'"]*\b(not\s+implemented|todo|stub)\b/i },
  { category: 'todo-marker', re: /(^|[^:\w])(\/\/|\/\*|\*|#)\s*(TODO|FIXME|HACK|XXX)\b/ },
  { category: 'stub', re: /\b(stubbed|stub\s+implementation|temporary\s+implementation)\b/i },
  // "placeholder" only when it clearly describes fake output (not a JSX/CSS `placeholder=`/`placeholder:` attribute).
  { category: 'placeholder-prod', re: /\bplaceholder\s+(implementation|impl|response|result|value|data|text|content|logic|code|here|for now)\b/i },
  { category: 'placeholder-comment', re: /(\/\/|\/\*|^\s*\*|#)\s*[^\n]*\bplaceholder\b/i },
  { category: 'fake-mock-prod', re: /\b(mock|fake|dummy)\s+(data|response|result|value|implementation|service|client|impl)\b/i },
  { category: 'coming-soon', re: /\bcoming soon\b/i },
  { category: 'lorem', re: /\blorem ipsum\b/i },
];

// Lines containing this annotation are intentionally exempted.
const ALLOW_RE = /nv-allow-placeholder/i;

// JSX/HTML/CSS input `placeholder` attribute usage is legitimate UI, not a stub.
const UI_PLACEHOLDER_RE = /placeholder(text)?\s*[:=]|["'`]placeholder["'`]|setplaceholder|getplaceholder/i;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIR.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      const ext = extname(e.name);
      if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) out.push(full);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (existsSync(abs)) walk(abs, files);
  }
  return files;
}

function scanContent(files) {
  const findings = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    if (isTestFile(rel)) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (ALLOW_RE.test(line)) continue;
      const uiPlaceholder = UI_PLACEHOLDER_RE.test(line);
      for (const { category, re } of PATTERNS) {
        if (uiPlaceholder && category.startsWith('placeholder')) continue;
        const m = re.exec(line);
        if (m) {
          findings.push({
            category,
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 160),
            sig: `${rel}::${category}::${(m[0] || line.trim()).slice(0, 120)}`,
          });
          break; // one finding per line is enough
        }
      }
    }
  }
  return findings;
}

function scanDuplicates(files) {
  const findings = [];
  const tsSet = new Set(
    files
      .map((f) => relative(REPO_ROOT, f))
      .filter((r) => r.startsWith('src/') && /\.ts$/.test(r) && !/\.d\.ts$/.test(r))
      .map((r) => r.replace(/\.ts$/, '')),
  );
  for (const f of files) {
    const rel = relative(REPO_ROOT, f);
    if (rel.startsWith('src/') && /\.js$/.test(rel)) {
      const base = rel.replace(/\.js$/, '');
      if (tsSet.has(base)) {
        findings.push({
          category: 'duplicate-js-artifact',
          file: rel,
          line: 0,
          text: `compiled .js shadows source ${base}.ts — remove the committed artifact`,
          sig: `${rel}::duplicate-js-artifact`,
        });
      }
    }
  }
  return findings;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { return null; }
}

function summarize(findings) {
  const byCat = {};
  for (const f of findings) byCat[f.category] = (byCat[f.category] || 0) + 1;
  return byCat;
}

// ── Main ──────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const ENFORCE = args.has('--enforce');
const UPDATE = args.has('--update-baseline');

const files = collectFiles();
const findings = [...scanContent(files), ...scanDuplicates(files)];
const sigs = findings.map((f) => f.sig);
const byCat = summarize(findings);

console.log('▶ NV-NO-PLACEHOLDER-001 — scanning for placeholder / fake / stub / duplicate code …');
console.log(`  scanned ${files.length} source files in [${SCAN_ROOTS.join(', ')}] (tests excluded)`);
console.log(`  total findings: ${findings.length}`);
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`    • ${cat}: ${n}`);
}

if (UPDATE || !existsSync(BASELINE_PATH)) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), count: findings.length, signatures: sigs.sort() }, null, 2) + '\n',
  );
  console.log(`✓ baseline ${UPDATE ? 'updated' : 'created'} at scripts/.nv-placeholder-baseline.json (count=${findings.length}).`);
  if (!UPDATE) console.log('  (first run — recording current debt as the baseline; new placeholders will be flagged from now on.)');
  process.exit(0);
}

const baseline = loadBaseline();
const baseSigs = new Set(baseline?.signatures ?? []);
const novel = findings.filter((f) => !baseSigs.has(f.sig));

if (novel.length === 0) {
  console.log(`✓ NV-NO-PLACEHOLDER-001: no NEW placeholder/fake/duplicate code (baseline debt: ${baseline?.count ?? 0}).`);
  if (findings.length < (baseline?.count ?? 0)) {
    console.log(`  (debt reduced ${baseline.count} → ${findings.length}; run --update-baseline to lock the win.)`);
  }
  process.exit(0);
}

console.log('');
console.log(`⚠ NV-NO-PLACEHOLDER-001: ${novel.length} NEW placeholder/fake/duplicate finding(s) introduced:`);
for (const f of novel.slice(0, 60)) {
  console.log(`  ${f.file}:${f.line}  [${f.category}]  ${f.text}`);
}
if (novel.length > 60) console.log(`  … and ${novel.length - 60} more`);
console.log('');
console.log('  Fix with a real implementation, or annotate the line with `nv-allow-placeholder: <reason>` if genuinely intentional.');

if (ENFORCE) {
  console.error('✗ NV-NO-PLACEHOLDER-001 FAILED (--enforce): new placeholder/fake/duplicate code is not allowed.');
  process.exit(1);
}
console.log('  (warn-only mode — pass --enforce to make this fail the build.)');
process.exit(0);
