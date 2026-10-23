#!/usr/bin/env node
/**
 * NV-TS230 prune: detect markers that are no longer needed and remove them.
 *
 * Approach:
 *   1. Walk every src/ file. For every line containing NV-TS230 marker,
 *      replace the marker with a plain comment placeholder (`// NV-TS230-CHECK`)
 *      so we can map errors back to original line numbers.
 *   2. Run `tsc --noEmit`. Any error reported on the line *after* a placeholder
 *      means the marker is still needed — restore it (with the actual TS code
 *      seen). Any placeholder with NO error on the next line means the marker
 *      is now redundant and can be deleted.
 *   3. Write back the cleaned files.
 */
import fs from 'fs';
import { execSync } from 'child_process';

const filesWithMarkers = execSync('rg -l "NV-TS230" src/', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

// Step 1: stash markers into a sentinel comment.
// Each marker line becomes `// NV-TS230-CHECK <originalCode> <indent-marker>`
// so we can restore exactly. We replace ONLY lines that are pure marker comments
// (i.e. the line's non-whitespace content is the marker itself).
const stashed = new Map(); // file -> [{lineIdx0, originalLine, code}]

for (const file of filesWithMarkers) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const stash = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)\/\/\s*@ts-expect-error NV-TS230 legacy typing gap \(TS(\d+)\)\s*$/);
    if (!m) continue;
    stash.push({ lineIdx0: i, originalLine: lines[i], code: m[2], indent: m[1] });
    // Replace with sentinel comment that occupies the same line slot.
    lines[i] = `${m[1]}// NV-TS230-CHECK code=${m[2]}`;
  }
  if (stash.length) {
    stashed.set(file, stash);
    fs.writeFileSync(file, lines.join('\n'));
  }
}
const totalStashed = [...stashed.values()].reduce((a, s) => a + s.length, 0);
console.log(`Stashed ${totalStashed} markers across ${stashed.size} files.`);

// Step 2: type-check. Collect errors per file:line.
console.log('Running tsc --noEmit ...');
const tscOut = execSync('npx tsc --noEmit 2>&1 || true', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const errsPerLoc = new Map(); // `${file}:${line1}` -> Set(codes)
for (const line of tscOut.split('\n')) {
  const m = line.match(/^(.+?)\((\d+),\d+\): error TS(\d+):/);
  if (!m) continue;
  const key = `${m[1]}:${m[2]}`;
  if (!errsPerLoc.has(key)) errsPerLoc.set(key, new Set());
  errsPerLoc.get(key).add(m[3]);
}
console.log(`Type-check errors after stash: ${[...errsPerLoc.values()].reduce((a, s) => a + s.size, 0)}`);

// Step 3: restore markers only where the line *after* them has an error.
let totalRestored = 0;
let totalPruned = 0;
let totalUnknownRestores = 0;
for (const [file, stash] of stashed) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const { lineIdx0, originalLine, code, indent } of stash) {
    // The protected line is the next non-blank, non-sentinel line.
    let target = lineIdx0 + 1;
    while (target < lines.length && (lines[target].trim() === '' || lines[target].includes('NV-TS230-CHECK'))) {
      target++;
    }
    const key = `${file}:${target + 1}`; // 1-based
    const codesAtLoc = errsPerLoc.get(key);
    if (codesAtLoc && codesAtLoc.size > 0) {
      // Restore — pick the error code that's actually now there. If multiple,
      // join them. If different from the original recorded code, use the new one.
      const codeStr = [...codesAtLoc].join(',');
      if (codesAtLoc.size === 1 && codesAtLoc.has(code)) {
        lines[lineIdx0] = originalLine;
      } else {
        // Update the marker to reflect actual current code(s).
        const firstCode = [...codesAtLoc][0];
        lines[lineIdx0] = `${indent}// @ts-expect-error NV-TS230 legacy typing gap (TS${firstCode})`;
        totalUnknownRestores++;
      }
      totalRestored++;
    } else {
      // No error on protected line — marker is redundant. Drop sentinel (mark for deletion).
      lines[lineIdx0] = '__NV_TS230_DROP__';
      totalPruned++;
    }
  }
  // Drop sentinel rows.
  const cleaned = lines.filter((l) => l !== '__NV_TS230_DROP__');
  fs.writeFileSync(file, cleaned.join('\n'));
}

console.log(`Restored: ${totalRestored} (of which ${totalUnknownRestores} had a different error code than originally recorded)`);
console.log(`Pruned redundant: ${totalPruned}`);
