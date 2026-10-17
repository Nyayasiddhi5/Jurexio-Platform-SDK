/**
 * PII Vault — distributed (Redis) storage with in-memory fallback
 * Covers task #29 deliverable 1.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We deliberately reset modules between tests so the per-module Redis client
// state can be re-initialized with different mocks (healthy vs. degraded).
async function loadModule() {
  vi.resetModules();
  return await import('../../../src/startup/jrx-pii-vault-cleanup.js');
}

describe('PII Vault — Redis backed with in-memory fallback', () => {
  const originalRedisUrl = process.env.NYV_REDIS_TCP_URL;
  const originalAltUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.NYV_REDIS_TCP_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (originalRedisUrl !== undefined) process.env.NYV_REDIS_TCP_URL = originalRedisUrl;
    if (originalAltUrl !== undefined) process.env.REDIS_URL = originalAltUrl;
  });

  it('falls back to in-memory storage and logs a degraded warning when Redis URL is missing', async () => {
    const mod = await loadModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await mod.addPiiVaultEntry('tok-mem-1', 'AAAAA1234A', 'IN', 60_000);
    const entry = await mod.getPiiVaultEntry('tok-mem-1');

    expect(entry).not.toBeNull();
    expect(entry!.originalValue).toBe('AAAAA1234A');
    expect(mod.isRedisBackend()).toBe(false);
    expect(mod.getPiiVaultStats().backend).toBe('memory');

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('uses Redis when NYV_REDIS_TCP_URL is set, with PX TTL', async () => {
    process.env.NYV_REDIS_TCP_URL = 'rediss://example.upstash.io:6380';

    const store = new Map<string, { value: string; pxExpiry?: number }>();
    const setMock = vi.fn(async (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, pxExpiry: Date.now() + ttl });
      return 'OK';
    });
    const getMock = vi.fn(async (key: string) => {
      const e = store.get(key);
      if (!e) return null;
      if (e.pxExpiry && e.pxExpiry < Date.now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    });
    const delMock = vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n++;
      }
      return n;
    });
    const scanMock = vi.fn(async (_cursor: string) => {
      return ['0', Array.from(store.keys())] as [string, string[]];
    });
    const pingMock = vi.fn(async () => 'PONG');

    vi.doMock('ioredis', () => ({
      Redis: vi.fn().mockImplementation(() => ({
        set: setMock,
        get: getMock,
        del: delMock,
        scan: scanMock,
        ping: pingMock,
      })),
    }));

    const mod = await loadModule();
    await mod.addPiiVaultEntry('tok-redis-1', 'value-x', 'IN', 30_000);

    expect(pingMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      'nyv:pii:tok-redis-1',
      expect.any(String),
      'PX',
      30_000,
    );
    expect(mod.isRedisBackend()).toBe(true);

    const fetched = await mod.getPiiVaultEntry('tok-redis-1');
    expect(fetched?.originalValue).toBe('value-x');
  });

  it('expires entries past their TTL via runPiiVaultCleanup', async () => {
    const mod = await loadModule();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await mod.addPiiVaultEntry('tok-exp', 'soon-gone', 'IN', 1);
    await new Promise((r) => setTimeout(r, 20));
    await mod.runPiiVaultCleanup();
    const fetched = await mod.getPiiVaultEntry('tok-exp');
    expect(fetched).toBeNull();
  });

  it('clearPiiVault removes all in-memory entries', async () => {
    const mod = await loadModule();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mod.addPiiVaultEntry('tok-a', 'v1', 'IN', 60_000);
    await mod.addPiiVaultEntry('tok-b', 'v2', 'IN', 60_000);
    await mod.clearPiiVault();
    expect(await mod.getPiiVaultEntry('tok-a')).toBeNull();
    expect(await mod.getPiiVaultEntry('tok-b')).toBeNull();
  });

  // Task #29 done-criteria: default TTL = 5 minutes (not 30).
  it('source declares the 5-minute default TTL required by Task #29', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/startup/jrx-pii-vault-cleanup.ts'),
      'utf8',
    );
    expect(src).toMatch(/DEFAULT_EXPIRY_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
    expect(src).not.toMatch(/DEFAULT_EXPIRY_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  });
});
