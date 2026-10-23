/**
 * scripts/jrx-migrate-api-paths.ts
 *
 * One-shot migration for task-191. Rewrites every hardcoded `/api/jrx/...`
 * literal in `client/src/**` (excluding the registry file and tests) so that
 * the `no-hardcoded-api-paths` ESLint rule reports 0 violations.
 *
 * Strategy:
 *   - String literals  '/api/jrx/X'   -> nv('X')              (JSX attrs wrap in {})
 *   - No-subst template `/api/jrx/X`  -> `${NV_BASE}X`
 *   - Tagged templates with substitutions: replace each '/api/jrx/' substring
 *     inside head/middle/tail text with '${NV_BASE}' at the source level.
 *   - Adds `import { nv, NV_BASE } from '@/lib/jrx-api-paths'` (or the relative
 *     equivalent) to every touched file, importing only the symbols used.
 *
 * Usage:
 *   npx tsx scripts/jrx-migrate-api-paths.ts [--dry] [--file <path>]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', 'client', 'src');
const REGISTRY = path.join(ROOT, 'lib', './jrx-api-paths.ts');
const PATTERN = /\/api\/nv\//;
const EXCLUDE_SUFFIX = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = (() => {
  const i = args.indexOf('--file');
  return i >= 0 ? path.resolve(args[i + 1]) : null;
})();

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) yield full;
  }
}

interface Edit { start: number; end: number; text: string }

function migrateFile(file: string): { edits: number; usedNv: boolean; usedBase: boolean } | null {
  const src = fs.readFileSync(file, 'utf8');
  if (!PATTERN.test(src)) return null;

  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits: Edit[] = [];
  let usedNv = false;
  let usedBase = false;

  const visit = (node: ts.Node): void => {
    // String literal:  '/api/jrx/...'  or  "/api/jrx/..."
    if (ts.isStringLiteral(node) && PATTERN.test(node.text)) {
      const rest = node.text.replace(/^\/+api\/nv\/+/, '');
      const replacement = `nv('${rest.replace(/'/g, "\\'")}')`;
      usedNv = true;
      const parent = node.parent;
      if (parent && ts.isJsxAttribute(parent) && parent.initializer === node) {
        // attr="/api/jrx/x"  ->  attr={nv('x')}
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `{${replacement}}` });
      } else {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: replacement });
      }
      return;
    }

    // No-substitution template:  `/api/jrx/foo`
    if (ts.isNoSubstitutionTemplateLiteral(node) && PATTERN.test(node.text)) {
      // Replace the literal substring inside the source-level backticks.
      const start = node.getStart(sf);
      const end = node.getEnd();
      const rawSource = src.slice(start, end); // includes backticks
      const newSource = rawSource.replace(/\/api\/nv\//g, '${NV_BASE}');
      usedBase = true;
      edits.push({ start, end, text: newSource });
      return;
    }

    // Template expression with substitutions: replace head/middle/tail text source
    if (ts.isTemplateExpression(node)) {
      const head = node.head;
      if (PATTERN.test(head.text)) {
        const start = head.getStart(sf);
        const end = head.getEnd();
        const rawSource = src.slice(start, end);
        const newSource = rawSource.replace(/\/api\/nv\//g, '${NV_BASE}');
        usedBase = true;
        edits.push({ start, end, text: newSource });
      }
      for (const span of node.templateSpans) {
        const lit = span.literal;
        if (PATTERN.test(lit.text)) {
          const start = lit.getStart(sf);
          const end = lit.getEnd();
          const rawSource = src.slice(start, end);
          const newSource = rawSource.replace(/\/api\/nv\//g, '${NV_BASE}');
          usedBase = true;
          edits.push({ start, end, text: newSource });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return null;

  // Apply edits in reverse order
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }

  // Add import
  out = ensureImport(out, file, { nv: usedNv, base: usedBase });

  if (!DRY) fs.writeFileSync(file, out, 'utf8');
  return { edits: edits.length, usedNv, usedBase };
}

function importPath(file: string): string {
  // Prefer '@/lib/jrx-api-paths' alias if other imports use '@/'
  const src = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]@\//m.test(src)) return '@/lib/jrx-api-paths';
  // Fall back to relative
  const dir = path.dirname(file);
  let rel = path.relative(dir, REGISTRY).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function ensureImport(source: string, file: string, want: { nv: boolean; base: boolean }): string {
  const symbols: string[] = [];
  if (want.nv) symbols.push('nv');
  if (want.base) symbols.push('NV_BASE');
  if (symbols.length === 0) return source;

  // Check whether already imported from the registry
  const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+jrx-api-paths)['"];?/m;
  const m = source.match(importRe);
  if (m) {
    const existing = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const merged = Array.from(new Set([...existing, ...symbols])).sort();
    const newImport = `import { ${merged.join(', ')} } from '${m[2]}';`;
    return source.slice(0, m.index!) + newImport + source.slice(m.index! + m[0].length);
  }

  // Insert after the last import statement
  const importBlockRe = /^(?:import[^;]*;\s*\n)+/m;
  const block = source.match(importBlockRe);
  const importStmt = `import { ${symbols.sort().join(', ')} } from '${importPath(file)}';\n`;
  if (block) {
    const insertAt = block.index! + block[0].length;
    return source.slice(0, insertAt) + importStmt + source.slice(insertAt);
  }
  return importStmt + source;
}

let totalEdits = 0;
let touched = 0;
const failures: { file: string; reason: string }[] = [];

for (const file of walk(ROOT)) {
  if (file === REGISTRY) continue;
  if (EXCLUDE_SUFFIX.test(file)) continue;
  if (ONLY && file !== ONLY) continue;
  try {
    const r = migrateFile(file);
    if (r) {
      touched += 1;
      totalEdits += r.edits;
      console.log(`  ${r.edits.toString().padStart(4)}  ${path.relative(process.cwd(), file)}`);
    }
  } catch (err) {
    failures.push({ file, reason: (err as Error).message });
  }
}

console.log(`\n${DRY ? '[dry-run] ' : ''}Migrated ${totalEdits} literals across ${touched} files.`);
if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures) console.log(`  ${f.file}: ${f.reason}`);
  process.exit(1);
}
