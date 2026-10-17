/**
 * LM cache correctness invariants. These are the assertions that must hold for
 * a legal-AI cache to be safe to enable at all; a hit-rate regression is a cost
 * problem, but a failure in this file is a wrong-answer problem.
 *
 * Covers:
 *   1. tenant / jurisdiction isolation (no cross-tenant serve, exact or fuzzy)
 *   2. cached answers never outliving their grounding (corpus version + max age)
 *   3. never caching an error, empty, abstain or placeholder completion
 *
 * The `redis-tcp-url.js` mock is a workaround for a pre-existing stray build
 * artifact that breaks vitest module resolution — see the header of
 * `lm-cache-key-poisoning.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

import { LMCacheService } from '../../../src/services/lm-cache-service.js';
import {
  classifyCompletionForCache,
  isFuzzyMatchSafeNamespace,
  parseNamespaceTenant,
  escapeNamespace,
  buildCacheKeyParts,
} from '../../../src/services/jrx-lm-cache-key.js';

const Q = 'What is the limitation period for a suit on a promissory note?';
const A = 'Three years from the date the note becomes payable (Limitation Act, Art. 35).';

function newCache(config = {}) {
  return new LMCacheService({ enableSemanticMatching: false, ...config }, null);
}

describe('tenant and jurisdiction isolation', () => {
  it('does not serve tenant A\'s answer to tenant B for the identical question', async () => {
    const cache = newCache();
    const nsA = './jrx-agent:tenant:acme:juris:IN:agent:civil';
    const nsB = './jrx-agent:tenant:globex:juris:IN:agent:civil';

    await cache.set(Q, A, { namespace: nsA });

    expect((await cache.get(Q, nsA)).hit).toBe(true);
    expect((await cache.get(Q, nsB)).hit).toBe(false);
  });

  it('does not serve across jurisdictions for the identical question', async () => {
    const cache = newCache();
    const inIN = './jrx-agent:tenant:acme:juris:IN:agent:civil';
    const inUK = './jrx-agent:tenant:acme:juris:UK:agent:civil';

    await cache.set(Q, A, { namespace: inIN });
    expect((await cache.get(Q, inUK)).hit).toBe(false);
  });

  it('does not let an un-namespaced read reach a tenant-scoped entry', async () => {
    const cache = newCache();
    await cache.set(Q, A, { namespace: './jrx-agent:tenant:acme:juris:IN:agent:civil' });
    // The legacy un-namespaced slot must be a distinct key space.
    expect((await cache.get(Q)).hit).toBe(false);
  });

  it('cannot be tricked into forging another scope\'s key via a `::` in the namespace', () => {
    // Without escaping, `a::c=v1::q` could be produced by BOTH
    // namespace `a` + turn `c=v1::q` and by a namespace containing `::`.
    const forged = buildCacheKeyParts({
      prompt: Q,
      namespace: './jrx-agent:tenant:evil::jrx-agent:tenant:acme:juris:IN:agent:civil',
      corpusVersion: 'v1',
    }).lookupKey;
    const real = buildCacheKeyParts({
      prompt: Q,
      namespace: './jrx-agent:tenant:acme:juris:IN:agent:civil',
      corpusVersion: 'v1',
    }).lookupKey;
    expect(forged).not.toBe(real);
    expect(forged).not.toContain('evil::jrx-agent');
    expect(escapeNamespace('a::b')).toBe('a%3A%3Ab');
  });

  it('parses the tenant only out of namespace shapes the platform actually emits', () => {
    expect(parseNamespaceTenant('./jrx-agent:tenant:acme:juris:IN:agent:civil')).toBe('acme');
    expect(parseNamespaceTenant('specialist:acme:IN:criminal-bot')).toBe('acme');
    expect(parseNamespaceTenant('app_abc123')).toBe('abc123');
    // No tenant dimension at all (`jrx-patterns-routes.ts:1583`) — unknown, not "safe".
    expect(parseNamespaceTenant('patterns:IN')).toBeNull();
    expect(parseNamespaceTenant(undefined)).toBeNull();
  });

  it('refuses fuzzy matching in any scope that cannot prove the tenant', () => {
    expect(isFuzzyMatchSafeNamespace('./jrx-agent:tenant:acme:juris:IN:agent:civil')).toBe(true);
    expect(isFuzzyMatchSafeNamespace('specialist:acme:IN:bot')).toBe(true);

    // The two real fallback buckets: every untenanted request lands in one of
    // these, so fuzzily matching inside them mixes customers.
    expect(isFuzzyMatchSafeNamespace('./jrx-agent:tenant:global:juris:IN:agent:civil')).toBe(false);
    expect(isFuzzyMatchSafeNamespace('specialist:anon:IN:bot')).toBe(false);
    // No tenant dimension, and no namespace at all.
    expect(isFuzzyMatchSafeNamespace('patterns:IN')).toBe(false);
    expect(isFuzzyMatchSafeNamespace(undefined)).toBe(false);
  });

  it('reports fuzzy-match eligibility through describeKey so ops can audit a scope', () => {
    // `describeKey` reports the *effective* decision, which includes the
    // default-off ops flag; set it so this asserts the namespace dimension.
    process.env.JRX_F_LMCACHE_SEMANTIC_EMBED = 'true';
    try {
      const cache = newCache({ enableSemanticMatching: true });
      expect(cache.describeKey(Q, './jrx-agent:tenant:acme:juris:IN:agent:civil').fuzzyMatchAllowed).toBe(true);
      expect(cache.describeKey(Q, './jrx-agent:tenant:global:juris:IN:agent:civil').fuzzyMatchAllowed).toBe(false);
    } finally {
      delete process.env.JRX_F_LMCACHE_SEMANTIC_EMBED;
    }
  });

  it('namespace invalidation removes only the target tenant', async () => {
    const cache = newCache();
    const nsA = './jrx-agent:tenant:acme:juris:IN:agent:civil';
    const nsB = './jrx-agent:tenant:globex:juris:IN:agent:civil';
    await cache.set(Q, A, { namespace: nsA });
    await cache.set(Q, A, { namespace: nsB });

    await cache.invalidateNamespace(nsA);

    expect((await cache.get(Q, nsA)).hit).toBe(false);
    expect((await cache.get(Q, nsB)).hit).toBe(true);
  });

  /**
   * NV-LMCACHE-SDK-NS-ESCAPE-001 — the cache cannot fix this one, and it is the
   * highest-severity issue found. `/cache/lookup`
   * (`jrx-sdk-gateway-routes.ts:2296`) and `/cache/store` (`:2324`) take the
   * namespace from the REQUEST BODY, defaulting to `app_${ctx.applicationId}`
   * only when absent — so an authenticated SDK caller with `documents:read` can
   * name another application's (or agent's) namespace and both read and write
   * it. Isolation there depends on the *route* deriving the namespace from
   * `ctx`, and that file is owned by another workstream.
   *
   * This test documents the invariant the cache does uphold — a namespace is
   * honoured exactly as given — so it is unambiguous that the boundary must be
   * enforced by the caller, and it will start failing if someone "fixes" the
   * symptom inside the cache instead.
   */
  it('honours the namespace exactly as given (so callers must never take it from user input)', async () => {
    const cache = newCache();
    const victim = 'app_victim-application-id';
    await cache.set(Q, 'victim tenant answer', { namespace: victim });

    // Exactly what `/cache/lookup` does with an attacker-supplied body value.
    const asAttacker = await cache.get(Q, victim);
    expect(asAttacker.hit).toBe(true);
    expect(asAttacker.entry?.value).toBe('victim tenant answer');

    // The cache's own default-deny still applies to fuzzy matching, which is
    // the one thing it can refuse without knowing the route's intent.
    expect(cache.describeKey(Q, victim).fuzzyMatchAllowed).toBe(false);
  });
});

