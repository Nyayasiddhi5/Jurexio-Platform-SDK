/**
 * Task #67 — prompt cache must survive server restarts and be visible
 * across pods when a shared backend (Redis) is configured.
 *
 * These tests use an in-memory fake LMCacheBackend so the contract is
 * exercised end-to-end without spinning up real Redis. The Redis
 * implementation is just a thin wrapper around the same interface.
 *
 * NV-LMCACHE-TEST-RESOLUTION-001: the `redis-tcp-url.js` mock below is what
 * makes this suite runnable at all. A stray committed build artifact,
 * `src/utils/redis-tcp-url.js`, shadows `redis-tcp-url.ts` under vitest's
 * resolution of the `.js` specifier, and that artifact's own
 * `require('./logger.js')` cannot resolve because no `logger.js` artifact
 * exists. The whole file therefore failed to load — this suite has been
 * silently non-executable, which is why the cache defects it was meant to
 * guard went unnoticed. Mocking the module keeps the fix local to a test file
 * rather than deleting a tracked artifact other workstreams may rely on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

import { LMCacheService } from '../../../src/services/lm-cache-service.js';
import type {
  LMCacheBackend,
  SerializedCacheEntry,
} from '../../../src/services/lm-cache-backend.js';

class FakeBackend implements LMCacheBackend {
  store = new Map<string, { entry: SerializedCacheEntry; expiresAt: number }>();
  setCalls = 0;
  getCalls = 0;
  delCalls = 0;

  async get(key: string): Promise<SerializedCacheEntry | null> {
    this.getCalls++;
    const v = this.store.get(key);
    if (!v) return null;
    if (Date.now() > v.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(JSON.stringify(v.entry));
  }
  async set(key: string, entry: SerializedCacheEntry, ttlMs: number): Promise<void> {
    this.setCalls++;
    this.store.set(key, {
      entry: JSON.parse(JSON.stringify(entry)),
      expiresAt: Date.now() + ttlMs,
    });
  }
  async del(key: string): Promise<void> {
    this.delCalls++;
    this.store.delete(key);
  }
  async delByNamespace(namespace: string): Promise<number> {
    let n = 0;
    const prefix = `${namespace}::`;
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        n++;
      }
    }
    return n;
  }
  async flush(): Promise<number> {
    const n = this.store.size;
    this.store.clear();
    return n;
  }
}

class ThrowingBackend implements LMCacheBackend {
  async get(): Promise<SerializedCacheEntry | null> {
    throw new Error('backend offline');
  }
  async set(): Promise<void> {
    throw new Error('backend offline');
  }
  async del(): Promise<void> {
    throw new Error('backend offline');
  }
  async delByNamespace(): Promise<number> {
    throw new Error('backend offline');
  }
  async flush(): Promise<number> {
    throw new Error('backend offline');
  }
}

describe('LMCacheService — shared backend (Task #67)', () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
  });

  it('writes through to the shared backend on set()', async () => {
    const cache = new LMCacheService({}, backend);
    await cache.set('What is Article 21?', 'Right to life and personal liberty.', {
      namespace: 'tenant:acme:IN:civil-rights-bot',
      model: 'gpt-4o-mini',
    });

    expect(backend.setCalls).toBe(1);
    // Exactly one entry should be written under the namespaced lookup key.
    const keys = [...backend.store.keys()];
    expect(keys.length).toBe(1);
    expect(keys[0].startsWith('tenant:acme:IN:civil-rights-bot::')).toBe(true);
    expect(keys[0]).toContain('article 21');
  });

  it('survives a process restart — a fresh service hydrates from the shared backend', async () => {
    // Pod A writes the answer to the cache.
    const podA = new LMCacheService({}, backend);
    await podA.set(
      'What is habeas corpus?',
      'Writ requiring a person to be brought before a court.',
      { namespace: 'tenant:acme:IN:writ-bot', originalLatencyMs: 1234 },
    );

    // Pod A is replaced by a brand new LMCacheService — every in-process
    // tier starts empty, so the only way to recover the answer is via
    // the shared backend.
    const podARestarted = new LMCacheService({}, backend);
    const result = await podARestarted.get(
      'What is habeas corpus?',
      'tenant:acme:IN:writ-bot',
    );

    expect(result.hit).toBe(true);
    expect(result.entry?.value).toBe(
      'Writ requiring a person to be brought before a court.',
    );
    expect(result.entry?.metadata.namespace).toBe('tenant:acme:IN:writ-bot');
    expect(result.entry?.metadata.originalLatencyMs).toBe(1234);

    // The hydrated entry should be promoted into the local hot tier so
    // subsequent in-process lookups skip the backend round-trip.
    const stats = podARestarted.getStats();
    expect(stats.backendHits).toBe(1);
    expect(stats.hotEntries).toBeGreaterThanOrEqual(1);
    expect(stats.sharedBackendEnabled).toBe(true);
  });

  it('shares hits across pods (write on pod A is visible on pod B)', async () => {
    const podA = new LMCacheService({}, backend);
    const podB = new LMCacheService({}, backend);

    await podA.set(
      'What is Section 302 IPC?',
      'Punishment for murder — death or life imprisonment + fine.',
      { namespace: 'tenant:acme:IN:criminal-bot' },
    );

    // Pod B has never seen this prompt, but the shared backend has —
    // so the lookup must resolve.
    const result = await podB.get(
      'What is Section 302 IPC?',
      'tenant:acme:IN:criminal-bot',
    );

    expect(result.hit).toBe(true);
    expect(result.entry?.value).toContain('death or life imprisonment');
  });

  it('keeps tenant namespaces isolated through the shared backend', async () => {
    const cacheA = new LMCacheService({}, backend);
    const cacheB = new LMCacheService({}, backend);

    await cacheA.set('confidential answer', 'secret-A', {
      namespace: 'tenant:acme:IN:agent-1',
    });

    // Different tenant namespace — must miss even though the prompt
    // text is identical.
    const result = await cacheB.get('confidential answer', 'tenant:beta:IN:agent-1');
    expect(result.hit).toBe(false);
  });

  it('invalidate() removes the entry from the shared backend', async () => {
    const cache = new LMCacheService({}, backend);
    await cache.set('to be invalidated', 'old answer', { namespace: 'ns:1' });
    expect(backend.store.size).toBe(1);

    await cache.invalidate('to be invalidated', 'ns:1');
    expect(backend.store.size).toBe(0);

    // A fresh service trying to look this up must also miss.
    const fresh = new LMCacheService({}, backend);
    const result = await fresh.get('to be invalidated', 'ns:1');
    expect(result.hit).toBe(false);
  });

  it('invalidateNamespace() purges the namespace from the shared backend', async () => {
    const cache = new LMCacheService({}, backend);
    await cache.set('q1', 'a1', { namespace: 'ns:purge-me' });
    await cache.set('q2', 'a2', { namespace: 'ns:purge-me' });
    await cache.set('q3', 'a3', { namespace: 'ns:keep-me' });
    expect(backend.store.size).toBe(3);

    await cache.invalidateNamespace('ns:purge-me');

    const remaining = [...backend.store.keys()];
    expect(remaining.length).toBe(1);
    expect(remaining[0].startsWith('ns:keep-me::')).toBe(true);
  });

  it('falls back gracefully when no backend is configured (legacy behaviour preserved)', async () => {
    const cache = new LMCacheService({}, null);
    expect(cache.hasSharedBackend()).toBe(false);

    await cache.set('legacy prompt', 'legacy answer', { namespace: 'ns:legacy' });
    const same = await cache.get('legacy prompt', 'ns:legacy');
    expect(same.hit).toBe(true);

    // Restarting wipes everything — exactly the in-process-only contract
    // we are preserving for dev runs.
    const restarted = new LMCacheService({}, null);
    const after = await restarted.get('legacy prompt', 'ns:legacy');
    expect(after.hit).toBe(false);
  });

  it('degrades to a normal miss when the backend throws on get()', async () => {
    const cache = new LMCacheService({}, new ThrowingBackend());
    const result = await cache.get('anything', 'ns:x');
    expect(result.hit).toBe(false);
    expect(result.tier).toBe('miss');
  });

  it('still returns the in-process entry when the backend throws on set()', async () => {
    const cache = new LMCacheService({}, new ThrowingBackend());
    const entry = await cache.set('local-only', 'still works', {
      namespace: 'ns:y',
    });
    expect(entry.value).toBe('still works');

    const result = await cache.get('local-only', 'ns:y');
    expect(result.hit).toBe(true);
    expect(result.entry?.value).toBe('still works');
  });

  it('pingBackend() distinguishes "not configured", "reachable", and "unreachable"', async () => {
    // No backend wired → null (in-process-only mode).
    const noBackend = new LMCacheService({}, null);
    await expect(noBackend.pingBackend()).resolves.toBeNull();

    // Backend configured + reachable → true. (FakeBackend has no ping(),
    // so the service short-circuits to true — matches "configured and
    // there's no evidence it is down".)
    const reachable = new LMCacheService({}, backend);
    await expect(reachable.pingBackend()).resolves.toBe(true);

    // Backend configured + ping returns false / throws → false.
    class DownBackend extends FakeBackend {
      async ping(): Promise<boolean> {
        return false;
      }
    }
    const down = new LMCacheService({}, new DownBackend());
    await expect(down.pingBackend()).resolves.toBe(false);
  });
});
