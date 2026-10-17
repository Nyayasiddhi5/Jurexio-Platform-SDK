/**
 * Redis Cache Layer — Architecture P1
 * @version 5.2.0
 *
 * Thin wrapper around the existing Redis client that provides:
 *  - get / set / del with automatic JSON serialisation
 *  - getOrSet (cache-aside pattern)
 *  - Graceful degradation: if Redis is unavailable, functions bypass cache
 *    and call the resolver directly so the app never hard-fails on cache miss.
 *
 * Key namespaces:
 *   agent-registry:<tenantId>   → agent list for a tenant (TTL 60 s)
 *   matter-list:<orgId>         → paginated matter list (TTL 30 s)
 *   org-config:<orgId>          → org settings / rate limits (TTL 300 s)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('redis-cache');

/* ── Dynamic Redis import (reuses the existing client) ──────── */

let _redis: any = null;

/**
 * NYV-NS-018 (post-architect 2026-05-05): tolerate two common operator
 * misconfigurations of REDIS_URL / NYV_REDIS_TCP_URL that we have hit in
 * deployment:
 *   1. value starts with `ediss://` — the leading `r` got eaten somewhere
 *      in the secret pipeline. Auto-recover to `rediss://`.
 *   2. value starts with `https://` — operator pasted the Redis-Cloud REST
 *      console URL instead of the connection string. Reject loudly so the
 *      app never silently treats HTTP as Redis.
 * The original env var is left untouched; we only normalise the in-memory
 * copy used to construct the client.
 */
export function normaliseRedisUrl(raw: string | undefined | null): { url: string | null; warning: string | null } {
  if (!raw) return { url: null, warning: null };
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, warning: null };
  if (trimmed.startsWith('rediss://') || trimmed.startsWith('redis://')) {
    return { url: trimmed, warning: null };
  }
  if (trimmed.startsWith('ediss://')) {
    return { url: 'r' + trimmed, warning: 'redis_url auto-recovered: ediss:// → rediss:// (leading r restored)' };
  }
  if (trimmed.startsWith('edis://')) {
    return { url: 'r' + trimmed, warning: 'redis_url auto-recovered: edis:// → redis:// (leading r restored)' };
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return { url: null, warning: `redis_url rejected: protocol ${trimmed.slice(0, 8)} is not Redis. Expected rediss:// or redis://. The cluster REST console URL is NOT the connection string.` };
  }
  return { url: null, warning: `redis_url rejected: unknown protocol prefix "${trimmed.slice(0, 12)}…". Expected rediss:// or redis://.` };
}

async function getRedis(): Promise<any | null> {
  if (!_redis) {
    try {
      const { default: client } = await import('../services/redis-client.js').catch(() =>
        import('../services/redis.js')
      );
      if (client && typeof client.get === 'function') {
        _redis = client;
      }
    } catch { /* no Redis client available */ }
  }
  if (!_redis) return null;
  /**
   * NV-REDIS-RECONNECT-2026-05-11 (Session-15 v14): pre-flight ensureRedis()
   * so we never try to .get/.set against a `client is closed` socket.
   * Without this, the very first cache call after the socket drops races
   * the auto-reconnect loop and throws synchronously — which is exactly
   * what produced the recurring `cache_get_error … client is closed`
   * warnings we saw in the gateway log every 30 s.
   */
  try {
    if (_redis.isOpen === false) {
      const ensure = await import('../services/redis.js').then((m) => m.ensureRedis).catch(() => null);
      if (ensure) await ensure();
    }
  } catch (err: any) {
    logger.warn('cache_ensure_failed', { err: String(err) });
    return null;
  }
  return _redis;
}

/* ── Core helpers ───────────────────────────────────────────── */

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err: any) {
    logger.warn('cache_get_error', { key, err: String(err) });
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err: any) {
    logger.warn('cache_set_error', { key, err: String(err) });
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err: any) {
    logger.warn('cache_del_error', { key, err: String(err) });
  }
}

/**
 * Cache-aside helper — returns cached value or calls resolver and caches result.
 *
 * @param key         Redis key
 * @param resolver    Async function that fetches fresh data
 * @param ttlSeconds  How long to cache (default 60 s)
 */
export async function getOrSet<T>(
  key: string,
  resolver: () => Promise<T>,
  ttlSeconds = 60
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    logger.debug('cache_hit', { key });
    return cached;
  }

  const fresh = await resolver();
  /* Fire-and-forget cache write so we don't slow down the response */
  cacheSet(key, fresh, ttlSeconds).catch(() => {});
  logger.debug('cache_miss', { key });
  return fresh;
}

/* ── Named cache helpers for common entities ────────────────── */

export const CacheKeys = {
  agentRegistry: (tenantId: string) => `agent-registry:${tenantId}`,
  matterList:    (orgId: string, page = 1) => `matter-list:${orgId}:${page}`,
  orgConfig:     (orgId: string) => `org-config:${orgId}`,
  caseList:      (orgId: string, page = 1) => `case-list:${orgId}:${page}`,
};

export const CacheTTL = {
  agentRegistry: 60,
  matterList:    30,
  orgConfig:     300,
  caseList:      30,
};
