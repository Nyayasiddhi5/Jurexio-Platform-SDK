/**
 * NV-BENCH-COST-001 / NV-ZEROCOST-ATTRIBUTION-001 — attribution unit tests.
 *
 * The v1 detector had exactly one rule for a zero-completion run
 * (`expectFanoutMax > 0 && billed === 0` → "answered out of scope"), which made a
 * cache hit, a deterministic answer and an over-fire indistinguishable. These
 * tests pin each of those apart, and pin the two cases the module must REFUSE to
 * decide rather than guess.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  attributeRun,
  classifyItemExpectation,
  readResolutionSignal,
  isDeclaredRepeat,
  summariseAttribution,
  RESOLUTIONS,
} from '../../scripts/_nv-benchmark-attribution.mjs';

const REPO = path.resolve(__dirname, '../..');

/** Minimal run record in the shape `_ec2-bench-cost-run.sh` writes. */
function rec({ billed = 0, scopeMode = 'requestId', run = 1, itemId = 1, nyv = {}, truth = {} } = {}) {
  return {
    itemId,
    run,
    nyv: { envelopeModel: 'gemini-3.1-pro-preview', ...nyv },
    truth: { billedCompletions: billed, scopeMode, ...truth },
  };
}

const escalatingItem = { id: 9, classId: 'legal-research', mustEscalate: true, expectFanoutMin: 1 };
const lookupItem = { id: 3, classId: 'statute-faq', zeroLlmExpected: true, expectFanoutMax: 0 };

describe('attribution — the three cases v1 collapsed into one', () => {
  it('classifies a semantic cache hit on a declared repeat as a saving, reported separately', () => {
    const a = attributeRun({
      item: { ...lookupItem, id: 23, classId: 'cache-repeat', cacheExpectation: 'expect-hit', runAfter: 3 },
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'semantic-cache', envelopeCacheSemanticMatch: true } }),
      nyvAnswer: 'x'.repeat(400),
    });

    expect(a.verdict).toBe('cache-win-repeat');
    expect(a.countsAsSaving).toBe(true);
    expect(a.reportSeparately).toBe(true);
    expect(a.cacheProvenance).toBe('declared-repeat');
    expect(a.signal).toBe('envelope');
    expect(a.flags).toHaveLength(0);
  });

  it('separates a cache hit on a FRESH question from one on a repeat', () => {
    const a = attributeRun({
      item: { id: 7, classId: 'single-issue-advice', mustEscalate: true, cacheExpectation: 'expect-miss' },
      rec: rec({ billed: 0, run: 1, nyv: { envelopeResolution: 'semantic-cache' } }),
      nyvAnswer: 'y'.repeat(400),
    });

    expect(a.verdict).toBe('cache-win-fresh');
    expect(a.countsAsSaving).toBe(true);
    expect(a.cacheProvenance).toBe('fresh-question');
  });

  it('classifies a deterministic answer to a lookup class as a saving', () => {
    const a = attributeRun({
      item: lookupItem,
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver', envelopeModel: 'nys-statute-section' } }),
      nyvAnswer: 'BNS 106 ...',
    });

    expect(a.verdict).toBe('deterministic-win');
    expect(a.countsAsSaving).toBe(true);
    expect(a.flags).toHaveLength(0);
  });

  it('classifies a deterministic answer to a class that must escalate as an over-fire, NOT a saving', () => {
    const a = attributeRun({
      item: escalatingItem,
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver' } }),
      nyvAnswer: 'bare statute excerpt',
    });

    expect(a.verdict).toBe('deterministic-over-fire');
    expect(a.countsAsSaving).toBe(false);
    expect(a.requiresModel).toBe(true);
    expect(a.expectationSource).toBe('mustEscalate');
    expect(a.flags.join(' ')).toContain('NV-DETERMINISTIC-OVERFIRE-001');
  });

  it('treats the statute fast path as an over-fire on the same terms as the resolver', () => {
    const a = attributeRun({
      item: { id: 24, classId: 'adversarial-scope', mustEscalate: true },
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'statute-fast-path', envelopeModel: 'nys-statute-faq' } }),
      nyvAnswer: 'BNSS 482 reads as follows ...',
    });

    expect(a.verdict).toBe('deterministic-over-fire');
    expect(a.countsAsSaving).toBe(false);
  });

  it('does not confuse a saving with an over-fire when the SAME resolution meets different expectations', () => {
    const asRec = rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver' } });
    expect(attributeRun({ item: lookupItem, rec: asRec }).countsAsSaving).toBe(true);
    expect(attributeRun({ item: escalatingItem, rec: asRec }).countsAsSaving).toBe(false);
  });
});

