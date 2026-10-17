/**
 * Semantic (embedding) matching for the LM cache.
 *
 * ── Why the semantic cache never served ───────────────────────────────────────
 *
 * There were two independent blockers, and fixing either alone changes nothing:
 *
 *   1. The default path was not semantic at all. With
 *      `NYV_F_LMCACHE_SEMANTIC_EMBED` off (its default), `get()` called
 *      `findSemanticMatch`, which scored candidates by counting matching
 *      characters of two SHA-256 hex digests. Digests of different inputs are
 *      effectively independent, so the expected score is ~1/16 = 0.0625 against
 *      a 0.85 threshold — mathematically unreachable unless the digests are
 *      identical, in which case the exact-key path had already hit. That branch
 *      could only ever return `null` or a redundant hit. `hashOverlapCanNeverMatch`
 *      below measures it.
 *   2. Even with the flag on, matching was keyed off the ASSEMBLED prompt, whose
 *      per-request memory ids and RRF scores dominate the text
 *      (see `lm-cache-key-poisoning.test.ts`), so near-identical questions
 *      embedded to different points. It also embedded every candidate lazily on
 *      every miss, which cost more than the LLM call it was avoiding.
 *
 * The fix removes the hash path entirely, embeds the recovered *user turn* once
 * at write time into a bounded per-namespace index, and gates serving on a
 * tenant-pinned namespace.
 *
 * The `redis-tcp-url.js` mock works around a pre-existing stray build artifact —
 * see the header of `lm-cache-key-poisoning.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

vi.mock('../../../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

/**
 * Deterministic stand-in for the embedding provider. Real embeddings are not
 * available in a unit test, so this maps words onto synonym groups: paraphrases
 * of one question land on the same axes while different questions land on
 * disjoint ones. That is the only property these tests depend on.
 *
 * Critically, the paraphrases below have *different* normalized cache keys, so a
 * hit here proves the semantic path served it — not the exact path.
 */
const SYNONYM_GROUPS: Record<string, readonly string[]> = {
  punish: ['punishment', 'penalty', 'sentence', 'punishable'],
  kill: ['murder', 'homicide', 'killing'],
  bns103: ['bns', '103', 'section'],
  limitation: ['limitation', 'period'],
  note: ['promissory', 'note', 'suit'],
  bail: ['bail', 'anticipatory'],
  gst: ['gst', 'input', 'credit', 'reversal'],
};
const AXES = Object.keys(SYNONYM_GROUPS);
const WORD_TO_AXIS = new Map<string, string>();
for (const [axis, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const w of words) WORD_TO_AXIS.set(w, axis);
}

const embedCalls: string[] = [];

function fakeEmbed(text: string): number[] {
  embedCalls.push(text);
  const axes = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const axis = WORD_TO_AXIS.get(word);
    if (axis) axes.add(axis);
  }
  return AXES.map((a) => (axes.has(a) ? 1 : 0));
}

vi.mock('../../../src/services/rag/jrx-legal-embedding-service.js', () => ({
  nvLegalEmbeddingService: {
    embed: vi.fn(async (text: string) => ({
      embedding: fakeEmbed(text),
      model: 'test-fake',
      dimensions: AXES.length,
      cached: false,
    })),
  },
}));

import { LMCacheService } from '../../../src/services/lm-cache-service.js';

const NS_A = './jrx-agent:tenant:acme:juris:IN:agent:criminal';
const NS_B = './jrx-agent:tenant:globex:juris:IN:agent:criminal';

const STORED_Q = 'What is the punishment for murder under BNS 103?';
const STORED_A = 'BNS s.103(1): death or imprisonment for life, and fine.';
/** Same question, different words → different normalized key, same meaning. */
const PARAPHRASE_Q = 'What sentence is prescribed for homicide under section 103?';
/** Overlaps but drags in an unrelated axis → grounding band, must not serve. */
const NEAR_MISS_Q = 'penalty for homicide under section 103 and the limitation period';
/** Genuinely different question → must miss outright. */
const OTHER_Q = 'limitation period for a suit on a promissory note';

function semanticCache(config = {}) {
  return new LMCacheService(
    { enableSemanticMatching: true, semanticServeThreshold: 0.9, semanticGroundingFloor: 0.7, ...config },
    null,
  );
}

beforeEach(() => {
  embedCalls.length = 0;
  // Fuzzy serving is opt-in (see `semanticAllowed`); these tests exercise the
  // opted-in path. `stays-off-by-default` below asserts the other side.
  process.env.NYV_F_LMCACHE_SEMANTIC_EMBED = 'true';
});

afterEach(() => {
  delete process.env.NYV_F_LMCACHE_SEMANTIC_EMBED;
});

describe('why the old semantic path could never serve', () => {
  it('hash-overlap similarity is mathematically unreachable at the 0.85 threshold', () => {
    // Reproduce the removed scorer exactly.
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    const score = (a: string, b: string) => {
      let matching = 0;
      for (let i = 0; i < a.length; i++) if (a[i] === b[i]) matching++;
      return matching / a.length;
    };

    const pairs: Array<[string, string]> = [
      ['what is punishment under bns 103', 'what is the punishment under bns 103'],
      ['punishment bns 103', 'punishment for murder bns 103'],
      ['bail anticipatory', 'anticipatory bail'],
    ];

    for (const [a, b] of pairs) {
      const s = score(hash(a), hash(b));
      // Nowhere near 0.85 — these are paraphrases a human would call identical.
      expect(s).toBeLessThan(0.3);
    }

    // The expected value is 1/16 (one hex nibble in sixteen agrees by chance).
    let total = 0;
    const n = 400;
    for (let i = 0; i < n; i++) total += score(hash(`q-${i}`), hash(`q-${i + n}`));
    expect(total / n).toBeLessThan(0.12);
  });
});

