/**
 * NV-CITATOR-ATTRIBUTION-001 — measure attribution precision/recall on the gold set.
 *
 * WHY PRECISION IS THE GATE AND RECALL IS NOT
 * A false `overruled` makes a lawyer discard valid law, and unlike a missed overruling they
 * never find out they were wrong. A miss leaves the verdict at `unknown`, which the panel
 * renders as "not cleared" — an honest non-answer. So the two errors are not symmetric and
 * must not be summarised into one number: this harness reports precision and recall
 * separately, with the full confusion matrix, and gates only on precision.
 *
 * "Adverse finding" = the scan concluded `overruled` or `doubted` for the named authority.
 * Precision = adverse findings that the text supports / all adverse findings.
 *
 * Usage:
 *   npx tsx scripts/jrx-eval-treatment-attribution.ts [--gate] [--baseline] [--json <path>]
 *     --gate      exit non-zero below the 95% precision bar
 *     --baseline  ALSO run the un-attributed detector, to show what attribution bought
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectNegativeTreatment } from '../src/services/jrx-citator-treatment.js';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const argOf = (f: string, d: string | null = null) => {
  const i = args.indexOf(f);
  return i === -1 || i + 1 >= args.length ? d : args[i + 1];
};

const PRECISION_BAR = 0.95;
const SET = resolve('docs/audit/eval/jrx-treatment-attribution-set.v1.json');

interface GoldItem {
  id: string;
  target: string;
  expected: 'overruled' | 'doubted' | 'unknown';
  control: string;
  labelBasis: string;
  note: string;
  evidence: string;
  passage: string;
  source: { judgmentId: string; title: string | null; year: number | null; windowIndex: number };
}

const gold = JSON.parse(readFileSync(SET, 'utf8')) as { items: GoldItem[]; counts: unknown };
/* Only text-derived labels are scored. A legal-status label would need counsel sign-off and
 * scoring against it would launder an unverified claim into a precision number. */
const scored = gold.items.filter((i) => i.labelBasis === 'text-derived');

type Verdict = 'overruled' | 'doubted' | 'unknown';
const isAdverse = (v: Verdict) => v === 'overruled' || v === 'doubted';

interface Row {
  item: GoldItem;
  got: Verdict;
  outcome: 'TP' | 'FP' | 'TN' | 'FN' | 'WRONG-SEVERITY';
  method: string | null;
}

function run(attributed: boolean): Row[] {
  return scored.map((item) => {
    const r = detectNegativeTreatment({
      passages: [{ text: item.passage, citation: null }],
      ...(attributed ? { targetAuthority: item.target } : {}),
    });
    const got = r.goodLaw as Verdict;
    const method = r.treatments.find((t) => t.attributionMethod)?.attributionMethod ?? null;
    let outcome: Row['outcome'];
    if (isAdverse(item.expected) && isAdverse(got)) {
      outcome = item.expected === got ? 'TP' : 'WRONG-SEVERITY';
    } else if (!isAdverse(item.expected) && isAdverse(got)) {
      outcome = 'FP';
    } else if (isAdverse(item.expected) && !isAdverse(got)) {
      outcome = 'FN';
    } else {
      outcome = 'TN';
    }
    return { item, got, outcome, method };
  });
}

