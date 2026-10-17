/**
 * NYV Rate Limit Middleware — Redis-backed, tier-aware, multi-pod safe
 * Fixes Audit Finding A001: 170 rate limit configs existed but ZERO applied as HTTP middleware
 * Targets: P0-2 (no Redis-backed rate limiting), AI pattern throttling for 120M users
 *
 * Redis Strategy (priority order):
 *   1. NYV_REDIS_TCP_URL = rediss:// TCP URL  → ioredis (preferred, low latency)
 *   2. REDIS_URL         = https:// REST URL  → @upstash/redis REST client (read-write, HTTP/2)
 *   3. In-memory Map fallback (single-pod, dev/test only)
 *
 * @file src/middleware/jrx-rate-limit-middleware.ts
 */
import rateLimit, { Store } from 'express-rate-limit';
import { Request } from 'express';
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';

const logger = createLogger('./jrx-rate-limit');

// ── In-memory store fallback (when Redis unavailable in dev) ──────────────────
const inMemoryCounters = new Map<string, { count: number; resetAt: number }>();

function createInMemoryStore() {
  return {
    async increment(key: string) {
      const now = Date.now();
      const entry = inMemoryCounters.get(key);
      if (!entry || entry.resetAt < now) {
        inMemoryCounters.set(key, { count: 1, resetAt: now + 60_000 });
        return { totalHits: 1, resetTime: new Date(now + 60_000) };
      }
      entry.count++;
      return { totalHits: entry.count, resetTime: new Date(entry.resetAt) };
    },
    async decrement(key: string) {
      const entry = inMemoryCounters.get(key);
      if (entry) entry.count = Math.max(0, entry.count - 1);
    },
    async resetKey(key: string) {
      inMemoryCounters.delete(key);
    },
  };
}

// ── Strategy 2: Upstash REST client (@upstash/redis) — for REDIS_URL (https://) ─
async function createUpstashRestStore(restUrl: string) {
  try {
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.NYV_UPSTASH_REST_TOKEN;
    if (!upstashToken) {
      logger.warn('[RateLimit] REDIS_URL is an Upstash REST URL but UPSTASH_REDIS_REST_TOKEN not set — falling back to in-memory');
      return null;
    }
    const { Redis: UpstashRedis } = await import('@upstash/redis');
    const redis = new UpstashRedis({ url: restUrl, token: upstashToken });
    await redis.ping();
    const testKey = '__nyv_rl_upstash_write_test__';
    await redis.incr(testKey);
    await redis.del(testKey);
    logger.info('[RateLimit] Upstash REST Redis-backed rate limiting ACTIVE (read-write)', {
      url: restUrl.replace(/^(https?:\/\/[^.]+).*/, '$1/***'),
    });
    const TTL_MS = 60_000;
    return {
      async increment(key: string) {
        try {
          // NV-RATE-FIXEDWINDOW-001 (2026-06-24): expire only on the first hit so
          // this is a true fixed 60s window (see ioredis store for the full
          // rationale). Setting PEXPIRE every call previously made the window
          // slide forever under continuous traffic → permanent 429s.
          const count = Number(await redis.incr(key));
          if (count === 1) {
            await redis.pexpire(key, TTL_MS);
          }
          let ttl = TTL_MS;
          try {
            const pttl = Number(await redis.pttl(key));
            if (Number.isFinite(pttl) && pttl > 0) ttl = pttl;
          } catch { /* pttl best-effort */ }
          return { totalHits: count, resetTime: new Date(Date.now() + ttl) };
        } catch {
          return createInMemoryStore().increment(key);
        }
      },
      async decrement(key: string) {
        try { await redis.decr(key); } catch {}
      },
      async resetKey(key: string) {
        try { await redis.del(key); } catch {}
      },
    };
  } catch (err: any) {
    logger.warn('[RateLimit] Upstash REST init failed — falling back to in-memory', { err: String(err) });
    return null;
  }
}

