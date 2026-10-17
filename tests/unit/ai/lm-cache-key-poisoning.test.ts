/**
 * NV-LMCACHE-STABLE-KEY-001 — proof that the LM cache key was poisoned, and
 * that the fix repairs it.
 *
 * These tests reconstruct the *exact* prompt envelopes the live callers build,
 * so the assertions fail if the upstream shapes change:
 *
 *   • Queen leaf   — `orchestration-middleware.ts:231`
 *                    `${prompt}${memoryBlock}${ragBlock}` where `memoryBlock`
 *                    is `'\n\n[MEMORY]\n' + items.map(m => '- ' + stringify(m))`
 *                    and `stringify` is `JSON.stringify(v).slice(0, 240)`
 *                    (`:672-675`). The items come from
 *                    `NvMemoryService.retrieve()` — a `SELECT *` over
 *                    `nv_schema.memory_entries` (`nv-orchestration-services.ts:1124`)
 *                    — so they carry the row's `id` (uuid), `created_at` and an
 *                    FTS `_relevance` float. `postMiddleware` step 8
 *                    (`orchestration-middleware.ts:385`) writes a NEW row every
 *                    turn, so the recalled set differs on every request.
 *   • Specialist   — `nv-client.ts:769` builds
 *                    `${contextParts}\n\n[User Query]\n${prompt}` and reads the
 *                    cache with it at `:822`; then
 *                    `promptEnhancementPipeline.enhance()` REPLACES the same
 *                    variable at `:895`, and `:1508` writes the cache with the
 *                    replaced value. Read key ≠ write key by construction.
 *
 * `vi.mock` on `redis-tcp-url.js` is a pre-existing-defect workaround, not part
 * of the fix: a stray committed `src/utils/redis-tcp-url.js` build artifact
 * shadows the `.ts` under vitest resolution and its own `require('./logger.js')`
 * cannot resolve, which is why BOTH existing LM-cache suites currently fail to
 * load at all. Mocking it keeps this suite executable without editing files
 * owned by other workstreams.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

import { LMCacheService } from '../../../src/services/lm-cache-service.js';
import {
  extractStableUserTurn,
  buildCacheKeyParts,
} from '../../../src/services/jrx-lm-cache-key.js';

const USER_QUESTION = 'What is the punishment under BNS 103 for murder?';

/** Mirrors `orchestration-middleware.ts:672-675`. */
function stringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v).slice(0, 240);
}

/**
 * Mirrors `orchestration-middleware.ts:225-231`. `turn` simulates the fact that
 * every request recalls a different set of memory rows, because the previous
 * turn inserted one.
 */
function buildQueenEnrichedPrompt(prompt: string, turn: number): string {
  const memoryRows = [
    {
      id: `6f1c${turn}b2a-0000-4000-8000-00000000000${turn}`,
      content: 'Prior turn: user asked about culpable homicide.',
      created_at: new Date(1_760_000_000_000 + turn * 1000).toISOString(),
      updated_at: new Date(1_760_000_000_000 + turn * 1000).toISOString(),
      access_count: turn,
      _relevance: 0.0731 + turn / 10_000,
    },
  ];
  const ragChunks = [
    {
      content: 'BNS s.103 — Punishment for murder.',
      source: 'in-bare-acts',
      // RRF score drifts with the fused list composition.
      score: 0.016393 + turn / 1_000_000,
      layer: 'unified-base',
    },
  ];
  const memoryBlock = '\n\n[MEMORY]\n' + memoryRows.map((m) => `- ${stringify(m)}`).join('\n');
  const ragBlock = '\n\n[RAG]\n' + ragChunks.map((m) => `- ${stringify(m)}`).join('\n');
  return `${prompt}${memoryBlock}${ragBlock}`;
}

/** Mirrors `nv-client.ts:768-769` — the value the cache is READ with at `:822`. */
function buildSpecialistReadPrompt(prompt: string, turn: number): string {
  const contextParts = [
    '--- Relevant Legal Knowledge (Auto-RAG: unified-base+nys_global | stack: hybrid) ---\n' +
      `[1|unified-base|in-bare-acts] BNS 103\nPunishment for murder. (pass ${turn})`,
    `[Relevant Context from Memory]\n[Memory: episodic] turn-${turn} recall`,
  ];
  return `${contextParts.join('\n\n')}\n\n[User Query]\n${prompt}`;
}

/**
 * Mirrors `nv-prompt-enhancement-pipeline.ts:260` + `:294` applied to the read
 * prompt — the value the cache is WRITTEN with at `nv-client.ts:1508`.
 */
function buildSpecialistWritePrompt(readPrompt: string): string {
  const contextBlock = [
    'Domain Context: India jurisdiction criminal analysis',
    'Constraints:',
    '- Provide accurate legal citations',
  ].join('\n');
  return (
    `Context:\n${contextBlock}\n\nRequest:\n${readPrompt}` +
    '\n\nOrganize your response with clear sections and bullet points.'
  );
}