function summarise(rows: Row[]) {
  const n = (o: Row['outcome']) => rows.filter((r) => r.outcome === o).length;
  const tp = n('TP');
  const ws = n('WRONG-SEVERITY');
  const fp = n('FP');
  const fn = n('FN');
  const tn = n('TN');
  /* A WRONG-SEVERITY row asserted adverse treatment of the right authority but the wrong
   * kind. It counted as an adverse finding, so it must count against precision — calling it a
   * hit would hide an over-claim (doubted reported as overruled is exactly the over-claim that
   * makes a lawyer abandon good law). */
  const adverseFindings = tp + ws + fp;
  const precision = adverseFindings === 0 ? null : tp / adverseFindings;
  const positives = tp + ws + fn;
  const recall = positives === 0 ? null : tp / positives;
  return { tp, ws, fp, fn, tn, adverseFindings, precision, recall, total: rows.length };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

const attributedRows = run(true);
const attributedStats = summarise(attributedRows);

console.log('NV-CITATOR-ATTRIBUTION-001 — treatment attribution on the corpus gold set');
console.log(`gold items: ${gold.items.length} total, ${scored.length} scored (text-derived labels only)\n`);

console.log('WITH ATTRIBUTION (the shipped path)');
console.log('  confusion matrix');
console.log(`    true positive       (adverse, correct kind) : ${attributedStats.tp}`);
console.log(`    wrong severity      (adverse, wrong kind)   : ${attributedStats.ws}`);
console.log(`    FALSE POSITIVE      (adverse, text says no) : ${attributedStats.fp}`);
console.log(`    false negative      (missed a real finding) : ${attributedStats.fn}`);
console.log(`    true negative       (correctly said nothing): ${attributedStats.tn}`);
console.log(`  adverse findings made : ${attributedStats.adverseFindings}`);
console.log(`  PRECISION             : ${pct(attributedStats.precision)}   (gate: >= ${PRECISION_BAR * 100}%)`);
console.log(`  recall                : ${pct(attributedStats.recall)}   (not gated — a miss leaves "unknown")`);

if (attributedStats.fp > 0) {
  console.log('\n  FALSE POSITIVES — each one would tell a lawyer to discard valid law:');
  for (const r of attributedRows.filter((x) => x.outcome === 'FP')) {
    console.log(`    ✗ ${r.item.id} [${r.item.control}] got=${r.got} via=${r.method ?? 'n/a'}`);
    console.log(`      ${r.item.note}`);
  }
}
if (attributedStats.fn > 0) {
  console.log('\n  false negatives — these leave the verdict at "unknown", which is honest:');
  for (const r of attributedRows.filter((x) => x.outcome === 'FN')) {
    console.log(`    · ${r.item.id} [${r.item.control}] expected=${r.item.expected} got=${r.got}`);
  }
}

let baselineStats: ReturnType<typeof summarise> | null = null;
if (has('--baseline')) {
  baselineStats = summarise(run(false));
  console.log('\nWITHOUT ATTRIBUTION (detection only — what a full-body backfill would have shipped)');
  console.log(`    false positives : ${baselineStats.fp}`);
  console.log(`    PRECISION       : ${pct(baselineStats.precision)}`);
  console.log(`    recall          : ${pct(baselineStats.recall)}`);
}

console.log('\n  per-control breakdown (with attribution)');
const controls = [...new Set(scored.map((i) => i.control))].sort();
for (const c of controls) {
  const rs = attributedRows.filter((r) => r.item.control === c);
  const bad = rs.filter((r) => r.outcome === 'FP' || r.outcome === 'FN' || r.outcome === 'WRONG-SEVERITY').length;
  console.log(`    ${c.padEnd(30)} ${rs.length - bad}/${rs.length} correct`);
}

const jsonOut = argOf('--json');
if (jsonOut) {
  writeFileSync(resolve(jsonOut), `${JSON.stringify({
    ranAt: new Date().toISOString(),
    precisionBar: PRECISION_BAR,
    attributed: attributedStats,
    baseline: baselineStats,
    rows: attributedRows.map((r) => ({ id: r.item.id, control: r.item.control, expected: r.item.expected, got: r.got, outcome: r.outcome, method: r.method })),
  }, null, 2)}\n`);
  console.log(`\n  → ${resolve(jsonOut)}`);
}

const met = attributedStats.precision !== null && attributedStats.precision >= PRECISION_BAR;
console.log(`\nVERDICT: precision bar ${met ? 'MET' : 'NOT MET'} — backfill ${met ? 'may be authorised' : 'must NOT be authorised'}.`);
if (has('--gate') && !met) process.exit(1);
