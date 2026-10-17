/**
 * jrx-wiring-audit.ts
 * Read-only auditor: classifies every TS file under
 *   src/packages, src/services, src/orchestration, src/middleware, src/integrations
 * into one of:
 *   WIRED          — reachable from src/index.ts via the import graph
 *   USED-INTERNAL  — imported by some other src file but not in the wired graph
 *   ORPHAN         — zero importers anywhere (true dead code candidates)
 *
 * Output: docs/audit/jrx-wiring-audit.json + human summary on stdout.
 *
 * Implementation:
 *   1. Walk src/ to build a fileId → absolutePath map.
 *   2. For each file, parse `import … from '…'` (relative + path-mapped) AND
 *      dynamic `import('…')` calls, recording the directed edge
 *      (importer → importee). Dynamic imports must be followed: the capability
 *      manifest loads every leaf lazily, so ignoring them reports live code as
 *      dead.
 *   3. BFS from src/index.ts following edges. Every reachable node = WIRED.
 *   4. Reverse-index importers → counts. Files with importers > 0 but not
 *      WIRED = USED-INTERNAL. Files with importers === 0 = ORPHAN.
 *
 * Run:  npx tsx scripts/jrx-wiring-audit.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ENTRY = path.join(SRC, 'index.ts');
const OUT_DIR = path.join(ROOT, 'docs', 'audit');
const OUT_FILE = path.join(OUT_DIR, './jrx-wiring-audit.json');

const TARGET_DIRS = ['packages', 'services', 'orchestration', 'middleware', 'integrations'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      walk(full, out);
    } else if (e.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      if (full.endsWith('.d.ts') || full.endsWith('.test.ts')) continue;
      out.push(full);
    }
  }
  return out;
}

function resolveImport(importer: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const base = path.resolve(path.dirname(importer), spec);
  // Prefer source TS/TSX targets over sibling runtime .js artifacts.
  // In this repo many TS modules import `./x.js` for ESM runtime, while
  // `./x.ts` is the source of truth that should be wired by the auditor.
  const tsFromJs = spec.endsWith('.js')
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]
    : [];
  const candidates = [
    ...tsFromJs,
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    base,
  ];
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
    } catch {}
  }
  return null;
}

function parseImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set<string>();

  // Static: `import … from '…'`, `export … from '…'`, and bare `import '…'`.
  const staticRe = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;

  // NV-WIRING-AUDIT-DYNAMIC-001: dynamic `import('…')` — including
  // `await import(…)` and `() => import(…)`. Omitting this shape made the
  // auditor report live code as ORPHAN: the capability manifest loads every
  // leaf lazily, and `jrx-queen-leaf-prompt.ts` is pulled in at
  // `jrx-queen-orchestrator.ts` via `await import('./jrx-queen-leaf-prompt.js')`.
  // Both were reachable at runtime while being counted as dead, which makes an
  // "is everything wired?" answer from this tool wrong in the unsafe direction.
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [staticRe, dynamicRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const resolved = resolveImport(file, m[1]);
      if (resolved) out.add(resolved);
    }
  }

  return Array.from(out);
}

function inTargetArea(file: string): string | null {
  const rel = path.relative(SRC, file);
  for (const d of TARGET_DIRS) {
    if (rel === d || rel.startsWith(d + path.sep)) return d;
  }
  return null;
}

function main(): void {
  console.log('[wiring-audit] walking src/…');
  const files = walk(SRC);
  console.log(`[wiring-audit] ${files.length} TS files`);

  console.log('[wiring-audit] building import graph…');
  const edgesOut = new Map<string, string[]>();
  const importerCount = new Map<string, number>();
  for (const f of files) importerCount.set(f, 0);

  for (const f of files) {
    const out = parseImports(f);
    edgesOut.set(f, out);
    for (const t of out) {
      if (importerCount.has(t)) importerCount.set(t, (importerCount.get(t) || 0) + 1);
    }
  }

  console.log('[wiring-audit] BFS from index.ts…');
  const wired = new Set<string>();
  const stack: string[] = [ENTRY];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (wired.has(cur)) continue;
    wired.add(cur);
    for (const dep of edgesOut.get(cur) || []) {
      if (!wired.has(dep)) stack.push(dep);
    }
  }
  console.log(`[wiring-audit] ${wired.size} files reachable from index.ts`);

  // Classify target-area files
  const buckets: Record<string, { wired: string[]; usedInternal: string[]; orphan: string[] }> = {};
  for (const d of TARGET_DIRS) buckets[d] = { wired: [], usedInternal: [], orphan: [] };

  for (const f of files) {
    const area = inTargetArea(f);
    if (!area) continue;
    const rel = path.relative(ROOT, f);
    if (wired.has(f)) buckets[area].wired.push(rel);
    else if ((importerCount.get(f) || 0) > 0) buckets[area].usedInternal.push(rel);
    else buckets[area].orphan.push(rel);
  }

  // Sort each bucket
  for (const d of TARGET_DIRS) {
    buckets[d].wired.sort();
    buckets[d].usedInternal.sort();
    buckets[d].orphan.sort();
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NV WIRING AUDIT — file reachability from src/index.ts');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Area               WIRED  USED-INT  ORPHAN  TOTAL');
  console.log('─────────────────  ─────  ────────  ──────  ─────');
  let totalW = 0, totalU = 0, totalO = 0, totalT = 0;
  for (const d of TARGET_DIRS) {
    const w = buckets[d].wired.length;
    const u = buckets[d].usedInternal.length;
    const o = buckets[d].orphan.length;
    const t = w + u + o;
    totalW += w; totalU += u; totalO += o; totalT += t;
    console.log(`  ${d.padEnd(15)}  ${String(w).padStart(5)}  ${String(u).padStart(8)}  ${String(o).padStart(6)}  ${String(t).padStart(5)}`);
  }
  console.log('─────────────────  ─────  ────────  ──────  ─────');
  console.log(`  TOTAL            ${String(totalW).padStart(5)}  ${String(totalU).padStart(8)}  ${String(totalO).padStart(6)}  ${String(totalT).padStart(5)}`);
  console.log('');
  console.log(`Wired %: ${((totalW / totalT) * 100).toFixed(1)}%   |   Orphan %: ${((totalO / totalT) * 100).toFixed(1)}%`);
  console.log('');

  // Show orphan + used-internal samples for each area
  for (const d of TARGET_DIRS) {
    if (buckets[d].orphan.length === 0 && buckets[d].usedInternal.length === 0) continue;
    console.log(`── ${d.toUpperCase()} ──`);
    if (buckets[d].usedInternal.length > 0) {
      console.log(`  USED-INTERNAL (${buckets[d].usedInternal.length}):`);
      for (const f of buckets[d].usedInternal.slice(0, 20)) console.log(`    · ${f}`);
      if (buckets[d].usedInternal.length > 20) console.log(`    … +${buckets[d].usedInternal.length - 20} more`);
    }
    if (buckets[d].orphan.length > 0) {
      console.log(`  ORPHAN (${buckets[d].orphan.length}):`);
      for (const f of buckets[d].orphan.slice(0, 20)) console.log(`    · ${f}`);
      if (buckets[d].orphan.length > 20) console.log(`    … +${buckets[d].orphan.length - 20} more`);
    }
    console.log('');
  }

  // Persist
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = {
    generatedAt: new Date().toISOString(),
    entry: path.relative(ROOT, ENTRY),
    totals: { wired: totalW, usedInternal: totalU, orphan: totalO, total: totalT },
    buckets,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(json, null, 2));
  console.log(`[wiring-audit] wrote ${path.relative(ROOT, OUT_FILE)}`);
}

main();
