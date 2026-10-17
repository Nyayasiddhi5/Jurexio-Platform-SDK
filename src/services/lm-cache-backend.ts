/**
 * Shared (cross-pod, cross-restart) backend for LMCacheService.
 *
 * Task #67: The in-process tiers in LMCacheService are wiped on every
 * server restart, deploy, or pod recycle, and each pod has its own private
 * cache. Backing the cache with a shared store (Redis) persists hits across
 * restarts and across pods so the cost + latency win compounds.
 *
 * Design notes:
 *   - This file defines a thin {@link LMCacheBackend} interface so the cache
 *     service can talk to any shared store. The Redis implementation here
 *     uses the same `redis` package + URL conventions already used elsewhere
 *     in the platform (see `src/services/redis.ts` and
 *     `src/services/jrx-redis-cache-service.ts`).
 *   - The backend is OPT-IN. By default LMCacheService runs in-process only,
 *     so dev runs are unaffected (matches the "Done looks like" contract on
 *     Task #67). Set `LMCACHE_SHARED_BACKEND=redis` to turn it on; the URL
 *     is read from `LMCACHE_REDIS_URL`, then `REDIS_URL`, then
 *     `JRX_REDIS_TCP_URL`.
 *   - Connection is lazy: we never connect at module-load time so importing
 *     this file is always safe (mirrors the lazy pattern in
 *     `src/services/redis.ts`).
 *   - All backend operations are best-effort. Failures must NOT break a real
 *     cache lookup or write — callers in LMCacheService log + fall through
 *     to the in-process tiers, exactly the same way they already handle
 *     in-process faults today.
 */

import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';

const logger = createLogger('lm-cache-backend');

/**
 * Subset of a {@link CacheEntry} that is safe to persist to a shared store.
 * Tier metadata (hot/warm/cold) is intentionally omitted — when an entry
 * is hydrated back into memory after a restart it always lands in the hot
 * tier first and ages out from there.
 */
export interface SerializedCacheEntry {
  key: string;
  normalizedKey: string;
  value: string;
  metadata: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    namespace?: string;
    tags?: string[];
    originalLatencyMs?: number;
  };
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

export interface LMCacheBackend {
  /** Read an entry by its lookup key. Returns null on miss or fault. */
  get(lookupKey: string): Promise<SerializedCacheEntry | null>;
  /** Write-through an entry under its lookup key with a TTL. */
  set(lookupKey: string, entry: SerializedCacheEntry, ttlMs: number): Promise<void>;
  /** Delete a single entry. Best-effort. */
  del(lookupKey: string): Promise<void>;
  /** Delete every entry whose lookup key starts with the given namespace prefix. Returns # deleted. */
  delByNamespace(namespace: string): Promise<number>;
  /** Delete every entry owned by this cache. Returns # deleted. */
  flush(): Promise<number>;
  /** Optional teardown hook for tests / graceful shutdown. */
  close?(): Promise<void>;
  /**
   * Liveness probe — true means the backend is currently reachable.
   * Distinct from "configured": a backend can be wired in but Redis can
   * be down. Surfaced in CacheStats so health checks distinguish the
   * two. Default implementations may return false on any error.
   */
  ping?(): Promise<boolean>;
}

/**
 * Service-scoped Redis key prefix. Override via `LMCACHE_KEY_PREFIX` env so
 * multi-tenant clusters can isolate cache namespaces (e.g. `nyv:lmcache:`,
 * `jrx-staging:lmcache:`). Trailing `:` enforced so callers never need to
 * worry about the separator.
 */
const KEY_PREFIX = (() => {
  const raw = (process.env.LMCACHE_KEY_PREFIX || 'nv:lmcache:').trim();
  return raw.endsWith(':') ? raw : `${raw}:`;
})();

/**
 * Default TTL applied when a caller does not specify one. Resolved from
 * `LMCACHE_TTL_SECONDS` env (positive integer) and falls back to one hour.
 * Per-call TTLs (passed into `set()`) still take precedence — this is the
 * floor for callers that pass `undefined`.
 */
const DEFAULT_TTL_SECONDS = (() => {
  const raw = Number(process.env.LMCACHE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 3600;
})();

/**
 * Build a stable Redis key for a given lookup key. The lookup key already
 * encodes the namespace (see `LMCacheService.indexKey`) so we just prefix
 * it with our service-scoped namespace.
 */
function backendKey(lookupKey: string): string {
  return `${KEY_PREFIX}${lookupKey}`;
}

/** Resolve a per-call TTL, falling back to the env-configured default. */
export function resolveLMCacheTtl(ttlSec?: number): number {
  if (typeof ttlSec === 'number' && Number.isFinite(ttlSec) && ttlSec > 0) {
    return Math.trunc(ttlSec);
  }
  return DEFAULT_TTL_SECONDS;
}

type RedisLikeClient = {
  isOpen?: boolean;
  connect: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, ttlSec: number, value: string) => Promise<unknown>;
  set: (key: string, value: string) => Promise<unknown>;
  del: (key: string | string[]) => Promise<number>;
  scanIterator: (opts?: { MATCH?: string; COUNT?: number }) => AsyncIterable<string>;
  on: (event: string, handler: (e: unknown) => void) => unknown;
  ping?: () => Promise<string>;
  quit?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
};

