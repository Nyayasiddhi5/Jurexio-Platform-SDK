/**
 * scripts/jrx-migrate-api-paths-fixup.ts
 *
 * Companion to `jrx-migrate-api-paths.ts`. Cleans up cases where the first-pass
 * migrator wrapped a *descriptive* string (label, placeholder, error message,
 * comment-style description) that happens to mention `/api/jrx/...` as text —
 * the resulting `nv('POST /api/jrx/completions')` is both wrong (would prefix
 * with `/api/jrx/` again) and still flagged by the lint rule because the inner
 * argument is a literal containing `/api/jrx/`.
 *
 * Rewrite rule:
 *   nv('<text containing /api/jrx/...>')   ->   `<text with /api/jrx/ → ${NV_BASE}>`
 *   {nv('<text...>')}  (JSX expr-attr)    ->   {`<...${NV_BASE}...>`}
 *
 * Adds NV_BASE to the existing jrx-api-paths import.
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

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) yield full;
  }
}

interface Edit { start: number; end: number; text: string }

function fixupFile(file: string): number {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes("nv('")) return 0;

  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits: Edit[] = [];
  let usedBase = false;

  const visit = (node: ts.Node): void => {
    // Match: CallExpression `nv('literal')` whose literal contains `/api/jrx/`
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'nv' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const arg = node.arguments[0] as ts.StringLiteral;
      if (PATTERN.test(arg.text)) {
        // Build template literal source. Escape backticks/dollars in original text.
        const safe = arg.text
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\$\{/g, '\\${');
        const templated = '`' + safe.replace(/\/api\/nv\//g, '${NV_BASE}') + '`';
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: templated });
        usedBase = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return 0;

  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }

  if (usedBase) {
    // Make sure NV_BASE is in the existing jrx-api-paths import.
    out = out.replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]*jrx-api-paths['"]);?/m,
      (_full, names: string, src: string) => {
        const list = names.split(',').map(s => s.trim()).filter(Boolean);
        if (!list.includes('NV_BASE')) list.push('NV_BASE');
        list.sort();
        return `import { ${list.join(', ')} } from ${src};`;
      },
    );
  }

  fs.writeFileSync(file, out, 'utf8');
  return edits.length;
}

let total = 0;
let touched = 0;
for (const file of walk(ROOT)) {
  if (file === REGISTRY) continue;
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
  const n = fixupFile(file);
  if (n > 0) {
    touched += 1;
    total += n;
    console.log(`  ${n.toString().padStart(3)}  ${path.relative(process.cwd(), file)}`);
  }
}
console.log(`\nFix-up: rewrote ${total} call(s) across ${touched} file(s).`);
