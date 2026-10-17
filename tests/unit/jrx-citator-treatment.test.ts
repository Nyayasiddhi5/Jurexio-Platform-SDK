/**
 * NV-CITATOR-NEGATIVE-TREATMENT-001 — the §1c interim for NSP.
 *
 * The safety property under test is NEGATIVE: this module must never tell a lawyer an
 * authority is safe. NSP's own framing was that a silent omission becomes "good law" in any
 * UI, so `goodLaw` is always present and `good` is unreachable from a bounded retrieval.
 */
import { describe, it, expect } from 'vitest';
import { detectNegativeTreatment } from '../../src/services/jrx-citator-treatment.js';

const p = (text: string, citation?: string) => ({ text, citation: citation ?? null });

describe('detectNegativeTreatment — goodLaw is always present', () => {
  it('returns unknown (never undefined) when nothing was retrieved', () => {
    const r = detectNegativeTreatment({ passages: [] });
    expect(r.goodLaw).toBe('unknown');
    expect(r.unknownReason).toBe('no_passages_retrieved');
    // Coverage must be present even on the empty path, or the caller cannot distinguish
    // "nothing found" from "we did not look".
    expect(r.coverage.passagesScanned).toBe(0);
  });

  it('returns unknown when passages exist but carry no treatment language', () => {
    const r = detectNegativeTreatment({
      passages: [p('The appeal is allowed. Costs shall follow the event.')],
    });
    expect(r.goodLaw).toBe('unknown');
    expect(r.unknownReason).toBe('no_treatment_language_found');
  });

  it('NEVER asserts good, even when every passage is positive', () => {
    /*
     * The single most dangerous thing this module could do. Absence of adverse language in
     * a handful of retrieved passages is not evidence of good law, and a UI would render
     * `good` as a safety assurance.
     */
    const r = detectNegativeTreatment({
      passages: [
        p('We respectfully follow the ratio in the said decision.'),
        p('The decision is affirmed.'),
        p('Referred to with approval in a later Bench.'),
      ],
    });
    expect(r.goodLaw).not.toBe('good');
    expect(r.goodLaw).toBe('unknown');
    // The positive treatments are still REPORTED — they are useful, just not a verdict.
    expect(r.treatments.map((t) => t.treatment)).toContain('followed');
  });
});

describe('detectNegativeTreatment — negative treatment detection', () => {
  it('detects overruling from the templated Indian phrasing', () => {
    for (const phrase of [
      'The decision in Vodafone stands overruled by this Court.',
      'That judgment is hereby overruled.',
      'We overrule the view taken therein.',
      'It is no longer good law after the Constitution Bench ruling.',
      'The said decision does not lay down the correct law.',
    ]) {
      const r = detectNegativeTreatment({ passages: [p(phrase)] });
      expect(r.goodLaw, phrase).toBe('overruled');
    }
  });

  it('treats per incuriam as overruled for good-law purposes', () => {
    const r = detectNegativeTreatment({
      passages: [p('The earlier ruling was rendered per incuriam and cannot bind us.')],
    });
    expect(r.goodLaw).toBe('overruled');
    expect(r.treatments[0].treatment).toBe('per_incuriam');
  });

  it('detects doubt without escalating it to overruled', () => {
    const r = detectNegativeTreatment({
      passages: [p('We respectfully doubt the correctness of the said decision.')],
    });
    expect(r.goodLaw).toBe('doubted');
  });

  it('a larger-bench reference counts as doubted, not overruled', () => {
    const r = detectNegativeTreatment({
      passages: [p('The matter is referred to a larger bench for reconsideration.')],
    });
    expect(r.goodLaw).toBe('doubted');
  });

  it('overruling outranks doubt when both appear across passages', () => {
    const r = detectNegativeTreatment({
      passages: [
        p('We doubt the correctness of the view.'),
        p('That decision stands overruled.'),
      ],
    });
    expect(r.goodLaw).toBe('overruled');
  });

  it('does not double-count one passage that uses two adverse phrases', () => {
    // "overruled … per incuriam" in one passage is ONE finding; reporting two would let a
    // UI count two adverse treatments where there is one.
    const r = detectNegativeTreatment({
      passages: [p('That judgment stands overruled, having been rendered per incuriam.')],
    });
    expect(r.treatments).toHaveLength(1);
  });

  it('distinguished is neutral — it must not mark an authority unsafe', () => {
    const r = detectNegativeTreatment({
      passages: [p('The cited decision is distinguishable on facts.')],
    });
    expect(r.goodLaw).toBe('unknown');
    expect(r.treatments[0].treatment).toBe('distinguished');
  });
});

