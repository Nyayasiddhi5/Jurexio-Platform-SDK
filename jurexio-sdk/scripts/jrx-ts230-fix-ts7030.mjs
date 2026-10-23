#!/usr/bin/env node
/**
 * NV-TS230 cleanup: TS7030 ("Not all code paths return a value") in Express handlers.
 *
 * Most TS7030 markers sit on a `router.X(...)`/middleware line whose body has the
 * shape:
 *     if (cond) return res.status(N).json(...);
 *     ...
 *     res.json(...);
 *
 * Express handler types are `(req, res) => void`, so a one-armed `return res.X.json()`
 * makes the inferred return type `void | Response`, which then fails noImplicitReturns.
 *
 * Fix: split `return res.X.json(...)` into `{ res.X.json(...); return; }`
 * (or `next()` variant) so the handler is uniformly void-returning. Then drop the marker.
 *
 * This script:
 *   1. Walks every file containing a TS7030 NV-TS230 marker.
 *   2. For each marker, finds the next non-blank line and, if it looks like a route
 *      handler / middleware factory, rewrites every `return res.X(...).Y(...)...;`
 *      and `return next(...)` inside that handler body to the void-returning form.
 *   3. Removes the marker line.
 *   4. Leaves a sentinel-free file when no transformation is needed (errors will
 *      then surface in type-check and we restore the marker manually).
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(process.cwd(), 'src');

const filesWithMarkers = execSync(
  `rg -l "NV-TS230 legacy typing gap \\(TS7030\\)" src/`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

let totalRemoved = 0;
let totalSkipped = 0;
const skippedDetails = [];

for (const file of filesWithMarkers) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // We collect index ranges to delete (markers) and rewrites to apply.
  const dropIdx = new Set();
  const rewrites = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/NV-TS230 legacy typing gap \(TS7030\)/.test(line)) continue;

    // Find next non-blank, non-comment line.
    let j = i + 1;
    while (j < lines.length && /^\s*(\/\/|$)/.test(lines[j])) j++;
    if (j >= lines.length) continue;

    const head = lines[j];
    // Accept route/handler/middleware-factory style:
    //   router.<verb>('/path', ..., async (req, res) => {
    //   router.<verb>('/path', ..., (req, res, next) => {
    //   <name>(<args>): RequestHandler { ... }
    //   export const xyz = (req, res) => {
    //   return async (req, res, next) => {
    const isHandler =
      /\b(router|app)\.(get|post|put|patch|delete|all|use)\s*\(/.test(head) ||
      /=>\s*\{?\s*$/.test(head) ||
      /function\s*\w*\s*\(.*\bres\b.*\)/.test(head) ||
      /\b(req|request)\b.*\bres(ponse)?\b/.test(head);

    if (!isHandler) {
      totalSkipped++;
      skippedDetails.push(`${file}:${i + 1} (head=${head.trim().slice(0, 80)})`);
      continue;
    }

    // Find the function body bounds. Track braces from the first `{` after head.
    // Start by locating the first `{` >= j on or after head.
    let openIdx = -1;
    let openCol = -1;
    for (let k = j; k < Math.min(j + 5, lines.length); k++) {
      const idx = lines[k].indexOf('{');
      if (idx >= 0) {
        openIdx = k;
        openCol = idx;
        break;
      }
    }
    if (openIdx === -1) {
      totalSkipped++;
      skippedDetails.push(`${file}:${i + 1} (no body brace)`);
      continue;
    }

    // Walk forward counting braces to find matching close.
    let depth = 0;
    let bodyEnd = -1;
    let started = false;
    outer: for (let k = openIdx; k < lines.length; k++) {
      const startCol = k === openIdx ? openCol : 0;
      const text = lines[k];
      // Strip strings / comments roughly (we're tolerant — the route bodies are conventional).
      const stripped = text
        .replace(/\/\/.*$/g, '')
        .replace(/\/\*.*?\*\//g, '');
      for (let c = startCol; c < stripped.length; c++) {
        const ch = stripped[c];
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') {
          depth--;
          if (started && depth === 0) {
            bodyEnd = k;
            break outer;
          }
        }
      }
    }
    if (bodyEnd === -1) {
      totalSkipped++;
      skippedDetails.push(`${file}:${i + 1} (no matching close brace)`);
      continue;
    }

    // Within [openIdx, bodyEnd], rewrite `return res.<chain>;` inside if-statements
    // and bare `return next();` style early returns.
    let didRewrite = false;
    for (let k = openIdx; k <= bodyEnd; k++) {
      const orig = lines[k];

      // Pattern A: single-line `if (cond) return res.<chain>;`
      // Replace with `if (cond) { res.<chain>; return; }`
      let next = orig.replace(
        /\bif\s*\(([^)]*)\)\s*return\s+(res\.[^;]+);/g,
        (_m, cond, expr) => `if (${cond}) { ${expr}; return; }`,
      );

      // Pattern B: standalone `return res.<chain>;` (whole line, possibly indented).
      // Convert to `res.<chain>; return;`. Only do this if not already at end of body.
      if (!/\bif\s*\(/.test(next)) {
        next = next.replace(
          /^(\s*)return\s+(res\.[^;]+);\s*$/,
          (_m, indent, expr) => `${indent}${expr};\n${indent}return;`,
        );
      }

      if (next !== orig) {
        rewrites.push([k, next]);
        didRewrite = true;
      }
    }

    if (didRewrite) {
      dropIdx.add(i);
    } else {
      totalSkipped++;
      skippedDetails.push(
        `${file}:${i + 1} (no \`return res.X\` to rewrite in body lines ${openIdx + 1}-${bodyEnd + 1})`,
      );
    }
  }

  if (dropIdx.size === 0 && rewrites.length === 0) continue;

  // Apply rewrites first.
  for (const [k, text] of rewrites) lines[k] = text;
  // Drop marker lines.
  const out = lines
    .filter((_, idx) => !dropIdx.has(idx))
    .join('\n');
  fs.writeFileSync(file, out);
  totalRemoved += dropIdx.size;
  console.log(`  ${file}: removed ${dropIdx.size} TS7030 markers`);
}

console.log(`\nTotal TS7030 markers removed: ${totalRemoved}`);
console.log(`Skipped (no auto-fix pattern matched): ${totalSkipped}`);
if (skippedDetails.length) {
  console.log('\nSkipped detail:');
  for (const d of skippedDetails.slice(0, 50)) console.log('  ' + d);
  if (skippedDetails.length > 50) console.log(`  ...and ${skippedDetails.length - 50} more`);
}
