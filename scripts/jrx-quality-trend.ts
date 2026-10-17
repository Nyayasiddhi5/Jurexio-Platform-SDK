#!/usr/bin/env tsx
/**
 * NV-QUALITY-TREND-001 — legal-answer quality tracked over time.
 *
 * The quality *harness* already exists (`scripts/jrx-eval-legal-accuracy.ts`,
 * plus `nv-ragas-eval.ts` and `nv-rerank-ndcg-eval.ts`) and it already writes a
 * timestamped scoreboard per run into `docs/audit/eval/`. What did not exist was
 * any way to answer the only question that matters over a release cycle:
 *
 *     "is legal answer quality getting better or worse than last time?"
 *
 * Every run overwrote `scoreboard-latest.*` and nothing compared runs, so a
 * regression was invisible unless somebody happened to remember the previous
 * number. This script closes that: it reads every `scoreboard-*.json` in
 * chronological order and reports per-jurisdiction deltas, flagging any metric
 * that moved the wrong way by more than a noise threshold.
 *
 * Deliberately NOT a new harness and NOT a new set of prompts
 * (NV-NO-DUPLICATE-001). It only reads what the existing eval already emits.
 *
 * Usage:
 *   npx tsx scripts/jrx-quality-trend.ts                 # report the trend
 *   npx tsx scripts/jrx-quality-trend.ts --gate          # non-zero exit on regression
 *   npx tsx scripts/jrx-quality-trend.ts --live-only     # ignore seed/dry runs
 *
 * Exit codes: 0 = no regression (or reporting only), 1 = regression detected
 * under --gate, 2 = not enough history to compare.
 */
import fs from 'fs';
import path from 'path';

/** Per-jurisdiction row as emitted by nv-eval-legal-accuracy.ts. */
type JurisdictionRow = {
  jurisdiction: string;
  itemsEvaluated?: number;
  accuracyPct?: number;
  citationFaithfulness?: number;
  hallucinationRatePct?: number;
  adversarialDetectionPct?: number;
  gatePassed?: boolean;
};

type Scoreboard = {
  generatedAt: string;
  mode?: string;
  releaseGatePassed?: boolean;
  jurisdictions: JurisdictionRow[];
};

type MetricKey =
  | 'accuracyPct'
  | 'citationFaithfulness'
  | 'hallucinationRatePct'
  | 'adversarialDetectionPct';

/**
 * `higherIsBetter: false` for hallucination — a rise there is a regression even
 * though the number went up. Getting this backwards is the classic way a
 * quality dashboard reports green while shipping worse answers.
 */
const METRICS: ReadonlyArray<{
  key: MetricKey;
  label: string;
  higherIsBetter: boolean;
  /** Movements smaller than this are treated as run-to-run noise. */
  noise: number;
}> = [
  { key: 'accuracyPct', label: 'accuracy %', higherIsBetter: true, noise: 1.0 },
  { key: 'citationFaithfulness', label: 'citation faithfulness', higherIsBetter: true, noise: 0.02 },
  { key: 'hallucinationRatePct', label: 'hallucination %', higherIsBetter: false, noise: 0.5 },
  { key: 'adversarialDetectionPct', label: 'adversarial detection %', higherIsBetter: true, noise: 1.0 },
];

const EVAL_DIR = path.resolve(process.cwd(), 'docs/audit/eval');