describe('attribution — cases the detector must refuse to decide', () => {
  it('reports the v1 situation (zero completions, no stated mechanism) as an instrument gap, not a saving', () => {
    const a = attributeRun({ item: escalatingItem, rec: rec({ billed: 0 }) });

    expect(a.verdict).toBe('unattributable');
    expect(a.countsAsSaving).toBe(false);
    expect(a.instrumentGap).toBe(true);
    expect(a.signal).toBe('none');
    expect(a.flags.join(' ')).toContain('cost.resolution');
  });

  it('refuses to attribute when no independent billed count exists', () => {
    const a = attributeRun({
      item: escalatingItem,
      rec: rec({ billed: null, nyv: { envelopeResolution: 'semantic-cache' } }),
    });

    expect(a.verdict).toBe('unattributable');
    expect(a.instrumentGap).toBe(true);
  });

  it('refuses to attribute a zero-cost answer on an item that declares no expectation', () => {
    const a = attributeRun({
      item: { id: 99, classId: 'unknown' },
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver' } }),
    });

    expect(a.verdict).toBe('unattributable');
    expect(a.requiresModel).toBeNull();
    expect(a.instrumentGap).toBe(true);
  });

  it('surfaces a disagreement between the envelope and the provider log instead of picking one', () => {
    const a = attributeRun({
      item: escalatingItem,
      rec: rec({ billed: 3, nyv: { envelopeResolution: 'semantic-cache' } }),
    });

    expect(a.verdict).toBe('signal-conflict');
    expect(a.countsAsSaving).toBe(false);
    expect(a.instrumentGap).toBe(true);
  });
});

describe('attribution — cross-prompt cache match (the defect the v1 SET manufactured)', () => {
  const shared = 'A'.repeat(500);

  it('flags a cache answer byte-identical to a different prompt as a cross-hit, not a saving', () => {
    const a = attributeRun({
      item: { id: 10, classId: 'legal-research', mustEscalate: true },
      rec: rec({ itemId: 10, billed: 0, nyv: { envelopeResolution: 'semantic-cache', envelopeCacheSemanticMatch: true } }),
      nyvAnswer: shared,
      peerAnswers: { 9: shared },
    });

    expect(a.verdict).toBe('cache-cross-hit');
    expect(a.countsAsSaving).toBe(false);
    expect(a.crossHitItemId).toBe('9');
  });

  it('ignores whitespace differences but does not treat a short answer as a distinctive match', () => {
    const long = attributeRun({
      item: lookupItem,
      rec: rec({ itemId: 2, billed: 0, nyv: { envelopeResolution: 'semantic-cache' } }),
      nyvAnswer: `  ${shared}  `,
      peerAnswers: { 1: shared },
    });
    expect(long.verdict).toBe('cache-cross-hit');

    const short = attributeRun({
      item: lookupItem,
      rec: rec({ itemId: 2, billed: 0, nyv: { envelopeResolution: 'semantic-cache' } }),
      nyvAnswer: 'BNS 103.',
      peerAnswers: { 1: 'BNS 103.' },
    });
    expect(short.verdict).toBe('cache-win-fresh');
  });
});

describe('attribution — ordinary billed runs and abstentions', () => {
  it('attributes a billed run without judging it as a saving either way', () => {
    const a = attributeRun({
      item: escalatingItem,
      rec: rec({ billed: 1, nyv: { envelopeResolution: 'llm' } }),
    });

    expect(a.verdict).toBe('billed-llm');
    expect(a.countsAsSaving).toBeNull();
    expect(a.billedCompletions).toBe(1);
    expect(a.scopeMode).toBe('requestId');
  });

  it('does not count an abstention as a saving', () => {
    const a = attributeRun({
      item: { id: 26, classId: 'adversarial-scope', zeroLlmExpected: true },
      rec: rec({ billed: 0, nyv: { envelopeResolution: 'rag-abstain' } }),
    });

    expect(a.verdict).toBe('abstain');
    expect(a.countsAsSaving).toBe(false);
  });
});

