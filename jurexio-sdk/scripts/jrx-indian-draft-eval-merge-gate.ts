#!/usr/bin/env tsx
/**
 * Merge fast + counsel scoreboards and apply counsel >= fast + 5 gate.
 *
 *   tsx scripts/jrx-indian-draft-eval-merge-gate.ts \
 *     docs/audit/eval/draft-scoreboard-fast.json \
 *     docs/audit/eval/draft-scoreboard-counsel-*.json
 */
import fs from 'node:fs';
import path from 'node:path';

type RunRow = { caseId: string; rubricPct: number };
type Scoreboard = {
  lanes?: {
    fast_medium?: { avgRubricPct?: number; runs?: RunRow[] };
    counsel_comprehensive?: { avgRubricPct?: number; runs?: RunRow[] };
  };
};

function load(p: string): Scoreboard {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Scoreboard;
}

function avg(rows: RunRow[]): number {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((a, b) => a + b.rubricPct, 0) / rows.length);
}

const argv = process.argv.slice(2);
const stageFlag = argv.find((a) => a.startsWith('--stage='));
const stage = stageFlag?.split('=')[1] ?? process.env.JRX_OPTION_B_GATE_STAGE ?? 'merge';
const files = argv.filter((a) => !a.startsWith('--'));
if (files.length < 2) {
  console.error('usage: merge-gate [--stage=merge|release95] <fast-scoreboard.json> <counsel-scoreboard.json> [...]');
  process.exit(2);
}

const fastBoard = files.find((f) => {
  const b = load(f);
  return (b.lanes?.fast_medium?.runs?.length ?? 0) > 0;
});
if (!fastBoard) {
  console.error('no scoreboard with fast_medium runs');
  process.exit(2);
}

const fastRuns = [...(load(fastBoard).lanes!.fast_medium!.runs ?? [])];
const counselByCase = new Map<string, RunRow>();

for (const f of files) {
  const runs = load(f).lanes?.counsel_comprehensive?.runs ?? [];
  for (const r of runs) counselByCase.set(r.caseId, r);
}

const counselRuns = [...counselByCase.values()].sort((a, b) => a.caseId.localeCompare(b.caseId));
const fastAvg = avg(fastRuns);
const counselAvg = avg(counselRuns);

console.log(`fast_avg=${fastAvg}% (n=${fastRuns.length}) counsel_avg=${counselAvg}% (n=${counselRuns.length})`);
console.log('case\tfast\tcounsel\tdelta');
for (const fr of fastRuns) {
  const cr = counselByCase.get(fr.caseId);
  const cPct = cr?.rubricPct ?? -1;
  const delta = cPct >= 0 ? cPct - fr.rubricPct : NaN;
  console.log(`${fr.caseId}\t${fr.rubricPct}\t${cPct}\t${Number.isFinite(delta) ? delta : '—'}`);
}

const gateNeed = fastAvg + 5;
const release95Floor = Number(process.env.JRX_OPTION_B_RELEASE95_FLOOR ?? 95);
let gatePass = counselRuns.length >= fastRuns.length && counselAvg >= gateNeed;
let gateStage: string = stage;
if (stage === 'release95') {
  gateStage = 'release95';
  gatePass = counselRuns.length >= fastRuns.length
    && counselAvg >= release95Floor
    && fastAvg >= release95Floor;
} else {
  gateStage = 'merge';
}
const out = {
  mergedAt: new Date().toISOString(),
  gateStage,
  release95Floor: stage === 'release95' ? release95Floor : undefined,
  fastScoreboard: path.basename(fastBoard),
  counselScoreboards: files.filter((f) => f !== fastBoard).map((f) => path.basename(f)),
  fastAvg,
  counselAvg,
  gateNeed,
  gatePass,
  perCase: fastRuns.map((fr) => ({
    caseId: fr.caseId,
    fast: fr.rubricPct,
    counsel: counselByCase.get(fr.caseId)?.rubricPct,
    delta: (counselByCase.get(fr.caseId)?.rubricPct ?? 0) - fr.rubricPct,
  })),
};
const outPath = path.resolve(
  process.cwd(),
  'docs/audit/eval',
  `draft-scoreboard-merged-gate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`merged=${outPath}`);

if (counselRuns.length < fastRuns.length) {
  console.error(`GATE INCOMPLETE: counsel runs ${counselRuns.length}/${fastRuns.length}`);
  process.exit(3);
}
if (!gatePass) {
  if (gateStage === 'release95') {
    console.error(`GATE FAIL (release95): fast=${fastAvg}% counsel=${counselAvg}% need both >= ${release95Floor}%`);
  } else {
    console.error(`GATE FAIL (merge): counsel ${counselAvg} < fast+5 (${gateNeed})`);
  }
  process.exit(1);
}
if (gateStage === 'release95') {
  console.log(`GATE PASS (release95): fast=${fastAvg}% counsel=${counselAvg}% >= ${release95Floor}%`);
} else {
  console.log(`GATE PASS (merge): counsel ${counselAvg} >= fast+5 (${gateNeed})`);
}
