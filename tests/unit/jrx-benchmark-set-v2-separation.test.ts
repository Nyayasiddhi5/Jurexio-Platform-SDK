/**
 * NV-BENCH-COST-001 (set composition) — the v2 set's separation contract.
 *
 * v1 asserted its prompts were distinct and never checked. Its 7 cost-bearing
 * prompts were in fact all the same topic (anticipatory bail / BNSS 482), so the
 * semantic cache served one prompt's answer for another and the resulting
 * zero-completion rows were read as savings.
 *
 * These are OFFLINE SCREENS, not a proof: the live gate is cosine similarity of
 * provider embeddings, which cannot be computed here. v1 is therefore run through
 * the same checks as a control, and MUST fail them — otherwise a screen that
 * everything passes would be mistaken for evidence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeForCacheKey } from '../../src/services/jrx-lm-cache-key.js';

const EVAL_DIR = path.resolve(__dirname, '../../docs/audit/eval');
const readSet = (f: string) => JSON.parse(readFileSync(path.join(EVAL_DIR, f), 'utf8'));

const v2 = readSet('./jrx-cost-benchmark-set.v2.json');
const v1 = readSet('./jrx-cost-benchmark-set.v1.json');

interface Item {
  id: number;
  classId: string;
  prompt: string;
  weight: number;
  costBearing?: boolean;
  topicAnchors?: string[];
  cacheExpectation?: string;
  expectedResolution?: string[];
  mustEscalate?: boolean;
  zeroLlmExpected?: boolean;
}

const items: Item[] = v2.prompts;
const costBearing = items.filter((p) => p.costBearing === true);

/** Token-set cosine on the production normaliser's output. */
function lexicalCosine(a: string, b: string): number {
  const tok = (s: string) => new Set(normalizeForCacheKey(s).split(' ').filter((w) => w.length > 2));
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.sqrt(A.size * B.size);
}

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) out.push([xs[i], xs[j]]);
  return out;
}

describe('v2 set — structural separation', () => {
  it('gives every cost-bearing prompt a topic anchor set', () => {
    expect(costBearing.length).toBeGreaterThan(0);
    for (const p of costBearing) {
      expect(Array.isArray(p.topicAnchors), `item ${p.id}`).toBe(true);
      expect(p.topicAnchors!.length, `item ${p.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('shares no topic anchor between any two cost-bearing prompts', () => {
    const collisions = pairs(costBearing)
      .map(([a, b]) => ({ a: a.id, b: b.id, shared: a.topicAnchors!.filter((t) => b.topicAnchors!.includes(t)) }))
      .filter((x) => x.shared.length > 0);

    expect(collisions).toEqual([]);
  });

  it('keeps the trivial-lookup prompts off the cost-bearing prompts topics too', () => {
    const trivial = items.filter((p) => p.classId === 'statute-faq' || p.classId === 'statute-mapping');
    const collisions: string[] = [];
    for (const t of trivial) {
      for (const c of costBearing) {
        const shared = (t.topicAnchors ?? []).filter((x) => c.topicAnchors!.includes(x));
        if (shared.length > 0) collisions.push(`#${t.id} vs #${c.id}: ${shared.join(',')}`);
      }
    }
    expect(collisions).toEqual([]);
  });
});

describe('v2 set — lexical separation under the production normaliser', () => {
  const ceiling: number = v2.separation.lexicalCosineCeiling;

  it('declares a ceiling', () => {
    expect(typeof ceiling).toBe('number');
    expect(ceiling).toBeGreaterThan(0);
    expect(ceiling).toBeLessThan(1);
  });

  it('holds every cost-bearing pair under the declared ceiling', () => {
    const over = pairs(costBearing)
      .map(([a, b]) => ({ pair: `${a.id}-${b.id}`, cos: lexicalCosine(a.prompt, b.prompt) }))
      .filter((x) => x.cos > ceiling)
      .sort((x, y) => y.cos - x.cos);

    expect(over).toEqual([]);
  });

  it('CONTROL — the v1 cost-bearing prompts fail the same check, proving it discriminates', () => {
    const v1Cost = (v1.prompts as Item[]).filter((p) => p.costBearing === true && p.weight > 0);
    const worst = Math.max(...pairs(v1Cost).map(([a, b]) => lexicalCosine(a.prompt, b.prompt)));

    expect(worst).toBeGreaterThan(ceiling);
  });
});