describe('cached answers must not outlive their grounding', () => {
  const ns = './jrx-agent:tenant:acme:juris:IN:agent:civil';

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JRX_LEGAL_CORPUS_VERSION;
  });

  it('a corpus-version bump orphans every pre-amendment entry', async () => {
    process.env.JRX_LEGAL_CORPUS_VERSION = '2026-08-01';
    const before = newCache();
    await before.set(Q, A, { namespace: ns });
    expect((await before.get(Q, ns)).hit).toBe(true);

    // A statute amendment ships; the corpus version is bumped and pods restart.
    process.env.JRX_LEGAL_CORPUS_VERSION = '2026-08-15';
    const after = newCache();
    expect((await after.get(Q, ns)).hit).toBe(false);
    expect(after.getStats().corpusVersion).toBe('2026-08-15');
  });

  it('an entry kept hot by repeated hits still expires at the absolute age ceiling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T00:00:00Z'));
    // Idle TTL 60s, absolute ceiling 300s. The entry is touched every 30s, so
    // the idle timer is refreshed forever and only the ceiling can retire it.
    const cache = newCache({ hotTTLMs: 60_000, maxAgeMs: 300_000 });
    await cache.set(Q, A, { namespace: ns });

    // 30s → 270s: legitimately served, and each hit resets the idle timer.
    for (let elapsed = 30_000; elapsed <= 270_000; elapsed += 30_000) {
      vi.advanceTimersByTime(30_000);
      expect((await cache.get(Q, ns)).hit).toBe(true);
    }

    // 300s: past the ceiling. The idle timer would still say "fresh" (last hit
    // was 30s ago vs a 60s TTL), so only the max-age check can catch this.
    vi.advanceTimersByTime(30_001);
    expect((await cache.get(Q, ns)).hit).toBe(false);
    // Dropped, not merely refused: a second read must not resurrect it either.
    expect((await cache.get(Q, ns)).hit).toBe(false);
    expect(cache.getStats().staleEvictions).toBeGreaterThan(0);
  });

  it('a shared-backend entry older than the local ceiling is not served', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T00:00:00Z'));
    const staleCreatedAt = Date.now() - 10 * 60_000;
    const del = vi.fn(async () => true);
    const backend = {
      get: vi.fn(async () => ({
        key: 'remote-1',
        normalizedKey: 'irrelevant',
        value: A,
        metadata: { namespace: ns },
        createdAt: staleCreatedAt,
        lastAccessedAt: Date.now(),
        accessCount: 4,
      })),
      set: vi.fn(async () => {}),
      del,
      delByNamespace: vi.fn(async () => 0),
      delByPattern: vi.fn(async () => 0),
      ping: vi.fn(async () => true),
      close: vi.fn(async () => {}),
    };
    // Another pod wrote it with a longer lifetime; this pod's ceiling is 5min.
    const cache = new LMCacheService({ enableSemanticMatching: false, maxAgeMs: 300_000 }, backend as never);

    const result = await cache.get(Q, ns);
    expect(result.hit).toBe(false);
    // And the stale shared copy is purged so no pod keeps re-seeding it.
    expect(del).toHaveBeenCalled();
  });

  it('bounds the shared-backend TTL by the local max age', async () => {
    const set = vi.fn(async () => {});
    const backend = {
      get: vi.fn(async () => null),
      set,
      del: vi.fn(async () => true),
      delByNamespace: vi.fn(async () => 0),
      delByPattern: vi.fn(async () => 0),
      ping: vi.fn(async () => true),
      close: vi.fn(async () => {}),
    };
    const cache = new LMCacheService(
      { enableSemanticMatching: false, coldTTLMs: 86_400_000, maxAgeMs: 3_600_000 },
      backend as never,
    );
    await cache.set(Q, A, { namespace: ns });

    expect(set).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 3_600_000);
  });
});

