/**
 * NV-CITATOR-ATTRIBUTION-001 — build the treatment-attribution gold set.
 *
 * WHY A BUILDER AND NOT A HAND-WRITTEN FIXTURE
 * A gold set with fabricated labels makes every downstream precision number fiction. So no
 * passage text is authored here: each annotation names a corpus judgment, a harvested window,
 * and a verbatim `evidence` slice. This script splices the real window text in and EXITS
 * NON-ZERO if a slice is absent — meaning a label cannot silently drift away from the text it
 * claims to describe, and a hallucinated quotation fails the build rather than scoring as gold.
 *
 * Input windows were harvested from the live NYS corpus (43,505 embedded SC judgments) on
 * 2026-08-20 via /athena/extract over the judgment PDFs. Provenance and the two landmarks that
 * could NOT be sourced (413 above the 20 MB extraction cap) are recorded in
 * docs/audit/eval/jrx-treatment-attribution-2026-08-20.md.
 *
 * Usage:
 *   node scripts/jrx-build-attribution-goldset.mjs --windows <windows.json> [--out <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i === -1 || i + 1 >= args.length ? dflt : args[i + 1];
};

const ANNOTATIONS = resolve('docs/audit/eval/jrx-treatment-attribution-annotations.v1.json');
const OUT = resolve(argOf('--out', 'docs/audit/eval/jrx-treatment-attribution-set.v1.json'));
const WINDOWS = argOf('--windows', null);

if (!WINDOWS) {
  console.error('--windows <path> is required (harvested corpus windows).');
  process.exit(2);
}

const annotations = JSON.parse(readFileSync(ANNOTATIONS, 'utf8')).annotations;
const windows = JSON.parse(readFileSync(resolve(WINDOWS), 'utf8'));

/*
 * Corpus text is OCR-adjacent: pdf.js emits ligature damage ("antici~ patory"), inconsistent
 * curly quotes and collapsed whitespace. Matching is therefore done on a normalised form —
 * but the STORED passage stays verbatim, because a lawyer checking our evidence must see what
 * the reporter printed, not a cleaned-up paraphrase.
 */
const norm = (s) => String(s)
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const items = [];
const failures = [];

for (const a of annotations) {
  const judgment = windows[a.sourceJudgment];
  if (!judgment) {
    failures.push(`${a.id}: no harvested judgment ${a.sourceJudgment}`);
    continue;
  }
  const w = judgment.windows?.[a.window];
  if (!w) {
    failures.push(`${a.id}: judgment ${a.sourceJudgment} has no window ${a.window} (has ${judgment.windows?.length ?? 0})`);
    continue;
  }
  const haystack = norm(w.text);
  const needle = norm(a.evidence);
  if (!haystack.includes(needle)) {
    failures.push(`${a.id}: evidence slice absent from ${a.sourceJudgment} window ${a.window}`);
    continue;
  }
  items.push({
    id: a.id,
    target: a.target,
    expected: a.expected,
    control: a.control,
    labelBasis: a.labelBasis,
    note: a.note,
    source: {
      judgmentId: a.sourceJudgment.replace(/\.json$/, ''),
      title: judgment.title ?? null,
      citation: judgment.citation ?? null,
      year: judgment.year ?? null,
      bodyChars: judgment.len ?? null,
      windowIndex: a.window,
      phrase: w.phrase,
      charOffset: w.at,
    },
    evidence: a.evidence,
    /* The passage a full-body scan would actually see around the phrase. Verbatim. */
    passage: w.text,
  });
}

if (failures.length > 0) {
  console.error('✗ NV-ATTRIBUTION-GOLDSET: evidence verification failed — refusing to write a gold set with unverifiable labels.');
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

const byControl = {};
const byExpected = {};
const byBasis = {};
for (const it of items) {
  byControl[it.control] = (byControl[it.control] ?? 0) + 1;
  byExpected[it.expected] = (byExpected[it.expected] ?? 0) + 1;
  byBasis[it.labelBasis] = (byBasis[it.labelBasis] ?? 0) + 1;
}

const out = {
  id: 'jrx-treatment-attribution-set',
  version: 1,
  builtAt: new Date().toISOString(),
  provenance: {
    corpus: 'NYS caselaw, Indian Supreme Court tier (43,505 embedded judgments)',
    sourcedVia: 'POST /api/athena/extract over judgment PDFs, on the caselaw host',
    sourcedOn: '2026-08-20',
    labelSemantics:
      'expected describes WHAT THE TEXT SAYS about the named authority, not whether that authority is good law today. Only text-derived labels are scored.',
    unsourceable: [
      'HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA (1973) — PDF 35.8 MB, above the deployed 20 MB extraction cap (HTTP 413)',
      'MANEKA GANDHI versus UNION OF INDIA (1978) — PDF 60.9 MB, HTTP 413',
    ],
  },
  counts: { total: items.length, byExpected, byControl, byBasis },
  items,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`✓ NV-ATTRIBUTION-GOLDSET: ${items.length} items, all evidence slices verified against corpus text.`);
console.log(`  expected: ${JSON.stringify(byExpected)}`);
console.log(`  controls: ${JSON.stringify(byControl)}`);
console.log(`  basis:    ${JSON.stringify(byBasis)}`);
console.log(`  → ${OUT}`);
