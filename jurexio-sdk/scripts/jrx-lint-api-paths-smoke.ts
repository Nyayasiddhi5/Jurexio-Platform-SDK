/**
 * scripts/jrx-lint-api-paths-smoke.ts
 *
 * Standalone smoke harness for `eslint-rules/no-hardcoded-api-paths.js`.
 *
 * Why this script exists:
 *   The repo does not (yet) carry a devDependency on eslint, so we cannot run
 *   `npm run lint` end-to-end in CI as-is. This script uses the TypeScript
 *   compiler API (already a dependency) to walk every `client/src/**`
 *   {ts,tsx,js,jsx} file and emulate exactly what the lint rule will flag:
 *   string literals and template elements containing `/api/jrx/`.
 *
 * Usage:
 *   npx tsx scripts/jrx-lint-api-paths-smoke.ts            # summary
 *   npx tsx scripts/jrx-lint-api-paths-smoke.ts --report   # per-file breakdown
 *
 * Mirrors the regex used by the actual rule:
 *   /\/api\/nv\//
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

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) yield full;
  }
}

interface Violation { file: string; line: number; text: string }
const violations: Violation[] = [];

for (const file of walk(ROOT)) {
  if (file === REGISTRY) continue;
  if (EXCLUDE_SUFFIX.test(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (PATTERN.test(node.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        violations.push({ file: path.relative(process.cwd(), file), line: line + 1, text: node.text });
      }
    } else if (ts.isTemplateExpression(node)) {
      const head = node.head.text;
      if (PATTERN.test(head)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.head.getStart(sf));
        violations.push({ file: path.relative(process.cwd(), file), line: line + 1, text: head });
      }
      for (const span of node.templateSpans) {
        if (PATTERN.test(span.literal.text)) {
          const { line } = sf.getLineAndCharacterOfPosition(span.literal.getStart(sf));
          violations.push({ file: path.relative(process.cwd(), file), line: line + 1, text: span.literal.text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const byFile = new Map<string, number>();
for (const v of violations) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);

console.log(`no-hardcoded-api-paths smoke: ${violations.length} violations across ${byFile.size} files`);

if (process.argv.includes('--report')) {
  const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  for (const [f, n] of sorted) console.log(`  ${n.toString().padStart(4)}  ${f}`);
}

process.exit(violations.length > 0 ? 1 : 0);
