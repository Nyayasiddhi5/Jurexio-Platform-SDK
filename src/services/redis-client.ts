/**
 * Redis Seam — NYV-ORCH-SEAM-007 (Task #32 round 10e).
 *
 * Canonical export: `nvRedisCache` from `nv-redis-cache-service` is the
 * single SSoT cache primitive (semantic LLM cache, distributed
 * rate-limit counters, WebSocket session store, idempotent tool-result
 * cache, with graceful in-memory LRU fallback when Redis is
 * unavailable). All new code MUST use this — there are no parallel
 * cache primitives.
 *
 * Back-compat re-exports: `redisClient` / default / `ensureRedis` are
 * forwarded from `./redis.js`. That module is now lazy (round 10e), so
 * importing this seam is safe even when REDIS_URL is unset or
 * misconfigured — the underlying redis client is constructed on first
 * use, not at module-load time. Property reads on the back-compat
 * client (e.g. `redisClient.isOpen`) return real values from the
 * resolved client; method calls are bound to the real client. New code
 * should still prefer `nvRedisCache` + the typed CacheKeys / CacheTTL
 * helpers in `redis-cache.ts`.
 */

export { nvRedisCache } from './jrx-redis-cache-service.js';

import redis, { ensureRedis as _ensureRedis } from './redis.js';

export const redisClient = redis;
export const ensureRedis = _ensureRedis;
export default redis;