function loadScoreboards(liveOnly: boolean): Scoreboard[] {
  if (!fs.existsSync(EVAL_DIR)) return [];

  const boards: Scoreboard[] = [];
  for (const file of fs.readdirSync(EVAL_DIR)) {
    // `scoreboard-latest.json` is a duplicate of the newest timestamped file;
    // including it would compare a run against itself.
    if (!/^scoreboard-\d.*\.json$/.test(file)) continue;
    try {
      const raw = fs.readFileSync(path.join(EVAL_DIR, file), 'utf8');
      const parsed = JSON.parse(raw) as Scoreboard;
      if (!parsed.generatedAt || !Array.isArray(parsed.jurisdictions)) continue;
      if (liveOnly && parsed.mode !== 'live') continue;
      boards.push(parsed);
    } catch {
      // A corrupt scoreboard must not break the trend report.
      process.stderr.write(`  (skipped unreadable scoreboard: ${file})\n`);
    }
  }

  return boards.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

function fmt(v: number | undefined, digits = 2): string {
  return v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

function main(): void {
  const gate = process.argv.includes('--gate');
  const liveOnly = process.argv.includes('--live-only');

  const boards = loadScoreboards(liveOnly);

  console.log('');
  console.log('NV-QUALITY-TREND-001 — legal answer quality over time');
  console.log('='.repeat(80));

  if (boards.length === 0) {
    console.log('No scoreboards found in docs/audit/eval/.');
    console.log('Produce one first:  npm run eval:legal-accuracy');
    process.exit(2);
  }

  console.log(`Runs found: ${boards.length}${liveOnly ? ' (live only)' : ''}`);
  for (const b of boards) {
    const gateState = b.releaseGatePassed === true ? 'gate PASS' : 'gate FAIL';
    console.log(`  ${b.generatedAt}  mode=${b.mode ?? '?'}  ${gateState}`);
  }

  if (boards.length < 2) {
    console.log('');
    console.log('Only one run present — no comparison possible yet.');
    console.log('This script becomes useful from the second run onward.');
    process.exit(2);
  }

  const prev = boards[boards.length - 2];
  const curr = boards[boards.length - 1];

  console.log('');
  console.log(`Comparing:  ${prev.generatedAt}  →  ${curr.generatedAt}`);
  if (prev.mode !== curr.mode) {
    console.log(
      `  WARNING: mode changed (${prev.mode} → ${curr.mode}). Seed and live runs are `
      + `not comparable — rerun with --live-only for a like-for-like trend.`,
    );
  }
  console.log('');

  const regressions: string[] = [];
  const improvements: string[] = [];

  const jurisdictions = Array.from(
    new Set([
      ...prev.jurisdictions.map((j) => j.jurisdiction),
      ...curr.jurisdictions.map((j) => j.jurisdiction),
    ]),
  ).sort();

  for (const jc of jurisdictions) {
    const p = prev.jurisdictions.find((j) => j.jurisdiction === jc);
    const c = curr.jurisdictions.find((j) => j.jurisdiction === jc);

    if (!c) {
      regressions.push(`${jc}: dropped out of the eval set entirely`);
      continue;
    }
    if (!p) {
      console.log(`${jc.padEnd(4)}  (new jurisdiction this run)`);
      continue;
    }

    const cells: string[] = [];
    for (const m of METRICS) {
      const before = p[m.key];
      const after = c[m.key];
      if (typeof before !== 'number' || typeof after !== 'number') {
        cells.push(`${m.label}: — `);
        continue;
      }

      const delta = after - before;
      const moved = Math.abs(delta) >= m.noise;
      const better = m.higherIsBetter ? delta > 0 : delta < 0;
      const mark = !moved ? '=' : better ? '+' : '!';

      cells.push(`${m.label}: ${fmt(before)} → ${fmt(after)} ${mark}`);

      if (moved) {
        const line = `${jc} ${m.label}: ${fmt(before)} → ${fmt(after)}`;
        if (better) improvements.push(line);
        else regressions.push(line);
      }
    }

    console.log(`${jc.padEnd(4)}  ${cells.join('   ')}`);
  }

  console.log('');
  console.log('-'.repeat(80));
  console.log(`Improvements: ${improvements.length}    Regressions: ${regressions.length}`);

  if (improvements.length > 0) {
    console.log('');
    console.log('Improved:');
    for (const i of improvements) console.log(`  + ${i}`);
  }

  if (regressions.length > 0) {
    console.log('');
    console.log('REGRESSED:');
    for (const r of regressions) console.log(`  ! ${r}`);
  }

  // The absolute gate is the eval's own responsibility; this script only owns
  // the direction of travel. Both are reported so a run that is failing the
  // absolute bar cannot look healthy just because it improved.
  console.log('');
  console.log(
    `Absolute release gate on the latest run: `
    + `${curr.releaseGatePassed === true ? 'PASS' : 'FAIL'} `
    + `(owned by nv-eval-legal-accuracy.ts, not by this trend check)`,
  );

  if (gate && regressions.length > 0) {
    console.log('');
    console.log('EXIT 1: quality regressed since the previous run.');
    process.exit(1);
  }

  process.exit(0);
}

main();