describe('never cache a non-answer', () => {
  const ns = './jrx-agent:tenant:acme:juris:IN:agent:civil';
  let cache: LMCacheService;
  beforeEach(() => {
    cache = newCache();
  });

  const nonAnswers: Array<[string, string, string]> = [
    ['empty string', '', 'empty'],
    ['whitespace only', '   \n\t ', 'empty'],
    [
      'Gate-8 block',
      '[Response blocked by Jurexio Gate 8: prohibited content]',
      'blocked-or-filtered',
    ],
    [
      'compliance filter',
      '[Response filtered by Jurexio compliance engine]',
      'blocked-or-filtered',
    ],
    [
      'grounded abstain',
      '## Insufficient grounding for a reliable legal answer\n\nNo authority retrieved.',
      'abstain-or-degraded',
    ],
    [
      'structured error envelope',
      JSON.stringify({ error: 'compliance_filtered', reason: 'gate8' }),
      'error-envelope',
    ],
    ['suite placeholder', '[Draft response from claude-sonnet for: contract]', 'placeholder'],
  ];

  for (const [label, value, reason] of nonAnswers) {
    it(`refuses to store: ${label}`, async () => {
      expect(classifyCompletionForCache(value)).toEqual({ cacheable: false, reason });

      await cache.set(Q, value, { namespace: ns });
      // Nothing stored → the next identical request goes to the live model.
      expect((await cache.get(Q, ns)).hit).toBe(false);

      const stats = cache.getStats();
      expect(stats.rejectedWrites).toBe(1);
      expect(stats.rejectedWritesByReason[reason]).toBe(1);
    });
  }

  it('a refused write does not shadow a later real answer for the same question', async () => {
    await cache.set(Q, '[Response blocked by Jurexio Gate 8: retry]', { namespace: ns });
    expect((await cache.get(Q, ns)).hit).toBe(false);

    await cache.set(Q, A, { namespace: ns });
    const good = await cache.get(Q, ns);
    expect(good.hit).toBe(true);
    expect(good.entry?.value).toBe(A);
  });

  it('still stores a legitimate answer that merely discusses blocked content', async () => {
    const legit = 'A response may be blocked by a compliance engine when it names a minor victim.';
    expect(classifyCompletionForCache(legit).cacheable).toBe(true);
    await cache.set(Q, legit, { namespace: ns });
    expect((await cache.get(Q, ns)).hit).toBe(true);
  });
});
