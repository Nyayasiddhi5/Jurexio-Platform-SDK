#!/usr/bin/env node
/**
 * Pass 2: rewrite leftover `return res.<chain>(...);` (single-line) to
 * `{ res.<chain>(...); return; }` using a tiny paren-balanced parser so we
 * handle nested parens that the first-pass regex couldn't.
 */
import fs from 'fs';
import { execSync } from 'child_process';

const errors = execSync('npx tsc --noEmit 2>&1 || true', { encoding: 'utf8' })
  .split('\n')
  .filter((l) => /error TS7030/.test(l));

const targets = new Map(); // file -> Set of line numbers (1-based)
for (const e of errors) {
  const m = e.match(/^([^(]+)\((\d+),\d+\): error TS7030/);
  if (!m) continue;
  if (!targets.has(m[1])) targets.set(m[1], new Set());
  targets.get(m[1]).add(parseInt(m[2], 10));
}

function rewriteReturnRes(line) {
  // Find each `return res.` not inside a string. For simplicity we don't strip strings;
  // route bodies don't have funky escaping that matters here.
  let out = '';
  let i = 0;
  let changed = false;
  while (i < line.length) {
    if (line.startsWith('return res.', i)) {
      // Walk forward consuming identifiers / `.x` / `(...)` chains until `;`.
      let j = i + 'return '.length; // start at `res.`
      let depth = 0;
      let foundSemi = false;
      while (j < line.length) {
        const ch = line[j];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ';' && depth === 0) { foundSemi = true; break; }
        j++;
      }
      if (!foundSemi) {
        // Multi-line `return res.X({` continuation; leave alone.
        out += line[i];
        i++;
        continue;
      }
      // Slice expression `res.X(...)…`
      const expr = line.slice(i + 'return '.length, j);
      // Wrap: `{ res.X(...); return; }`. Caller generally has `if (cond) ` before us;
      // rewriting to a block keeps semantics safe.
      out += `{ ${expr}; return; }`;
      i = j + 1; // skip the ';'
      changed = true;
    } else {
      out += line[i];
      i++;
    }
  }
  return changed ? out : null;
}

let totalFixed = 0;
for (const [file, lineSet] of targets) {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  // The function header line is reported (e.g. router.post(...)). The actual `return res`
  // lives somewhere inside the body (typically within the next ~80 lines). We scan a window.
  for (const headLine of lineSet) {
    let fixedAny = false;
    // Find function body braces.
    let openLine = -1;
    let openCol = -1;
    for (let k = headLine - 1; k < Math.min(headLine + 5, src.length); k++) {
      const idx = src[k].indexOf('{');
      if (idx >= 0) {
        openLine = k;
        openCol = idx;
        break;
      }
    }
    if (openLine === -1) continue;

    // Find matching close brace.
    let depth = 0;
    let endLine = -1;
    outer: for (let k = openLine; k < src.length; k++) {
      const startCol = k === openLine ? openCol : 0;
      const t = src[k].replace(/\/\/.*$/g, '');
      for (let c = startCol; c < t.length; c++) {
        if (t[c] === '{') depth++;
        else if (t[c] === '}') {
          depth--;
          if (depth === 0) {
            endLine = k;
            break outer;
          }
        }
      }
    }
    if (endLine === -1) continue;

    for (let k = openLine; k <= endLine; k++) {
      const next = rewriteReturnRes(src[k]);
      if (next !== null && next !== src[k]) {
        src[k] = next;
        fixedAny = true;
        totalFixed++;
      }
    }
    if (fixedAny) {
      console.log(`  fixed: ${file}:${headLine}`);
    }
  }
  fs.writeFileSync(file, src.join('\n'));
}
console.log(`Total inline rewrites: ${totalFixed}`);