// ── Strategy 1: ioredis TCP — for NYV_REDIS_TCP_URL (rediss://) ──────────────
// Same fail-fast-on-auth-failure semantics as bullmq-queue.ts: when the
// URL is right but the password is wrong, ioredis would otherwise emit
// "[ioredis] Unhandled error event: WRONGPASS" several times per second
// forever. We attach an `error` listener that disconnects on WRONGPASS,
// plus a retryStrategy that gives up after a few attempts, so the
// rate-limiter falls back to in-memory cleanly.
async function createIoRedisStore(redisUrl: string) {
  try {
    const { Redis } = await import('ioredis');
    let disabled = false;
    const isAuthErr = (err: Error) => {
      const m = (err?.message || '').toUpperCase();
      return m.includes('WRONGPASS') || m.includes('NOAUTH');
    };
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableReadyCheck: false,
      connectTimeout: 3000,
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
      reconnectOnError: (err: Error) => !isAuthErr(err),
      retryStrategy: (times: number) => {
        if (disabled || times > 3) return null;
        return Math.min(times * 500, 2_000);
      },
    });
    // CRITICAL: attach this BEFORE the first command so WRONGPASS lands in
    // our handler instead of being treated as "Unhandled error event".
    redis.on('error', (e: Error) => {
      if (isAuthErr(e) && !disabled) {
        disabled = true;
        logger.warn('[RateLimit] ioredis auth failed (WRONGPASS) — falling back to in-memory rate limiting');
        try { redis.disconnect(); } catch { /* ignore */ }
      }
    });
    await redis.ping();
    const testKey = '__nyv_rl_write_test__';
    await redis.incr(testKey);
    await redis.del(testKey);
    logger.info('[RateLimit] ioredis TCP Redis-backed rate limiting ACTIVE (read-write)', {
      url: redisUrl.replace(/:[^@]+@/, ':***@'),
    });
    return {
      async increment(key: string) {
        try {
          // NV-RATE-FIXEDWINDOW-001 (2026-06-24): set the 60s expiry ONLY on the
          // first hit of a window. The previous `incr + pexpire` on EVERY request
          // reset the TTL each call, turning the intended fixed 60s window into a
          // sliding one that NEVER expires under continuous traffic — so a busy
          // console user's counter grew unbounded and stayed permanently over the
          // cap (429 storm, empty dashboards). The Lua script is atomic: INCR,
          // PEXPIRE only when the counter is newly created, then read PTTL so the
          // Retry-After / resetTime reflects the real remaining window.
          const lua = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
return {c, t}`;
          const out = (await redis.eval(lua, 1, key, '60000')) as [number, number];
          const count = Array.isArray(out) ? Number(out[0]) : 1;
          const pttl = Array.isArray(out) ? Number(out[1]) : 60_000;
          const ttl = pttl > 0 ? pttl : 60_000;
          return { totalHits: count, resetTime: new Date(Date.now() + ttl) };
        } catch {
          return createInMemoryStore().increment(key);
        }
      },
      async decrement(key: string) {
        try { await redis.decr(key); } catch {}
      },
      async resetKey(key: string) {
        try { await redis.del(key); } catch {}
      },
    };
  } catch (writeErr: any) {
    if (writeErr?.message?.includes('NOPERM') || writeErr?.message?.includes('READONLY')) {
      logger.warn('[RateLimit] ioredis TCP Redis user is read-only (NOPERM/READONLY) — trying Upstash REST fallback');
    } else {
      logger.warn('[RateLimit] ioredis TCP store init failed', { err: String(writeErr) });
    }
    return null;
  }
}

// ── Redis store factory — tries strategies in priority order ─────────────────
async function createRedisStore() {
  // NV-SECRETS-001 (2026-05-07): TCP path goes through the canonical resolver.
  // REST URL path stays separate — Upstash REST is a different surface
  // (https://) that the resolver intentionally rejects for TCP consumers.
  const r = resolveRedisTcpUrl();
  if (r.enabled && r.url) {
    const store = await createIoRedisStore(r.url);
    if (store) return store;
  }

  // Upstash REST fallback — own walk because resolveRedisTcpUrl() rejects https://.
  const restRaw = process.env.REDIS_URL || process.env.NYV_REDIS_URL || '';
  const restUrl = restRaw.trim().replace(/^["']+|["']+$/g, '');
  if (restUrl && (restUrl.startsWith('https://') || restUrl.startsWith('http://'))) {
    const store = await createUpstashRestStore(restUrl);
    if (store) return store;
  }

  logger.warn('[RateLimit] No writable Redis available — using in-memory rate limiting (single-pod only)');
  return null;
}

// ── Store factory — express-rate-limit v7+ forbids sharing one store instance
// across multiple rate limiters. We keep one backing implementation (Redis or
// in-memory) but wrap it in a new object per call so every rateLimit() gets its
// own store reference.
type BackingStore = {
  increment(key: string): Promise<{ totalHits: number; resetTime: Date }>;
  decrement(key: string): Promise<void>;
  resetKey(key: string): Promise<void>;
};

let backingStore: BackingStore = createInMemoryStore();
const inMemoryFallback: BackingStore = createInMemoryStore();
createRedisStore().then(s => {
  if (s) backingStore = s;
}).catch(() => {});

// Timeout-wrap any backing-store call so a flaky Redis cannot hang requests.
// On timeout (>1.5s) we fall back to the in-memory counter for that call.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      fallback().then(resolve).catch(() => resolve(undefined as unknown as T));
    }, ms);
    p.then(v => { if (settled) return; settled = true; clearTimeout(t); resolve(v); })
     .catch(() => { if (settled) return; settled = true; clearTimeout(t); fallback().then(resolve).catch(() => resolve(undefined as unknown as T)); });
  });
}

function makeStore(): Store {
  return {
    increment: (key: string) => withTimeout(
      backingStore.increment(key),
      1500,
      () => inMemoryFallback.increment(key)
    ),
    decrement: (key: string) => withTimeout(
      backingStore.decrement(key),
      1500,
      () => inMemoryFallback.decrement(key)
    ),
    resetKey: (key: string) => withTimeout(
      backingStore.resetKey(key),
      1500,
      () => inMemoryFallback.resetKey(key)
    ),
  } as unknown as Store;
}

// ── Helper: extract user identity key ────────────────────────────────────────
function getUserKey(req: Request): string {
  return req.user?.id || req.user?.userId || req.ip || 'unknown';
}

// ── E2E BYPASS (dev/test only) ───────────────────────────────────────────────
// task-2026-05-13: user directive — disable ALL rate/security limits while we
// complete consumer-platform end-to-end testing. Activated only when
// NV_E2E_BYPASS=1 AND NODE_ENV !== 'production'.  Production posture unchanged.
export const NV_E2E_BYPASS =
  process.env.NV_E2E_BYPASS === '1' && process.env.NODE_ENV !== 'production';
if (NV_E2E_BYPASS) {
  // eslint-disable-next-line no-console
  console.warn('[nv-rate-limit] NV_E2E_BYPASS=1 — ALL rate limits disabled (dev/test)');
}
// NV-PLATFORM-UAT-BYPASS-001 (2026-05-14): production-safe targeted bypass for
// the 7 internal Jurexio platform keys only (sha256 fingerprint match).
import { isPlatformUatRequest } from './jrx-platform-uat-bypass.js';
import { shouldSkipPartnerProductRateLimits } from '../utils/jrx-partner-platform.js';
const _bypass = (req?: Request) =>
  NV_E2E_BYPASS
  || isPlatformUatRequest(req)
  || (!!req && shouldSkipPartnerProductRateLimits(req));

// ── PUBLIC (unauthenticated) — 30 req/min ────────────────────────────────────
export const publicRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `pub:${req.ip}`,
  skip: (req) => {
    if (NV_E2E_BYPASS) return true;
    if (isPlatformUatRequest(req)) return true;
    if (shouldSkipPartnerProductRateLimits(req)) return true;
    const p = req.path;
    if (p === '/health' || p.endsWith('/health') || p.endsWith('/docs')) return true;
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth)) return true;
    // NYV-AUDIT-F6 (2026-05-05): SDK API-key requests must NOT be rate-limited as
    // public traffic. They have their own sdkApiKeyRateLimit (200/min). Without
    // this skip, the 30/min public bucket throttles legit SDK clients.
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) return true;
    if (req.headers['x-nsp-inter-secret'] || req.headers['x-inter-service-secret']) return true;
    return false;
  },
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    code: 'NYV-RATE-001',
    retryAfterSeconds: 60,
    message: 'Public rate limit exceeded. Authenticate for higher limits.',
  },
});

// ── AUTHENTICATED users — 600 req/min ────────────────────────────────────────
// NV-RATE-AUTH-LIMIT-001 (2026-06-24): raised 120 → 600. The Command-Center
// console legitimately fans out ~15–20 GETs per page on load (KPI tiles, health,
// providers, agents, audit, hitl, protocols, …) plus background polling, so a
// normal admin session crossed the old 120/min cap within a few page loads and
// every widget went blank (429). 600/min gives headroom for real console usage
// while still bounding abuse; expensive LLM calls remain separately gated by the
// 20/min aiPatternRateLimit (NYV-RATE-003).
export const authenticatedRateLimit = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `auth:${getUserKey(req)}`,
  skip: _bypass,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    code: 'NYV-RATE-002',
    retryAfterSeconds: 60,
  },
});

// ── AI PATTERN calls — 20 req/min (expensive LLM calls) ─────────────────────
export const aiPatternRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `ai:${getUserKey(req)}`,
  skip: _bypass,
  message: {
    error: 'AI_RATE_LIMIT_EXCEEDED',
    code: 'NYV-RATE-003',
    message: 'AI pattern limit reached. Upgrade your plan for higher limits.',
    retryAfterSeconds: 60,
    upgradeUrl: process.env.NYV_PRICING_URL || 'https://nyayasiddhi.com/pricing',
  },
});

// ── AUTH endpoints — 10 attempts/15min (brute-force protection) ──────────────
export const authLoginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `login:${req.ip}`,
  skip: _bypass,
  message: {
    error: 'AUTH_RATE_LIMIT',
    code: 'NYV-RATE-004',
    message: 'Too many login attempts. Please wait 15 minutes.',
  },
});

// ── ENTERPRISE tier — 500 req/min ────────────────────────────────────────────
export const enterpriseRateLimit = rateLimit({
  windowMs: 60_000,
  max: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `ent:${req.user?.orgId || req.ip}`,
  skip: _bypass,
});

// ── SDK API key calls — 200 req/min ──────────────────────────────────────────
export const sdkApiKeyRateLimit = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => `sdk:${req.headers['x-api-key'] || req.ip}`,
  skip: _bypass,
  message: {
    error: 'SDK_RATE_LIMIT_EXCEEDED',
    code: 'NYV-RATE-005',
    retryAfterSeconds: 60,
  },
});

// Clean up old in-memory entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryCounters.entries()) {
    if (entry.resetAt < now) inMemoryCounters.delete(key);
  }
}, 5 * 60_000);