export class RedisLMCacheBackend implements LMCacheBackend {
  private client: RedisLikeClient | null = null;
  private connecting: Promise<void> | null = null;
  private constructionFailed = false;

  constructor(private readonly url: string) {}

  private async ensureClient(): Promise<RedisLikeClient | null> {
    if (this.constructionFailed) return null;
    if (this.client?.isOpen) return this.client;

    if (!this.client) {
      try {
        const mod = await import('redis');
        this.client = mod.createClient({ url: this.url }) as unknown as RedisLikeClient;
        this.client.on('error', (e) =>
          logger.warn('[LMCacheBackend] redis client error', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      } catch (e) {
        this.constructionFailed = true;
        logger.warn('[LMCacheBackend] failed to construct redis client; shared cache disabled', {
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    }

    if (!this.client.isOpen) {
      if (!this.connecting) {
        this.connecting = this.client
          .connect()
          .then(() => undefined)
          .catch((e) => {
            this.connecting = null;
            throw e;
          });
      }
      try {
        await this.connecting;
      } catch (e) {
        logger.warn('[LMCacheBackend] redis connect failed; falling back to in-process only', {
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    }
    return this.client;
  }

  async get(lookupKey: string): Promise<SerializedCacheEntry | null> {
    try {
      const client = await this.ensureClient();
      if (!client) return null;
      const raw = await client.get(backendKey(lookupKey));
      if (!raw) return null;
      return JSON.parse(raw) as SerializedCacheEntry;
    } catch (e) {
      logger.warn('[LMCacheBackend] get failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  async set(lookupKey: string, entry: SerializedCacheEntry, ttlMs: number): Promise<void> {
    try {
      const client = await this.ensureClient();
      if (!client) return;
      const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
      await client.setEx(backendKey(lookupKey), ttlSec, JSON.stringify(entry));
    } catch (e) {
      logger.warn('[LMCacheBackend] set failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async del(lookupKey: string): Promise<void> {
    try {
      const client = await this.ensureClient();
      if (!client) return;
      await client.del(backendKey(lookupKey));
    } catch (e) {
      logger.warn('[LMCacheBackend] del failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async delByNamespace(namespace: string): Promise<number> {
    return this.scanAndDelete(`${KEY_PREFIX}${namespace}::*`);
  }

  async flush(): Promise<number> {
    return this.scanAndDelete(`${KEY_PREFIX}*`);
  }

  private async scanAndDelete(matchPattern: string): Promise<number> {
    let deleted = 0;
    try {
      const client = await this.ensureClient();
      if (!client) return 0;

      const batch: string[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        deleted += await client.del(batch);
        batch.length = 0;
      };

      for await (const key of client.scanIterator({ MATCH: matchPattern, COUNT: 200 })) {
        batch.push(key);
        if (batch.length >= 200) await flush();
      }
      await flush();
    } catch (e) {
      logger.warn('[LMCacheBackend] scanAndDelete failed', {
        pattern: matchPattern,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return deleted;
  }

  async ping(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      if (!client || !client.ping) return false;
      const reply = await client.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client.quit) {
        await this.client.quit();
      } else if (this.client.disconnect) {
        await this.client.disconnect();
      }
    } catch {
      /* swallow — close() must never throw */
    }
  }
}

/**
 * Construct a backend from process env, or return null when no shared
 * backend is configured. The singleton consumer in lm-cache-service.ts
 * calls this exactly once at module-load, so we don't memoize here —
 * test code that wants a fresh backend can call it again.
 */
export function createLMCacheBackendFromEnv(): LMCacheBackend | null {
  const flag = (process.env.LMCACHE_SHARED_BACKEND || '').trim().toLowerCase();
  if (flag !== 'redis') return null;

  // NV-SECRETS-001 (2026-05-07): consumer-specific override (LMCACHE_REDIS_URL)
  // wins, otherwise delegate to the canonical Redis resolver.
  const overrideRaw = (process.env.LMCACHE_REDIS_URL || '').trim();
  let url = overrideRaw;
  if (!url) {
    const r = resolveRedisTcpUrl();
    url = r.enabled && r.url ? r.url : '';
  }

  if (!url) {
    logger.warn(
      '[LMCacheBackend] LMCACHE_SHARED_BACKEND=redis but no LMCACHE_REDIS_URL and no canonical JRX_REDIS_TCP_URL — shared cache disabled',
    );
    return null;
  }

  logger.info('[LMCacheBackend] shared cache enabled (redis)');
  return new RedisLMCacheBackend(url);
}