describe('v2 set — per-run cache signal, so a zero-cost answer can be attributed', () => {
  it('declares cacheExpectation and expectedResolution on every prompt', () => {
    for (const p of items) {
      expect(['expect-hit', 'expect-miss'], `item ${p.id}`).toContain(p.cacheExpectation);
      expect(Array.isArray(p.expectedResolution), `item ${p.id}`).toBe(true);
      expect(p.expectedResolution!.length, `item ${p.id}`).toBeGreaterThan(0);
    }
  });

  it('uses only resolutions the emitting contract can actually produce', () => {
    const contract = readFileSync(
      path.resolve(__dirname, '../../src/orchestration/jrx-orchestration-response-contract.ts'),
      'utf8',
    );
    const declared = contract.match(/export type OrchestrationResolution\s*=([^;]+);/);
    const known = new Set([...declared![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));

    for (const p of items) {
      for (const r of p.expectedResolution!) expect(known, `item ${p.id} -> ${r}`).toContain(r);
    }
  });

  it('declares every cost-bearing prompt as a cold miss, so the runtime self-test can fire', () => {
    for (const p of costBearing) expect(p.cacheExpectation, `item ${p.id}`).toBe('expect-miss');
    expect(v2.cacheIsolation.runtimeSelfTest).toContain('VOID');
  });

  it('marks every cost-bearing prompt as required to escalate', () => {
    for (const p of costBearing) expect(p.mustEscalate, `item ${p.id}`).toBe(true);
  });
});

describe('v2 set — trivial lookups cannot reach the headline', () => {
  /**
   * The exclusion is structural, not editorial: `_nv-benchmark-cost-report.mjs`
   * blends only classes with weight > 0, so weight 0 keeps these classes measured
   * and printed while barring them from the blend.
   */
  it('gives the trivial classes zero blend weight while keeping their mix share visible', () => {
    for (const id of ['statute-faq', 'statute-mapping']) {
      expect(v2.classes[id].weight, id).toBe(0);
      expect(v2.classes[id].mixShare, id).toBeGreaterThan(0);
      expect(v2.classes[id].reportSeparately, id).toBe(true);
    }
  });

  it('gives every correctness probe zero blend weight', () => {
    for (const id of ['cache-repeat', 'adversarial-scope']) expect(v2.classes[id].weight, id).toBe(0);
  });

  it('renormalises the cost-bearing weights to 1 among themselves', () => {
    const blended = Object.values(v2.classes as Record<string, { weight: number }>)
      .reduce((s, c) => s + c.weight, 0);
    expect(blended).toBeCloseTo(1, 3);
  });

  it('keeps the assumed mix shares summing to 1 across all classes', () => {
    const mix = Object.values(v2.classes as Record<string, { mixShare: number }>)
      .reduce((s, c) => s + c.mixShare, 0);
    expect(mix).toBeCloseTo(1, 6);
  });

  it('derives each cost-bearing blend weight from its own mix share', () => {
    const cbClasses = Object.entries(v2.classes as Record<string, { weight: number; mixShare: number; costBearing?: boolean }>)
      .filter(([, c]) => c.costBearing === true);
    const cbMix = cbClasses.reduce((s, [, c]) => s + c.mixShare, 0);

    for (const [id, c] of cbClasses) expect(c.weight, id).toBeCloseTo(c.mixShare / cbMix, 4);
  });
});

describe('v2 set — variance and provenance are declared, not implied', () => {
  it('carries at least 2 distinct prompts per cost-bearing class, and 3 where weight is material', () => {
    const byClass = new Map<string, number>();
    for (const p of costBearing) byClass.set(p.classId, (byClass.get(p.classId) ?? 0) + 1);

    for (const [classId, n] of byClass) {
      expect(n, classId).toBeGreaterThanOrEqual(2);
      if (classId !== 'long-context') expect(n, classId).toBeGreaterThanOrEqual(3);
    }
  });

  it('states that variance is measured across distinct prompts and not across repeats', () => {
    expect(v2.runProtocol.variance.unitOfVariance).toContain('distinct prompts');
    expect(v2.runProtocol.warmRunsPerPrompt).toBeGreaterThan(0);
    expect(v2.runProtocol.coldRunsPerPrompt).toBe(1);
  });

  it('marks the weights as assumed rather than presenting them as derived', () => {
    expect(v2.weighting.status).toBe('assumed-pending-traffic-data');
    expect(v2.weighting.provenance).toMatch(/^ASSUMED/);
  });

  it('records what the set cannot prove, including the absence of traffic data', () => {
    const cannot = (v2._meta.whatThisSetCannotProve as string[]).join(' ');
    expect(cannot).toContain('ASSUMED');
    expect(cannot).toContain('nv_router_decisions');
    expect(v2._meta.publicationRule).toContain('NOT met today');
  });
});