describe('semantic matching now serves', () => {
  it('serves a paraphrase whose exact key is different', async () => {
    const cache = semanticCache();
    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });

    // Guard the premise: if these keyed identically the hit would prove nothing.
    expect(cache.describeKey(STORED_Q, NS_A).lookupKey)
      .not.toBe(cache.describeKey(PARAPHRASE_Q, NS_A).lookupKey);

    const r = await cache.get(PARAPHRASE_Q, NS_A);
    expect(r.hit).toBe(true);
    expect(r.semanticMatch).toBe(true);
    expect(r.similarityScore).toBeGreaterThanOrEqual(0.9);
    expect(cache.getStats().semanticHits).toBe(1);
  });

  it('does NOT serve a different legal question', async () => {
    const cache = semanticCache();
    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });

    expect((await cache.get(OTHER_Q, NS_A)).hit).toBe(false);
  });

  it('counts a near-miss in the grounding band without serving it', async () => {
    const cache = semanticCache();
    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });

    const r = await cache.get(NEAR_MISS_Q, NS_A);
    expect(r.hit).toBe(false);
    expect(cache.getStats().semanticNearMisses).toBeGreaterThan(0);
  });

  it('never crosses a tenant boundary on a fuzzy match', async () => {
    const cache = semanticCache();
    await cache.set(STORED_Q, "acme's answer", { namespace: NS_A });

    expect((await cache.get(PARAPHRASE_Q, NS_B)).hit).toBe(false);
  });

  it('refuses to fuzzy-match inside the untenanted fallback bucket', async () => {
    const cache = semanticCache();
    const shared = './jrx-agent:tenant:global:juris:IN:agent:criminal';
    await cache.set(STORED_Q, STORED_A, { namespace: shared });

    // Exact still works — it is key-partitioned and requires the same question…
    expect((await cache.get(STORED_Q, shared)).hit).toBe(true);
    // …but a paraphrase must not be served: every untenanted request shares
    // this bucket, so a fuzzy serve here mixes customers.
    expect((await cache.get(PARAPHRASE_Q, shared)).hit).toBe(false);
  });
});

describe('semantic matching is affordable', () => {
  it('embeds each entry once at write time, not once per candidate per lookup', async () => {
    const cache = semanticCache();
    for (let i = 0; i < 20; i++) {
      await cache.set(`question number ${i} about bns 103 punishment`, `answer ${i}`, { namespace: NS_A });
    }
    const afterWrites = embedCalls.length;
    expect(afterWrites).toBe(20);

    // A lookup embeds the query only — the old lazy path embedded every
    // candidate on every miss (20 more per lookup here).
    await cache.get('unrelated gst input credit reversal query', NS_A);
    expect(embedCalls.length - afterWrites).toBe(1);
  });

  it('bounds the vector index, and an entry that loses its vector is still exact-matchable', async () => {
    const cache = semanticCache({ semanticCandidatesPerNamespace: 5 });
    for (let i = 0; i < 12; i++) {
      await cache.set(`bail question ${i}`, `answer ${i}`, { namespace: NS_A });
    }
    expect(cache.getSemanticIndexSize()).toBeLessThanOrEqual(5);

    // Entry 0's vector was evicted, but the answer itself must still be served
    // to the identical question.
    const r = await cache.get('bail question 0', NS_A);
    expect(r.hit).toBe(true);
    expect(r.semanticMatch).toBe(false);
  });

  it('degrades to exact-only when the embedding provider is unavailable', async () => {
    const mod = await import('../../../src/services/rag/jrx-legal-embedding-service.js');
    const spy = vi
      .spyOn(mod.nvLegalEmbeddingService, 'embed')
      .mockRejectedValue(new Error('EMBEDDING_PROVIDER_UNAVAILABLE'));

    const cache = semanticCache();
    // The write must still succeed — an embedding outage may not drop answers.
    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });
    expect(cache.getSemanticIndexSize()).toBe(0);

    // Exact still hits; the paraphrase simply misses instead of throwing.
    expect((await cache.get(STORED_Q, NS_A)).hit).toBe(true);
    expect((await cache.get(PARAPHRASE_Q, NS_A)).hit).toBe(false);

    spy.mockRestore();
  });

  it('does not spend an embedding call when semantic matching is off', async () => {
    const cache = new LMCacheService({ enableSemanticMatching: false }, null);
    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });
    expect(embedCalls.length).toBe(0);
  });

  it('stays off by default: no embedding call and no fuzzy serve without the flag', async () => {
    delete process.env.NYV_F_LMCACHE_SEMANTIC_EMBED;
    const cache = semanticCache();

    await cache.set(STORED_Q, STORED_A, { namespace: NS_A });
    // The key/isolation/staleness fixes are unconditional; only fuzzy serving
    // is opt-in, so the default deploy pays no embedding cost at all.
    expect(embedCalls.length).toBe(0);
    expect(cache.describeKey(STORED_Q, NS_A).fuzzyMatchAllowed).toBe(false);

    // Exact matching is unaffected.
    expect((await cache.get(STORED_Q, NS_A)).hit).toBe(true);
    expect((await cache.get(PARAPHRASE_Q, NS_A)).hit).toBe(false);
  });
});