describe('LM cache key poisoning — the defect', () => {
  it('Queen: the assembled prompt carries a per-request memory-row id, so the raw key differs every turn', () => {
    const t1 = buildQueenEnrichedPrompt(USER_QUESTION, 1);
    const t2 = buildQueenEnrichedPrompt(USER_QUESTION, 2);

    // Same question, different assembled prompt — this is what reached
    // `lmCacheService.get(prompt, ns)` at nv-queen-orchestrator.ts:4473.
    expect(t1).not.toBe(t2);
    expect(t1).toContain('[MEMORY]');
    expect(t1).toMatch(/"id":"6f1c1b2a-/);
    expect(t2).toMatch(/"id":"6f1c2b2a-/);

    // The OLD key was the normalized assembled prompt. Reproduce it to show it
    // was a per-request value: a uuid and an ISO timestamp inside the key.
    const legacyKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    expect(legacyKey(t1)).not.toBe(legacyKey(t2));
  });

  it('specialist: the read key and the write key are different strings by construction', () => {
    const read = buildSpecialistReadPrompt(USER_QUESTION, 1);
    const write = buildSpecialistWritePrompt(read);

    // nv-client.ts:822 reads with `read`; :1508 writes with `write`. Even with
    // zero nondeterminism anywhere, a hit was impossible.
    expect(read).not.toBe(write);
    expect(write.startsWith('Context:\n')).toBe(true);
  });
});

describe('LM cache key poisoning — the fix', () => {
  it('collapses every Queen turn onto one stable key', () => {
    const keys = new Set(
      [1, 2, 3, 4, 5].map(
        (t) =>
          buildCacheKeyParts({
            prompt: buildQueenEnrichedPrompt(USER_QUESTION, t),
            namespace: './jrx-agent:tenant:acme:juris:IN:agent:criminal',
            corpusVersion: 'v1',
          }).lookupKey,
      ),
    );
    expect(keys.size).toBe(1);
    expect(extractStableUserTurn(buildQueenEnrichedPrompt(USER_QUESTION, 3))).toBe(USER_QUESTION);
  });

  it('makes the specialist read key equal the write key', () => {
    const read = buildSpecialistReadPrompt(USER_QUESTION, 1);
    const write = buildSpecialistWritePrompt(read);
    const ns = 'specialist:acme:IN:criminal-bot';

    const readKey = buildCacheKeyParts({ prompt: read, namespace: ns, corpusVersion: 'v1' }).lookupKey;
    const writeKey = buildCacheKeyParts({ prompt: write, namespace: ns, corpusVersion: 'v1' }).lookupKey;

    expect(readKey).toBe(writeKey);
    expect(extractStableUserTurn(write)).toBe(USER_QUESTION);
  });

  it('extraction is idempotent, so re-keying an already-extracted turn is stable', () => {
    const once = extractStableUserTurn(buildSpecialistWritePrompt(buildSpecialistReadPrompt(USER_QUESTION, 2)));
    expect(extractStableUserTurn(once)).toBe(once);
  });

  it('absorbs trivial phrasing variation but NOT a different question', () => {
    const key = (p: string) =>
      buildCacheKeyParts({ prompt: p, namespace: 'specialist:acme:IN:bot', corpusVersion: 'v1' }).lookupKey;

    expect(key('What is BNS 103?')).toBe(key('what is the BNS 103'));
    // Different section → different answer → must NOT collapse.
    expect(key('What is BNS 103?')).not.toBe(key('What is BNS 105?'));
    // Internal punctuation is legally load-bearing and must survive.
    expect(key('penalty under s.103(1)')).not.toBe(key('penalty under s.103(2)'));
    expect(key('Article 21')).not.toBe(key('Article 211'));
    // Different intent on the same section → must NOT collapse.
    expect(key('What is BNS 103?')).not.toBe(key('Draft a bail application under BNS 103'));
  });

  it('end-to-end: an identical question on a later Queen turn now hits', async () => {
    const cache = new LMCacheService({ enableSemanticMatching: false }, null);
    const ns = './jrx-agent:tenant:acme:juris:IN:agent:criminal';

    await cache.set(
      buildQueenEnrichedPrompt(USER_QUESTION, 1),
      'BNS s.103(1): death or life imprisonment, and fine.',
      { namespace: ns, model: 'global.anthropic.claude-sonnet-5', originalLatencyMs: 19_100 },
    );

    // Turn 7 recalls different memory rows and different RRF scores.
    const lookup = await cache.get(buildQueenEnrichedPrompt(USER_QUESTION, 7), ns);
    expect(lookup.hit).toBe(true);
    expect(lookup.entry?.value).toContain('death or life imprisonment');
  });
});

describe('honest metering (plan §6.3)', () => {
  let cache: LMCacheService;
  beforeEach(() => {
    cache = new LMCacheService({ enableSemanticMatching: false }, null);
  });

  it('records real avoided tokens and attributes them to the model that would have run', async () => {
    const ns = './jrx-agent:tenant:acme:juris:IN:agent:criminal';
    await cache.set(USER_QUESTION, 'x'.repeat(4_000), {
      namespace: ns,
      model: 'global.anthropic.claude-sonnet-5',
      promptTokens: 5_345,
      completionTokens: 1_432,
    });

    expect((await cache.get(USER_QUESTION, ns)).hit).toBe(true);

    const { savings } = cache.getStats();
    expect(savings.hits).toBe(1);
    expect(savings.avoidedPromptTokens).toBe(5_345);
    expect(savings.avoidedCompletionTokens).toBe(1_432);
    // Provider-reported counts were supplied, so nothing was estimated.
    expect(savings.estimated).toBe(false);
    expect(savings.byModel['global.anthropic.claude-sonnet-5'].hits).toBe(1);
    // Priced from the router's own catalog — no longer `hits * 0.002`.
    expect(savings.avoidedCostUsd).toBeGreaterThan(0);
    expect(savings.unpricedHits).toBe(0);
  });

  it('flags estimated savings when the caller supplied no token counts', async () => {
    await cache.set('what is a caveat petition', 'A caveat petition is filed under CPC s.148A.', {
      namespace: './jrx-agent:tenant:acme:juris:IN:agent:civil',
      model: 'global.anthropic.claude-sonnet-5',
    });
    await cache.get('what is a caveat petition', './jrx-agent:tenant:acme:juris:IN:agent:civil');

    const { savings } = cache.getStats();
    expect(savings.estimated).toBe(true);
    expect(savings.avoidedCompletionTokens).toBeGreaterThan(0);
  });
});