describe('signal provenance', () => {
  it('prefers the envelope over the log line', () => {
    const s = readResolutionSignal(rec({
      nyv: { envelopeResolution: 'semantic-cache' },
      truth: { resolutionLines: [{ resolution: 'deterministic-resolver' }] },
    }));

    expect(s.resolution).toBe('semantic-cache');
    expect(s.signal).toBe('envelope');
  });

  it('falls back to the request-scoped log line when the envelope is silent', () => {
    const s = readResolutionSignal(rec({
      truth: { resolutionLines: [{ resolution: 'statute-fast-path', detail: 'nys-statute-faq' }] },
    }));

    expect(s.resolution).toBe('statute-fast-path');
    expect(s.signal).toBe('log');
    expect(s.detail).toBe('nys-statute-faq');
  });

  it('recognises a deterministic answer from the model id alone, marked as the weaker source', () => {
    const s = readResolutionSignal(rec({ nyv: { envelopeModel: 'nys-statute-faq' } }));

    expect(s.resolution).toBe('deterministic-resolver');
    expect(s.signal).toBe('model-name');
  });

  it('cannot identify a cache hit from the model id, because a hit reports the original model name', () => {
    const s = readResolutionSignal(rec({ nyv: { envelopeModel: 'gemini-3.1-pro-preview' } }));

    expect(s.resolution).toBeNull();
    expect(s.signal).toBe('none');
  });

  it('ignores an unrecognised resolution string rather than trusting it', () => {
    const s = readResolutionSignal(rec({ nyv: { envelopeResolution: 'free-because-i-said-so', envelopeModel: 'x' } }));

    expect(s.resolution).toBeNull();
    expect(s.signal).toBe('none');
  });
});

describe('expectation and repeat declarations', () => {
  it('reads requiresModel from the most explicit declaration available', () => {
    expect(classifyItemExpectation({ mustEscalate: true })).toEqual({ requiresModel: true, source: 'mustEscalate' });
    expect(classifyItemExpectation({ zeroLlmExpected: true })).toEqual({ requiresModel: false, source: 'zeroLlmExpected' });
    expect(classifyItemExpectation({ expectFanoutMin: 1 }).requiresModel).toBe(true);
    expect(classifyItemExpectation({ expectFanoutMax: 0 }).requiresModel).toBe(false);
    expect(classifyItemExpectation({}).requiresModel).toBeNull();
  });

  it('treats a repeat as declared, never inferred from answer text', () => {
    expect(isDeclaredRepeat({ cacheExpectation: 'expect-hit' }, { run: 1 })).toBe(true);
    expect(isDeclaredRepeat({ runAfter: 3 }, { run: 1 })).toBe(true);
    expect(isDeclaredRepeat({}, { run: 2 })).toBe(true);
    expect(isDeclaredRepeat({ cacheExpectation: 'expect-miss' }, { run: 1 })).toBe(false);
  });
});

describe('roll-up', () => {
  it('keeps quality failures and instrument gaps in separate counters', () => {
    const s = summariseAttribution([
      attributeRun({ item: escalatingItem, rec: rec({ billed: 1, nyv: { envelopeResolution: 'llm' } }) }),
      attributeRun({ item: escalatingItem, rec: rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver' } }) }),
      attributeRun({ item: escalatingItem, rec: rec({ billed: 0 }) }),
      attributeRun({ item: lookupItem, rec: rec({ billed: 0, nyv: { envelopeResolution: 'deterministic-resolver' } }) }),
      attributeRun({
        item: { ...lookupItem, cacheExpectation: 'expect-hit' },
        rec: rec({ billed: 0, nyv: { envelopeResolution: 'semantic-cache' } }),
      }),
    ]);

    expect(s.billedRuns).toBe(1);
    expect(s.qualityFailureRuns).toBe(1);
    expect(s.instrumentGapRuns).toBe(1);
    expect(s.deterministicWinRuns).toBe(1);
    expect(s.cacheWinRuns).toBe(1);
    expect(s.cacheWinRepeatRuns).toBe(1);
    expect(s.cacheWinFreshRuns).toBe(0);
    expect(s.explicitlyAttributedRuns).toBe(4);
  });
});

describe('contract drift', () => {
  /**
   * The harness cannot import the TS union, so the two lists are asserted equal
   * by text. Without this, adding a resolution on the emitting side would leave
   * the detector silently classifying it as `unattributable`.
   */
  it('keeps the detector resolution list in step with OrchestrationResolution', () => {
    const contract = readFileSync(
      path.join(REPO, 'src/orchestration/jrx-orchestration-response-contract.ts'),
      'utf8',
    );
    const declared = contract.match(/export type OrchestrationResolution\s*=([^;]+);/);
    expect(declared).not.toBeNull();

    const literals = [...declared![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual([...RESOLUTIONS].sort());
  });
});