describe('detectNegativeTreatment — NSP\u2019s three required properties', () => {
  it('every row carries extractedBy so inferred is never shown as editorial', () => {
    const r = detectNegativeTreatment({
      passages: [p('That decision stands overruled.'), p('We respectfully follow it.')],
    });
    expect(r.treatments.length).toBeGreaterThan(0);
    for (const t of r.treatments) expect(t.extractedBy).toBe('deterministic');
  });

  it('every row carries the passage that establishes it', () => {
    const r = detectNegativeTreatment({
      passages: [p('The appeal succeeds. That decision stands overruled by this Court. Costs follow.')],
    });
    expect(r.treatments[0].paragraph).toContain('stands overruled');
    // Trimmed to a sentence, not the whole blob.
    expect(r.treatments[0].paragraph!.length).toBeLessThan(320);
  });

  it('coverage is on every response, including corpus coverage and the retrieval cap', () => {
    const r = detectNegativeTreatment({
      passages: [p('x')],
      corpusCoveragePct: 69.69,
      retrievalLimited: true,
    });
    expect(r.coverage.corpusCoveragePct).toBe(69.69);
    expect(r.coverage.retrievalLimited).toBe(true);
    expect(r.coverage.passagesScanned).toBe(1);
  });

  it('corpusCoveragePct is null rather than invented when unavailable', () => {
    const r = detectNegativeTreatment({ passages: [p('x')] });
    expect(r.coverage.corpusCoveragePct).toBeNull();
  });

  it('confidence describes the extraction and stays below certainty', () => {
    const r = detectNegativeTreatment({ passages: [p('That decision stands overruled.')] });
    // Attributing a phrase to THIS authority rather than another discussed nearby is the
    // part we cannot verify from a passage alone, so 1.0 would be dishonest.
    expect(r.treatments[0].confidence).toBeGreaterThan(0.5);
    expect(r.treatments[0].confidence).toBeLessThan(1);
  });

  it('picks up an Indian citation from the passage when none was supplied', () => {
    /*
     * Regression: the first CITATION_RE prefixed the SCC alternative with `\b`, which can
     * never match before `(` — so `(2012) 6 SCC 613`, the commonest Indian form, silently
     * returned null while AIR and SCC OnLine still matched. Half-working looked working.
     */
    const cases: Array<[string, string]> = [
      ['In (2012) 6 SCC 613 the earlier view stands overruled.', 'SCC'],
      ['Per AIR 1973 SC 1461 that decision stands overruled.', 'AIR'],
      ['In 2020 SCC OnLine SC 123 the view stands overruled.', 'OnLine'],
    ];
    for (const [text, expected] of cases) {
      const r = detectNegativeTreatment({ passages: [p(text)] });
      expect(r.treatments[0].citation, text).toBeTruthy();
      expect(r.treatments[0].citation as string, text).toContain(expected);
    }
  });
});

describe('the endpoint must not be presentable as a full citator', () => {
  it('states its limitations in the payload', () => {
    const src = readRoute();
    expect(src).toContain('Not a citation graph');
    expect(src).toContain('`good` is never asserted');
  });

  it('always returns goodLaw and coverage', () => {
    const src = readRoute();
    /* NV-CITATOR-AUTHORITY-RESOLVE-001 replaced the direct passthrough with a guard that
     * forces `unknown` when the authority could not be identified. `goodLaw` is still
     * unconditionally present — which is what this test exists to protect — but it now
     * reads from the guarded local rather than straight off the verdict. */
    expect(src).toContain("authorityUnresolved ? 'unknown' : verdict.goodLaw");
    expect(src).toMatch(/^\s*goodLaw,$/m);
    expect(src).toContain('coverage: verdict.coverage');
  });
});

function readRoute(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path') as typeof import('path');
  return readFileSync(
    path.join(process.cwd(), 'src/routes/jrx-knowledge-plane-routes.ts'),
    'utf8',
  );
}
