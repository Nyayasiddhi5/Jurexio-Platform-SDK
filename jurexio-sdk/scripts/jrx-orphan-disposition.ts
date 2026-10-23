/**
 * jrx-orphan-disposition.ts
 *
 * Reads docs/audit/jrx-wiring-audit.json and, for each ORPHAN file, opens the
 * source and applies heuristics to propose ONE disposition tag:
 *
 *   WIRE-ROUTE       — Express handler / route file → mount under /api/jrx/...
 *   WIRE-CHAIN       — middleware/pipeline → insert into safety-ring chain
 *   WIRE-INTERNAL    — service consumed by a wired service (just import it)
 *   MERGE-DUPLICATE  — same name/concept as a wired file (likely older variant)
 *   KEEP-BARREL      — index.ts barrel re-export (no wiring needed)
 *   KEEP-CLI         — seeding script / CLI entry (intentionally not in HTTP)
 *   KEEP-CONTRACT    — microservice-contract definition (used at deploy time)
 *   REVIEW-DELETE    — looks like temporary/POC/video/ppt etc per user note
 *   REVIEW-MANUAL    — fits no heuristic; needs human classification
 *
 * Output: docs/audit/jrx-orphan-disposition.json
 *         docs/audit/jrx-orphan-disposition.md   (human-readable matrix)
 *
 * Heuristics are intentionally CONSERVATIVE — proposes, never deletes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT = path.join(ROOT, 'docs', 'audit', './jrx-wiring-audit.json');
const OUT_JSON = path.join(ROOT, 'docs', 'audit', './jrx-orphan-disposition.json');
const OUT_MD = path.join(ROOT, 'docs', 'audit', './jrx-orphan-disposition.md');

type Disposition =
  | 'WIRE-ROUTE'
  | 'WIRE-CHAIN'
  | 'WIRE-INTERNAL'
  | 'MERGE-DUPLICATE'
  | 'KEEP-BARREL'
  | 'KEEP-CLI'
  | 'KEEP-CONTRACT'
  | 'KEEP-TEST'
  | 'KEEP-DYNAMIC-IMPORT'
  | 'REVIEW-DELETE'
  | 'REVIEW-MANUAL';

const ALLOWLIST_PATH = path.join(ROOT, 'docs', 'audit', './jrx-orphan-allowlist.json');
function loadAllowlistMap(): Map<string, { category: Disposition; reason: string }> {
  const m = new Map<string, { category: Disposition; reason: string }>();
  try {
    const j = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')) as { entries: Array<{ file: string; category: string; reason: string }> };
    for (const e of j.entries) m.set(e.file, { category: e.category as Disposition, reason: e.reason });
  } catch {}
  return m;
}

interface OrphanRecord {
  file: string;
  area: string;
  bytes: number;
  lines: number;
  exports: string[];
  disposition: Disposition;
  reason: string;
  proposedMount?: string;        // suggested HTTP base path if WIRE-ROUTE
  duplicateCandidate?: string;   // sibling file if MERGE-DUPLICATE
}

function readHead(file: string, maxLines = 80): string {
  const src = fs.readFileSync(file, 'utf8');
  return src.split('\n').slice(0, maxLines).join('\n');
}

function lineCount(file: string): number {
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function listExports(head: string): string[] {
  const out = new Set<string>();
  const re = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) out.add(m[1]);
  return Array.from(out);
}

function findDuplicate(orphan: string, wiredFiles: Set<string>): string | undefined {
  const base = path.basename(orphan).replace(/\.ts$/, '');
  // Skip generic names like 'index.ts', 'types.ts' — basename match is meaningless.
  if (['index', 'types', 'utils', 'helpers', 'constants'].includes(base)) return undefined;
  const stripped = base.replace(/^(jrx-|jurexio-)/, '');
  // Only consider it a duplicate if (a) basename matches after prefix strip AND
  // (b) lives in the SAME parent directory (sibling file, not random match elsewhere).
  const orphanDir = path.dirname(orphan);
  for (const w of wiredFiles) {
    if (w === orphan) continue;
    const wb = path.basename(w).replace(/\.ts$/, '');
    const ws = wb.replace(/^(jrx-|jurexio-)/, '');
    if (ws !== stripped) continue;
    if (path.dirname(w) !== orphanDir) continue; // must be sibling
    return path.relative(ROOT, w);
  }
  return undefined;
}

function classify(rel: string, area: string, wiredFiles: Set<string>, allowlist: Map<string, { category: Disposition; reason: string }>): Pick<OrphanRecord, 'disposition' | 'reason' | 'proposedMount' | 'duplicateCandidate' | 'exports' | 'lines' | 'bytes'> {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  const head = readHead(abs);
  const lines = lineCount(abs);
  const exports = listExports(head);
  const fname = path.basename(rel);

  // 0. Allowlist override — authoritative human classification
  const al = allowlist.get(rel);
  if (al) {
    return { disposition: al.category, reason: `allowlisted: ${al.reason}`, exports, lines, bytes: stat.size };
  }

  const dup = findDuplicate(abs, wiredFiles);

  // 1. Barrel index.ts files
  if (fname === 'index.ts' && /^export\s+\*?\s*(from|\{)/m.test(head) && !/router|express|handler/i.test(head)) {
    return { disposition: 'KEEP-BARREL', reason: 'pure re-export barrel', exports, lines, bytes: stat.size };
  }

  // 2. CLI / test / seed entry points
  if (/-test\.ts$|\.test\.ts$|-seeding-service\.ts$|seed[s]?\.ts$/i.test(fname) ||
      /process\.argv|require\.main\s*===\s*module|import\.meta\.url/.test(head) && /async function main|function main\b/.test(head)) {
    return { disposition: 'KEEP-CLI', reason: 'test/seeding/CLI entry — intentionally not HTTP-wired', exports, lines, bytes: stat.size };
  }

  // 3. Microservice contract files (used at deploy/contract-test time)
  if (/microservice-contracts/.test(rel) || /CONTRACT|HTTP_CONTRACT|GRPC_CONTRACT/.test(head)) {
    return { disposition: 'KEEP-CONTRACT', reason: 'microservice contract definition', exports, lines, bytes: stat.size };
  }

  // 4. Duplicate-name candidate (likely older variant of a wired file)
  if (dup) {
    return { disposition: 'MERGE-DUPLICATE', reason: `name collision with wired file → likely older variant`, duplicateCandidate: dup, exports, lines, bytes: stat.size };
  }

  // 5. Per-user note: video/ppt/presentation generators are temporary, not product features
  if (/(^|\W)(video|ppt|powerpoint|presentation|slide-deck|voiceover)(-|\.|s?\.ts$)/i.test(fname)) {
    return { disposition: 'REVIEW-DELETE', reason: 'matches user-flagged temporary surface (video/ppt/voiceover) — confirm before delete', exports, lines, bytes: stat.size };
  }

  // 6. Middleware function (CHECK FIRST — before route detection — because
  //    middleware files often import express types too, and would otherwise
  //    be misclassified as WIRE-ROUTE).
  const isMiddlewareFile = /middleware|Middleware/i.test(rel) ||
    (/Request,\s*Response,\s*NextFunction/.test(head) && /next:\s*NextFunction|return\s+next\(|next\(\)/.test(head) && !/Router\(\)|router\.(get|post|put|delete|patch)/.test(head));
  if (isMiddlewareFile) {
    return { disposition: 'WIRE-CHAIN', reason: 'middleware function — insert into /api/jrx/* chain', exports, lines, bytes: stat.size };
  }

  // 7. Express router / route file — STRICT: must actually instantiate a
  //    Router or define route handlers. Mere `import { Request } from 'express'`
  //    no longer counts (caught DTOs/middleware as routes previously).
  if (/Router\(\)|express\.Router\(\)|router\.(get|post|put|delete|patch|use|all)\s*\(/.test(head)) {
    const mountGuess = `/api/jrx/${path.basename(rel, '.ts').replace(/^jrx-/, '').replace(/-routes?$/, '').replace(/-service$/, '')}`;
    return { disposition: 'WIRE-ROUTE', reason: 'instantiates Router() or defines router.METHOD handlers', proposedMount: mountGuess, exports, lines, bytes: stat.size };
  }

  // 8. Service / engine / pipeline / manager — likely wire-internal
  if (/class\s+\w+(Service|Engine|Manager|Adapter|Pipeline|Router|Checker|Verifier|Generator|Scorer|Optimizer|Coordinator)\b/.test(head) ||
      /Service|Engine|Manager|Adapter|Pipeline|Router|Checker|Verifier/i.test(fname)) {
    return { disposition: 'WIRE-INTERNAL', reason: 'service/engine/manager — wire by importing from a service that is reachable', exports, lines, bytes: stat.size };
  }

  // 9. Fallback
  return { disposition: 'REVIEW-MANUAL', reason: 'no heuristic matched — human classification needed', exports, lines, bytes: stat.size };
}

function main(): void {
  const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8')) as {
    buckets: Record<string, { wired: string[]; usedInternal: string[]; orphan: string[] }>;
  };

  // Build wired-file set (absolute paths) for duplicate detection
  const wiredFiles = new Set<string>();
  for (const area of Object.keys(audit.buckets)) {
    for (const f of audit.buckets[area].wired) wiredFiles.add(path.join(ROOT, f));
    for (const f of audit.buckets[area].usedInternal) wiredFiles.add(path.join(ROOT, f));
  }

  const allowlist = loadAllowlistMap();

  const records: OrphanRecord[] = [];
  for (const area of Object.keys(audit.buckets)) {
    for (const f of audit.buckets[area].orphan) {
      const c = classify(f, area, wiredFiles, allowlist);
      records.push({ file: f, area, ...c });
    }
  }

  // Tally
  const tally: Record<Disposition, number> = {
    'WIRE-ROUTE': 0, 'WIRE-CHAIN': 0, 'WIRE-INTERNAL': 0,
    'MERGE-DUPLICATE': 0, 'KEEP-BARREL': 0, 'KEEP-CLI': 0, 'KEEP-CONTRACT': 0,
    'KEEP-TEST': 0, 'KEEP-DYNAMIC-IMPORT': 0,
    'REVIEW-DELETE': 0, 'REVIEW-MANUAL': 0,
  };
  for (const r of records) tally[r.disposition]++;

  // Console summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NV ORPHAN DISPOSITION MATRIX');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total orphans analyzed: ${records.length}`);
  console.log('');
  const tagOrder: Disposition[] = ['WIRE-ROUTE', 'WIRE-CHAIN', 'WIRE-INTERNAL', 'MERGE-DUPLICATE', 'KEEP-BARREL', 'KEEP-CLI', 'KEEP-CONTRACT', 'KEEP-TEST', 'KEEP-DYNAMIC-IMPORT', 'REVIEW-DELETE', 'REVIEW-MANUAL'];
  for (const t of tagOrder) {
    console.log(`  ${t.padEnd(18)} ${String(tally[t]).padStart(4)}`);
  }
  console.log('');

  // Persist JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), tally, records }, null, 2));

  // Persist markdown matrix
  const md: string[] = [];
  md.push('# NV Orphan Disposition Matrix');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Total orphans: **${records.length}**`);
  md.push('');
  md.push('## Tally');
  md.push('');
  md.push('| Disposition | Count | Meaning |');
  md.push('|---|---:|---|');
  const meanings: Record<Disposition, string> = {
    'WIRE-ROUTE': 'Has Express router → mount under additive /api/jrx/... path (zero v5 impact)',
    'WIRE-CHAIN': 'Middleware function → insert into the /api/jrx/* safety-ring chain',
    'WIRE-INTERNAL': 'Service/engine class → import from a reachable service (no new HTTP)',
    'MERGE-DUPLICATE': 'Name collides with a wired file → merge or archive as older variant',
    'KEEP-BARREL': 'Pure re-export barrel — no wiring needed, intentional',
    'KEEP-CLI': 'Test/seed/CLI entry — intentionally not HTTP-wired',
    'KEEP-CONTRACT': 'Microservice contract spec — used at deploy/contract-test time',
    'REVIEW-DELETE': 'Matches user-flagged temporary surface (video/ppt/voiceover) — confirm',
    'REVIEW-MANUAL': 'No heuristic matched — needs human classification',
    'KEEP-TEST': 'Type-test or compile-time-only test — intentionally not in runtime graph',
    'KEEP-DYNAMIC-IMPORT': 'Consumed via await import() — invisible to static BFS auditor',
  };
  for (const t of tagOrder) {
    md.push(`| **${t}** | ${tally[t]} | ${meanings[t]} |`);
  }
  md.push('');
  md.push('## Per-orphan rows (grouped by disposition)');
  md.push('');
  for (const t of tagOrder) {
    const rows = records.filter((r) => r.disposition === t).sort((a, b) => a.file.localeCompare(b.file));
    if (rows.length === 0) continue;
    md.push(`### ${t} (${rows.length})`);
    md.push('');
    md.push('| File | Lines | Exports | Note |');
    md.push('|---|---:|---|---|');
    for (const r of rows) {
      const exp = r.exports.slice(0, 3).join(', ') + (r.exports.length > 3 ? `, +${r.exports.length - 3}` : '');
      const note = r.proposedMount ? `proposed mount: \`${r.proposedMount}\`` :
                   r.duplicateCandidate ? `dup of \`${r.duplicateCandidate}\`` :
                   r.reason;
      md.push(`| \`${r.file}\` | ${r.lines} | ${exp || '—'} | ${note} |`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log(`[orphan-disposition] wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`[orphan-disposition] wrote ${path.relative(ROOT, OUT_MD)}`);
}

main();
