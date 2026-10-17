/**
 * NV-RAG-CHAR-BUDGET-001 — retrieval size, not just retrieval count.
 *
 * `ragTopK` bounded how MANY chunks were retrieved. Nothing bounded how LARGE
 * each one was, so `formatAutoRagContext` interpolated `chunk.content` raw.
 * Measured worst case on the partner floor (`JRX_PARTNER_RAG_TOP_K` = 16, which
 * is what NSP and NYM run) with judgment-length excerpts (~4,500 chars) is
 * ~18,000 tokens of retrieval alone — 7.2x the `chat` prompt budget and 2.3x
 * `research`. Memory was already capped by `memoryCharCap`; retrieval was the
 * asymmetry.
 *
 * Quality matters as much as size here: a hard mid-sentence slice makes the
 * model complete the dangling clause and invent the remainder, which on a
 * statutory provision is a correctness failure, not a cosmetic one.
 */
import { describe, it, expect } from 'vitest';
import { formatAutoRagContext } from '../../src/services/jrx-auto-rag-router.js';
import { resolveContextBudgets } from '../../src/orchestration/jrx-context-budgets.js';

type Chunk = { layer: string; source: string; title: string; content: string };

const mkResult = (chunks: Chunk[]) =>
  ({ chunks, layersUsed: ['unified-base'], contextBlock: '' }) as any;

const chunk = (i: number, chars: number, text = 'x'): Chunk => ({
  layer: 'statute',
  source: 'NYS',
  title: `Authority ${i}`,
  content: text.repeat(chars),
});

describe('NV-RAG-CHAR-BUDGET-001: per-chunk ceiling', () => {
  it('truncates an over-long excerpt to the per-chunk cap', () => {
    const out = formatAutoRagContext(mkResult([chunk(1, 5_000)]), {
      ragChunkCharCap: 1_000,
      ragTotalCharCap: 10_000,
    });
    expect(out.length).toBeLessThan(2_000);
    expect(out).toContain('[…]');
    expect(out).toContain('excerpt(s) shortened');
  });

  it('leaves an excerpt already inside the cap untouched', () => {
    const body = 'The provision states the following. '.repeat(5);
    const out = formatAutoRagContext(
      mkResult([{ layer: 'statute', source: 'NYS', title: 'A1', content: body }]),
      { ragChunkCharCap: 4_000, ragTotalCharCap: 10_000 },
    );
    expect(out).toContain(body.trim().slice(0, 60));
    expect(out).not.toContain('[…]');
    expect(out).not.toContain('shortened');
  });

  it('cuts on a sentence boundary rather than mid-clause', () => {
    // Two sentences; the cap lands inside the second.
    const content = `${'A'.repeat(600)}. ${'B'.repeat(600)}.`;
    const out = formatAutoRagContext(mkResult([{ layer: 'statute', source: 'NYS', title: 'A1', content }]), {
      ragChunkCharCap: 900,
      ragTotalCharCap: 10_000,
    });
    // Must end at the first sentence terminator, so no partial B-clause leaks.
    expect(out).toContain(`${'A'.repeat(600)}.`);
    expect(out).not.toContain('B'.repeat(300));
  });

  it('does not collapse an excerpt when one sentence spans the whole budget', () => {
    // No sentence break inside the window: a naive implementation would emit
    // almost nothing. It must fall back to a word boundary instead.
    const content = `${'word '.repeat(400)}end.`;
    const out = formatAutoRagContext(mkResult([{ layer: 'statute', source: 'NYS', title: 'A1', content }]), {
      ragChunkCharCap: 1_000,
      ragTotalCharCap: 10_000,
    });
    expect(out.length).toBeGreaterThan(600);
  });
});

describe('NV-RAG-CHAR-BUDGET-001: total ceiling', () => {
  it('drops the lowest-ranked sources once the total budget is spent', () => {
    const chunks = Array.from({ length: 16 }, (_, i) => chunk(i + 1, 2_000));
    const out = formatAutoRagContext(mkResult(chunks), {
      ragChunkCharCap: 1_500,
      ragTotalCharCap: 6_000,
    });
    expect(out.length).toBeLessThan(9_000);
    expect(out).toContain('omitted for budget');
    // Highest-ranked survives; the tail does not.
    expect(out).toContain('Authority 1');
    expect(out).not.toContain('Authority 16');
  });

  it('states the elision in-band so the model cannot claim full coverage', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(i + 1, 3_000));
    const out = formatAutoRagContext(mkResult(chunks), {
      ragChunkCharCap: 1_000,
      ragTotalCharCap: 4_000,
    });
    expect(out).toMatch(/shortened|omitted for budget/);
  });

  it('keeps the previous unbounded behaviour when no budget is supplied', () => {
    // Callers that were never measured must not start silently truncating.
    const chunks = [chunk(1, 5_000), chunk(2, 5_000)];
    const out = formatAutoRagContext(mkResult(chunks));
    expect(out.length).toBeGreaterThan(10_000);
    expect(out).not.toContain('[…]');
  });

  it('emits nothing when there are no chunks', () => {
    expect(formatAutoRagContext(mkResult([]), { ragChunkCharCap: 100, ragTotalCharCap: 100 })).toBe('');
  });
});

describe('NV-RAG-CHAR-BUDGET-001: budgets are declared per tier and bounded', () => {
  it('every complexity tier declares both ceilings', () => {
    for (const c of ['simple', 'moderate', 'complex', 'very_complex']) {
      const b = resolveContextBudgets(c);
      expect(b.ragChunkCharCap, c).toBeGreaterThan(0);
      expect(b.ragTotalCharCap, c).toBeGreaterThan(0);
    }
  });

  it('the total ceiling is consistent with topK x per-chunk cap', () => {
    for (const c of ['simple', 'moderate', 'complex', 'very_complex']) {
      const b = resolveContextBudgets(c);
      expect(b.ragTotalCharCap, c).toBeLessThanOrEqual(b.ragTopK * b.ragChunkCharCap);
    }
  });

  it('ceilings rise monotonically with complexity', () => {
    const simple = resolveContextBudgets('simple');
    const complex = resolveContextBudgets('complex');
    expect(complex.ragTotalCharCap).toBeGreaterThan(simple.ragTotalCharCap);
  });

  it('the partner floor raises breadth (total) without raising per-excerpt length', () => {
    // NSP/NYM run the partner floor. More distinct authorities beat longer
    // excerpts of the same one, and the per-chunk cap is what bounds a single
    // runaway judgment — so the partner override must not lift it.
    const base = resolveContextBudgets('moderate');
    const partner = resolveContextBudgets('moderate', { partnerBestOutcome: true });
    expect(partner.ragTopK).toBeGreaterThanOrEqual(16);
    expect(partner.ragTotalCharCap).toBeGreaterThan(base.ragTotalCharCap);
    expect(partner.ragChunkCharCap).toBe(base.ragChunkCharCap);
  });

  it('caps the measured worst case well below the research prompt budget', () => {
    // The defect: 16 x 4,500 chars = ~18,000 tokens. Assert the partner path can
    // no longer exceed a research-sized budget on retrieval alone.
    const partner = resolveContextBudgets('moderate', { partnerBestOutcome: true });
    const worstChunks = Array.from({ length: partner.ragTopK }, (_, i) => chunk(i + 1, 4_500));
    const out = formatAutoRagContext(mkResult(worstChunks), {
      ragChunkCharCap: partner.ragChunkCharCap,
      ragTotalCharCap: partner.ragTotalCharCap,
    });
    const approxTokens = Math.ceil(out.length / 4);
    expect(approxTokens).toBeLessThan(8_000);
  });
});
