/**
 * Redis-backed sliding-window rate limiter with a first-class `platform_id`
 * axis. Replaces the per-process in-memory limiter for production.
 *
 * Composite key: nyv:rl:<platform_id>:<tier>:<endpoint_bucket>:<identity>
 *   - platform_id: from req.platform (set by sdk gateway middleware) or X-Client-ID header
 *   - tier:        from req.platformTier or 'default'
 *   - endpoint:    bucketed slug (configurable in config/rate-limits/rate-limits.json)
 *   - identity:    user id, app id, or IP, in that priority
 *
 * Algorithm:
 *   Sliding window via Redis sorted-set (ZADD + ZREMRANGEBYSCORE + ZCARD)
 *   — all in a single MULTI for atomicity. O(log N) per request.
 *
 * Failure mode: if Redis is unavailable, FAIL OPEN with a logged warning so
 * we never blackhole a paying platform; pair this with the AWS WAF baseline
 * IP rate limit which always runs at the edge.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Redis as IORedis } from 'ioredis';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../utils/redis-tcp-url.js';
import {
  resolvePartnerPlatformHint,
  shouldSkipPartnerProductRateLimits,
} from '../utils/jrx-partner-platform.js';
import { isPlatformUatRequest } from './jrx-platform-uat-bypass.js';

const logger = createLogger('redis-platform-rate-limiter');

// JRX-OPS-RATELIMIT-DISABLE-001 (Task #28): same WRONGPASS-spam fix as
// BullMQ. If no real TCP URL is set, do NOT construct ioredis (it would
// retry every second forever). Log once, then fail open at the
// middleware layer so the in-memory limiter (createTieredRateLimit)
// remains the line of defence in REST-only environments.
const _redisResolution = resolveRedisTcpUrl();
const REDIS_TCP_AVAILABLE = _redisResolution.enabled;
const REDIS_URL = _redisResolution.url ?? '';

if (!REDIS_TCP_AVAILABLE && _redisResolution.reason) {
  logRedisDisabledOnce('RedisPlatformRateLimiter', _redisResolution.reason);
}

// JRX-OPS-RATELIMIT-AUTH-GATE-001 (Task #28 round 4): full parity with the
// BullMQ + jrx-rate-limit-middleware fix. If the URL is right but the
// password is wrong, ioredis would otherwise emit
// "[ioredis] Unhandled error event: WRONGPASS" several times per second
// for the entire process lifetime. We attach an `error` listener that
// detects WRONGPASS / NOAUTH, flips `_runtimeDisabled`, disconnects the
// socket, and stops further reconnects. After that getClient() returns
// null and every middleware call falls open via the in-memory limiter.
let _client: IORedis | null = null;
let _runtimeDisabled = false;
function isAuthErr(err: Error): boolean {
  const m = (err?.message || '').toUpperCase();
  return m.includes('WRONGPASS') || m.includes('NOAUTH');
}
function getClient(): IORedis | null {
  if (!REDIS_TCP_AVAILABLE || _runtimeDisabled) return null;
  if (!_client) {
    _client = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: false,
      reconnectOnError: (err: Error) => !isAuthErr(err),
      retryStrategy: (times: number) => {
        if (_runtimeDisabled || times > 3) return null;
        return Math.min(times * 500, 2_000);
      },
    });
    _client.on('error', (e: Error) => {
      if (isAuthErr(e) && !_runtimeDisabled) {
        _runtimeDisabled = true;
        logger.warn('redis rate-limiter auth failed (WRONGPASS/NOAUTH) — falling open and disconnecting');
        try { _client?.disconnect(); } catch { /* ignore */ }
        _client = null;
        return;
      }
      logger.warn('redis rate-limiter error (fail-open)', { err: e.message });
    });
  }
  return _client;
}

/* ---------- config loader ---------- */

interface RateConfig {
  default: { rpm: number; rph?: number; rpd?: number; burst?: number };
  tiers?: Record<string, { rpm: number; rph?: number; rpd?: number; burst?: number; concurrentStreams?: number }>;
  platformOverrides?: Record<string, { tier?: string; rpm?: number; rph?: number; rpd?: number; concurrentStreams?: number }>;
  endpointOverrides?: Record<string, { weight?: number; exempt?: boolean }>;
  headers?: { limit?: string; remaining?: string; reset?: string; retryAfter?: string };
}

let _config: RateConfig | null = null;
function loadConfig(): RateConfig {
  if (_config) return _config;
  const candidates = [
    process.env.JRX_RATE_LIMITS_FILE,
    path.resolve('config/rate-limits/rate-limits.json'),
    path.resolve(process.cwd(), 'config/rate-limits/rate-limits.json'),
  ].filter(Boolean) as string[];
  for (const f of candidates) {
    try {
      _config = JSON.parse(fs.readFileSync(f, 'utf-8'));
      logger.info('rate-limits config loaded', { file: f });
      return _config!;
    } catch {
      /* try next */
    }
  }
  _config = { default: { rpm: 60 } };
  logger.warn('rate-limits config NOT found — using minimal default { rpm: 60 }');
  return _config!;
}

/* ---------- helpers ---------- */

const HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
  retryAfter: 'Retry-After',
  platform: 'X-RateLimit-Platform',
};

function bucketEndpoint(req: Request): string {
  // strip ids: /api/jrx/agents/abc-123 -> /api/jrx/agents/:id
  const path = (req.baseUrl || '') + (req.path || '');
  return path.replace(/\/[0-9a-fA-F-]{8,}/g, '/:id').replace(/\/\d+/g, '/:id');
}

function resolveIdentity(req: Request): string {
  const u = (req as any).user?.id;
  if (u) return `u:${u}`;
  const a = (req as any).sdkApp?.appId;
  if (a) return `a:${a}`;
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function resolvePlatform(req: Request): string {
  const explicit = (req as any).platform || (req as any).sdkApp?.platformType;
  if (explicit) return String(explicit);

  const nyvPlatform = String(req.headers['x-jrx-platform'] || '').trim().toLowerCase();
  if (nyvPlatform === 'nys' || nyvPlatform.includes('nyayasearch')) return 'nys';

  const hint = resolvePartnerPlatformHint(req);
  if (hint === 'NSP' || hint === 'NSPM') return 'nys-professional';
  if (hint === 'NYM') return 'jurexio-citizen';

  const clientId = req.headers['x-client-id'] as string | undefined;
  if (clientId) return clientId;

  return 'unknown';
}

function resolveLimitsFor(platform: string, tier: string, endpoint: string, cfg: RateConfig) {
  const eo = cfg.endpointOverrides?.[endpoint];
  if (eo?.exempt) return null;
  const weight = eo?.weight ?? 1;
  const po = cfg.platformOverrides?.[platform];
  const t = cfg.tiers?.[po?.tier ?? tier] ?? cfg.tiers?.['pro'] ?? cfg.default;
  const rpm = po?.rpm ?? t.rpm ?? cfg.default.rpm ?? 60;
  return { rpm: Math.max(1, Math.floor(rpm / weight)) };
}

/* ---------- middleware factory ---------- */

export function createRedisPlatformRateLimiter(opts: { enabled?: boolean } = {}) {
  const enabled = (opts.enabled ?? process.env.JRX_RATE_LIMITER !== 'off') && REDIS_TCP_AVAILABLE;
  const cfg = loadConfig();
  // JRX-OPS-RATELIMIT-LIVE-CLIENT-001 (Task #28 round 6): the previous
  // version captured `client = getClient()` once at factory creation.
  // If runtime auth-failure later flipped `_runtimeDisabled=true` and
  // nulled the module-level `_client`, the captured reference was
  // stale — every request still routed through the dead socket and
  // relied on the try/catch fail-open instead of the cleaner up-front
  // bypass. Resolve the client per request so `_runtimeDisabled` /
  // re-init takes effect immediately.

  return async function rateLimiter(req: Request, res: Response, next: NextFunction) {
    if (!enabled) return next();
    if (isPlatformUatRequest(req) || shouldSkipPartnerProductRateLimits(req)) {
      res.setHeader('X-NSP-Unlimited', '1');
      return next();
    }
    const client = getClient();
    if (!client) return next();

    const platform = resolvePlatform(req);
    const tier = (req as any).platformTier || (req as any).sdkApp?.tier || 'pro';
    const endpoint = bucketEndpoint(req);
    const limits = resolveLimitsFor(platform, tier, endpoint, cfg);
    if (!limits) return next();

    const identity = resolveIdentity(req);
    const windowMs = 60_000;
    const now = Date.now();
    const key = `nyv:rl:${platform}:${tier}:${endpoint}:${identity}`;

    try {
      // NV-CRYPTO (R4): replaced Math.random with crypto.randomBytes for ZSET member uniqueness.
      const member = `${now}:${crypto.randomBytes(4).toString('hex')}`;
      const cutoff = now - windowMs;
      const pipe = client.multi();
      pipe.zadd(key, now.toString(), member);
      pipe.zremrangebyscore(key, '-inf', cutoff.toString());
      pipe.zcard(key);
      pipe.pexpire(key, windowMs + 1000);
      const results = (await pipe.exec()) as any[];
      const count = Number(results?.[2]?.[1] ?? 0);

      const remaining = Math.max(0, limits.rpm - count);
      const resetSec = Math.ceil((now + windowMs) / 1000);
      res.setHeader(HEADERS.limit, String(limits.rpm));
      res.setHeader(HEADERS.remaining, String(remaining));
      res.setHeader(HEADERS.reset, String(resetSec));
      res.setHeader(HEADERS.platform, platform);

      if (count > limits.rpm) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader(HEADERS.retryAfter, String(retryAfter));
        logger.warn('rate limit exceeded', { platform, tier, endpoint, identity, count, limit: limits.rpm });
        return res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: `Rate limit exceeded for platform '${platform}' on ${endpoint}`, retryAfterSec: retryAfter },
        });
      }
      return next();
    } catch (err: any) {
      logger.warn('rate-limiter fail-open (redis error)', { err: err.message });
      return next(); // fail open
    }
  };
}

/** Drop-in sugar for routers: `app.use(redisPlatformLimiter())` */
export const redisPlatformLimiter = createRedisPlatformRateLimiter;
