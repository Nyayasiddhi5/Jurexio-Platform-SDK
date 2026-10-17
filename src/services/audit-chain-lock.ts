/**
 * Distributed Redis lock for the audit hash chain critical section.
 *
 * Pods serialize their `appendAuditRecord` calls through a single Redis key
 * (`SET nv:audit:chain:lock <token> NX PX 250`). The first writer wins; other
 * pods spin briefly waiting for the lock to free, then proceed. This lets
 * pods coordinate BEFORE they read the chain head, which eliminates most of
 * the wasted INSERT-then-AuditChainBrokenError-then-retry round trips that
 * would otherwise happen under cross-pod contention.
 *
 * Correctness backstops remain in place: the per-process `withChainLock`
 * mutex still serializes intra-pod writers, the in-flight verification
 * against the live DB head still runs, and the unique index on
 * `nv_audit_logs.previous_hash` is still the database-level last word. The
 * Redis lock is purely an optimization that turns probabilistic
 * unique-violation losses into deterministic queueing.
 *
 * Graceful degradation: when Redis is unavailable, mis-configured, or
 * times out, `acquireAuditChainLock()` returns `{ acquired: false,
 * release: noop }` and the caller falls back to the existing single-pod
 * behavior (in-process mutex + DB unique-index backstop). The audit chain
 * stays correct; we only lose the cross-pod coordination benefit.
 *
 * TTL is 250ms so an orphaned lock (pod crash mid-write) cannot stall the
 * chain for more than a quarter-second.
 *
 * @module audit-chain-lock
 */
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';

const logger = createLogger('audit-chain-lock');

const LOCK_KEY = 'nv:audit:chain:lock';
const LOCK_TTL_MS = 250;
const ACQUIRE_TIMEOUT_MS = 1500;
const ACQUIRE_RETRY_INTERVAL_MS = 5;

interface RedisLikeClient {
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
}

let _redisClient: RedisLikeClient | null = null;
let _redisInitPromise: Promise<RedisLikeClient | null> | null = null;
let _redisDisabled = false;

async function initRedisClient(): Promise<RedisLikeClient | null> {
  if (_redisClient) return _redisClient;
  if (_redisDisabled) return null;
  if (_redisInitPromise) return _redisInitPromise;

  _redisInitPromise = (async () => {
    // NV-SECRETS-001 (2026-05-07): single resolver source of truth.
    const r = resolveRedisTcpUrl();
    if (!r.enabled || !r.url) {
      logger.info(`[AuditChainLock] ${r.reason ?? 'No Redis'} — degrading to in-process mutex only`);
      _redisDisabled = true;
      return null;
    }
    const tcpUrl = r.url;
    try {
      const { Redis } = await import('ioredis');
      const isAuthErr = (err: Error) => /WRONGPASS|NOAUTH/i.test(err?.message || '');
      const client = new (Redis as unknown as new (
        url: string,
        opts: Record<string, unknown>,
      ) => RedisLikeClient & {
        on: (event: string, cb: (e: Error) => void) => void;
        ping: () => Promise<string>;
        disconnect: () => void;
      })(tcpUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableReadyCheck: false,
        connectTimeout: 2000,
        tls: tcpUrl.startsWith('rediss://') ? {} : undefined,
        reconnectOnError: (err: Error) => !isAuthErr(err),
        retryStrategy: (times: number) => {
          if (_redisDisabled || times > 2) return null;
          return Math.min(times * 200, 1000);
        },
      });
      client.on('error', (e: Error) => {
        if (isAuthErr(e) && !_redisDisabled) {
          _redisDisabled = true;
          logger.warn('[AuditChainLock] Redis auth failed — degrading to in-process mutex only');
          try { client.disconnect(); } catch { /* ignore */ }
        }
      });
      await client.ping();
      logger.info('[AuditChainLock] Redis distributed lock ACTIVE', {
        url: tcpUrl.replace(/:[^@]+@/, ':***@'),
        ttlMs: LOCK_TTL_MS,
      });
      _redisClient = client;
      return _redisClient;
    } catch (err) {
      _redisDisabled = true;
      logger.warn('[AuditChainLock] Redis init failed — degrading to in-process mutex only', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();
  return _redisInitPromise;
}

// Compare-and-delete: only release the lock if we still own the token.
// Prevents pod B from deleting pod A's lock if A's TTL expired between
// acquire and release.
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface AuditChainLockHandle {
  acquired: boolean;
  release: () => Promise<void>;
}

const NOOP_RELEASE = async (): Promise<void> => { /* no-op */ };
const DEGRADED_HANDLE: AuditChainLockHandle = Object.freeze({
  acquired: false,
  release: NOOP_RELEASE,
}) as AuditChainLockHandle;

/**
 * Acquire the audit chain lock. Returns a handle whose `release()` MUST be
 * called in a `finally` block.
 *
 * - Returns `{ acquired: true }` and a real release when the Redis lock
 *   was taken.
 * - Returns `{ acquired: false, release: noop }` immediately when Redis
 *   is unavailable or mis-configured (graceful degradation — caller falls
 *   back to its in-process mutex + DB unique-index backstop).
 * - Spin-waits up to ~1.5s for a busy lock, then degrades the same way
 *   so no audit append is ever blocked indefinitely.
 */
export async function acquireAuditChainLock(): Promise<AuditChainLockHandle> {
  const client = await initRedisClient();
  if (!client) return DEGRADED_HANDLE;

  const token = crypto.randomBytes(16).toString('hex');
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const ok = await client.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') {
        return {
          acquired: true,
          release: async () => {
            try {
              await client.eval(RELEASE_LUA, 1, LOCK_KEY, token);
            } catch (err) {
              logger.warn('[AuditChainLock] release failed (lock will TTL-expire)', {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          },
        };
      }
    } catch (err) {
      // Redis hiccup mid-flight — degrade for this call so the audit
      // chain still progresses via the in-process mutex.
      logger.warn('[AuditChainLock] SET failed — degrading for this call', {
        err: err instanceof Error ? err.message : String(err),
      });
      return DEGRADED_HANDLE;
    }
    await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_INTERVAL_MS));
  }
  // Timed out waiting for a busy lock. Degrade so the caller can still
  // attempt the write — DB unique constraint + in-memory mutex remain
  // the correctness backstops.
  logger.warn('[AuditChainLock] acquire timed out — degrading for this call', {
    waitedMs: ACQUIRE_TIMEOUT_MS,
  });
  return DEGRADED_HANDLE;
}

// Test-only hooks — exported under a stable name so tests can reset state
// and inject fake Redis clients without reaching into module privates.
export const _auditChainLockTestHooks = {
  reset(): void {
    _redisClient = null;
    _redisInitPromise = null;
    _redisDisabled = false;
  },
  setClient(c: RedisLikeClient | null): void {
    _redisClient = c;
    _redisDisabled = c === null;
    _redisInitPromise = Promise.resolve(c);
  },
  getLockKey(): string {
    return LOCK_KEY;
  },
  getLockTtlMs(): number {
    return LOCK_TTL_MS;
  },
};
