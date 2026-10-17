import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';
const logger = createLogger('redis');

// NV-SECRETS-001: single resolver source of truth. Falls back to local
// dev default when nothing is configured (preserves the historical
// behavior of this lazy bootstrap module).
const _resolved = resolveRedisTcpUrl();
const url = _resolved.url || 'redis://localhost:6379';

/**
 * Lazy redis client construction (Task #32 round 10e):
 * `createClient({ url })` parses + validates the URL eagerly and
 * THROWS at module-load time when REDIS_URL is misconfigured (e.g.
 * an HTTPS Upstash control-plane URL pasted in by mistake). Defer
 * construction until first access so importing this module is always
 * safe — production fail-loud still happens at the first ensureRedis()
 * call site, but ambient imports (tests, dynamic seams) no longer
 * crash the whole process.
 */
let _client: RedisClientType | null = null;
let _ctorError: Error | null = null;

function getClient(): RedisClientType {
  if (_client) return _client;
  if (_ctorError) throw _ctorError;
  try {
    /**
     * NV-REDIS-RECONNECT-2026-05-11 (Session-15 v14, NV-OWNERSHIP-001).
     * Symptom: gateway logs flooded with `cache_get_error … client is
     * closed` once the upstream Redis (Upstash) drops the socket — the
     * default node-redis v4 reconnect strategy gives up after a handful
     * of attempts, leaving the client permanently in `isOpen=false` even
     * though every subsequent `get`/`set` then throws synchronously.
     * Fix: cap-bounded exponential backoff with NO retry ceiling, plus
     * `pingInterval` so the connection self-heals across NAT/idle
     * timeouts on Upstash + ElastiCache. This is partner-facing because
     * the same wrapper feeds the agent-registry cache, prompt cache,
     * rate-limiters, and token-revocation paths used by every SDK call.
     */
    _client = createClient({
      url,
      socket: {
        // node-redis v4: reconnectStrategy returns ms-delay (number) or Error to abort.
        // Cast required because the installed @types/redis here expose a
        // narrower (boolean|undefined) shape that the runtime ignores.
        reconnectStrategy: ((retries: number, cause?: Error) => {
          // Upstash sometimes closes idle TLS; never give up.
          // Backoff: 50, 100, 200, …, capped at 30 s.
          const delay = Math.min(50 * Math.pow(2, Math.max(0, retries - 1)), 30_000);
          if (retries > 0 && (retries % 10 === 0)) {
            logger.warn('redis reconnect attempt', { retries, delayMs: delay, cause: cause?.message });
          }
          return delay;
        }) as any,
        keepAlive: 30_000,
      },
      pingInterval: 60_000,
    } as any) as RedisClientType;
    _client.on('error', (e: unknown) =>
      logger.error('redis error', { error: e instanceof Error ? e.message : String(e) }),
    );
    _client.on('reconnecting', () => logger.info('redis reconnecting'));
    _client.on('ready', () => logger.info('redis ready'));
    _client.on('end', () => logger.warn('redis end (will auto-reconnect)'));
    return _client;
  } catch (e) {
    _ctorError = e instanceof Error ? e : new Error(String(e));
    logger.error('redis client construction failed', { error: _ctorError.message, url });
    throw _ctorError;
  }
}

/**
 * Back-compat named export — preserves the historic `redis.<method>(…)`
 * call shape via a method-bag Proxy that routes every method call
 * through the lazily-constructed client. Property reads for non-method
 * fields (e.g. `redis.isOpen`) are forwarded directly to the resolved
 * client, so consumers reading state still see real values once the
 * client has been constructed at least once.
 */
export const redis: RedisClientType = new Proxy({} as RedisClientType, {
  get(_t, prop, receiver) {
    if (prop === 'then') return undefined;
    const c = getClient();
    const value = Reflect.get(c as object, prop, receiver);
    if (typeof value === 'function') {
      return (value as (...a: unknown[]) => unknown).bind(c);
    }
    return value;
  },
}) as RedisClientType;

let connecting: Promise<void> | null = null;
/**
 * NV-REDIS-RECONNECT-2026-05-11 (Session-15 v14, post-architect):
 * `connecting` is reset to null on BOTH success and failure. The previous
 * implementation only reset on failure, so once the first connect resolved
 * a permanent stale resolved promise was cached — meaning a later
 * `isOpen=false` (after Upstash drops the socket and the auto-reconnect
 * is mid-backoff) would return the stale promise instantly without
 * actually firing a new `c.connect()`. Plus we now inspect both
 * `isOpen` and `isReady` so we re-issue connect any time the underlying
 * socket is unusable for commands.
 */
export async function ensureRedis(): Promise<void> {
  const c = getClient();
  const isUsable = c.isOpen && (c as any).isReady !== false;
  if (isUsable) return;
  if (!connecting) {
    connecting = c.connect()
      .then(() => undefined)
      .catch((e) => { throw e; })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

export default redis;
