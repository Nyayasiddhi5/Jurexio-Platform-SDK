/**
 * JRX-OPS-REDIS-001 (Task #28) — Redis TCP URL gating
 * NV-SECRETS-001 (2026-05-07)   — Single canonical env-var name
 *
 * The platform supports two Redis surfaces:
 *   • TCP via ioredis           — needs redis:// or rediss:// URL
 *   • Upstash REST via @upstash — needs https:// URL + REST token
 *
 * BullMQ + ioredis-backed rate limiter REQUIRE TCP. When the only Redis
 * URL configured is the Upstash REST URL (https://...) ioredis will
 * happily try to connect, get WRONGPASS forever, and spam the logs every
 * ~1s as it retries. This module gives every TCP-only consumer a single,
 * authoritative way to ask: "do I have a real TCP URL or should I just
 * disable myself and stay quiet?"
 *
 * NV-SECRETS-001 — single canonical env var name:
 *
 *   CANONICAL: JRX_REDIS_TCP_URL    (rediss:// recommended, redis:// allowed)
 *   LEGACY (still accepted, but each emits a one-shot DEPRECATED warning):
 *     • JRX_REDIS_WRITE_URL  (write-replica alias from earlier seed)
 *     • REDIS_URL            (historical Upstash + dev convention)
 *     • JRX_REDIS_URL        (older Jurexio-prefixed alias)
 *
 * No new code may add a new alias without updating this list AND the
 * NV-SECRETS-001 guardrail in replit.md (pre-flight grep first).
 *
 * Disabling rules:
 *   • No URL at all                  → disabled (silent)
 *   • https:// URL                   → disabled (REST-only env)
 *   • redis:// or rediss:// URL      → enabled, return cleaned URL
 *
 * Each consumer is expected to log the disabled reason ONCE on startup
 * (see {@link logRedisDisabledOnce}) so we never re-emit the same line.
 */

import { createLogger } from './logger.js';

const logger = createLogger('redis-tcp-url');

const TCP_PREFIXES = ['redis://', 'rediss://'] as const;

/** NV-SECRETS-001: the one true name (writes / primary). */
export const CANONICAL_REDIS_VAR = 'JRX_REDIS_TCP_URL' as const;

/**
 * NV-SECRETS-001 (extension 2026-05-07): single canonical name for the
 * READ-REPLICA TCP URL. Distinct concept from CANONICAL_REDIS_VAR
 * (writes / primary) and from JRX_DB_READ_REPLICA_URL (Postgres, not
 * Redis). Pre-flight grep on 2026-05-07 confirmed no prior alias.
 *
 * Consumers that only do GET-path Redis reads (lm-cache GETs,
 * jrx-redis-cache-service hot-read), feel free to opt into this URL via
 * `resolveRedisReadUrl()`. Write-path consumers (BullMQ, rate limiter,
 * audit-chain-lock, PII vault, queue) MUST continue to use the primary
 * via `resolveRedisTcpUrl()`.
 *
 * When JRX_REDIS_READ_URL is absent, `resolveRedisReadUrl()` falls back
 * to the primary URL so single-endpoint envs (Replit dev / Upstash)
 * Just Work without a config change.
 */
export const CANONICAL_REDIS_READ_VAR = 'JRX_REDIS_READ_URL' as const;

/** NV-SECRETS-001: legacy aliases still honoured (with one-shot deprecation warn). */
export const LEGACY_REDIS_VARS = [
  'JRX_REDIS_WRITE_URL',
  'REDIS_URL',
  'JRX_REDIS_URL',
] as const;

export interface RedisTcpResolution {
  /** True when a usable TCP URL is configured. */
  enabled: boolean;
  /** Cleaned (trim + quote-strip) URL when enabled, else null. */
  url: string | null;
  /** Human-readable reason when disabled — for one-shot startup log. */
  reason: string | null;
  /** Which env-var name actually supplied the URL (for telemetry + dep warn). */
  resolvedFrom: string | null;
}

function clean(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^["']+|["']+$/g, '');
}

/** One-shot dedup for deprecation warnings keyed by var name. */
const _depWarned = new Set<string>();
function _warnDeprecatedAlias(varName: string): void {
  if (_depWarned.has(varName)) return;
  _depWarned.add(varName);
  logger.warn(
    `[NV-SECRETS-001] DEPRECATED env var ${varName} resolved Redis TCP URL — ` +
    `please rename to ${CANONICAL_REDIS_VAR}. Legacy aliases will be removed in v6.0.`,
  );
}

/**
 * Resolve a TCP Redis URL from the environment with strict validation.
 * Returns `enabled: false` (with a reason) when no usable TCP URL exists,
 * so callers can short-circuit instead of constructing an ioredis client
 * that will WRONGPASS-loop forever.
 *
 * NV-SECRETS-001: prefers CANONICAL_REDIS_VAR; falls back to LEGACY_REDIS_VARS
 * in priority order, emitting a ONE-SHOT deprecation warning for any legacy
 * hit so the operator knows to consolidate.
 */
export function resolveRedisTcpUrl(): RedisTcpResolution {
  // Priority order: canonical first, then legacy aliases. We accept the
  // first VALID redis(s):// scheme we find — defensive against malformed
  // env values (we have seen e.g. "ediss://..." caused by a chopped
  // leading char) — a bad value in JRX_REDIS_TCP_URL must NOT block a
  // good JRX_REDIS_WRITE_URL behind it.
  const candidates: Array<[string, string]> = [
    [CANONICAL_REDIS_VAR, clean(process.env[CANONICAL_REDIS_VAR])],
    ...LEGACY_REDIS_VARS.map((v) => [v, clean(process.env[v])] as [string, string]),
  ];

  let lastBadVar: string | null = null;
  let lastBadScheme: string | null = null;
  let httpsSeenAt: string | null = null;

  for (const [varName, raw] of candidates) {
    if (!raw) continue;

    // TCP scheme — ACCEPT
    if (TCP_PREFIXES.some((p) => raw.startsWith(p))) {
      if (varName !== CANONICAL_REDIS_VAR) _warnDeprecatedAlias(varName);
      return { enabled: true, url: raw, reason: null, resolvedFrom: varName };
    }

    // https:// — Upstash REST URL, NOT a TCP URL. Track + skip.
    if (raw.startsWith('https://')) {
      httpsSeenAt = httpsSeenAt ?? varName;
      continue;
    }

    // Anything else — malformed scheme. Track for diagnostic.
    lastBadVar = varName;
    lastBadScheme = (raw.split('://')[0] || '<no-scheme>') + '://';
  }

  if (httpsSeenAt) {
    return {
      enabled: false,
      url: null,
      reason:
        `${httpsSeenAt} is an Upstash REST URL (https://) — TCP consumers ` +
        `(BullMQ, ioredis, redis-cache, PII vault) disabled; set ` +
        `${CANONICAL_REDIS_VAR}=rediss://... to enable`,
      resolvedFrom: null,
    };
  }

  if (lastBadVar) {
    return {
      enabled: false,
      url: null,
      reason: `${lastBadVar} set but scheme '${lastBadScheme}' is invalid (expected redis:// or rediss://)`,
      resolvedFrom: null,
    };
  }

  return {
    enabled: false,
    url: null,
    reason: `No Redis URL configured (set ${CANONICAL_REDIS_VAR}=rediss://...)`,
    resolvedFrom: null,
  };
}

const _onceLogged = new Set<string>();

/**
 * Log the disabled reason exactly ONCE per consumer so the platform never
 * emits "BullMQ disabled..." every second after a workflow restart. Safe
 * to call from many code paths.
 */
export function logRedisDisabledOnce(consumer: string, reason: string): void {
  const key = `${consumer}:${reason}`;
  if (_onceLogged.has(key)) return;
  _onceLogged.add(key);
  logger.warn(`[${consumer}] Redis TCP disabled — ${reason}`);
}

/** Test/observability — clear the one-shot dedup set between suites. */
export function _resetRedisDisabledOnce(): void {
  _onceLogged.clear();
  _depWarned.clear();
}

/**
 * Convenience accessor for `/admin/health/full`. Returns the human-readable
 * reason Redis TCP is disabled, or `null` when Redis TCP is currently
 * usable. Re-resolves on each call so flipping env vars at runtime
 * (smoke tests / staging toggles) is reflected immediately.
 */
export function getRedisDisabledReason(): string | null {
  const r = resolveRedisTcpUrl();
  return r.enabled ? null : (r.reason ?? 'Redis TCP URL not configured');
}

/**
 * Returns the env-var name that supplied the active Redis URL, or null
 * when no TCP URL is available. Useful for telemetry / parity reports.
 */
export function getResolvedRedisVarName(): string | null {
  return resolveRedisTcpUrl().resolvedFrom;
}

/**
 * NV-SECRETS-001 (read-replica): resolve the read-side TCP URL. Returns
 * the same shape as `resolveRedisTcpUrl()`. Falls back to the primary
 * when JRX_REDIS_READ_URL is absent so single-endpoint envs don't need
 * to set both.
 *
 * Recommended for: cache GET paths only. Do NOT route writes, BullMQ
 * jobs, rate-limit counters, audit-chain locks, or PII-vault writes
 * here — those MUST stay on the primary via `resolveRedisTcpUrl()`.
 */
export function resolveRedisReadUrl(): RedisTcpResolution {
  const raw = clean(process.env[CANONICAL_REDIS_READ_VAR]);
  if (raw && TCP_PREFIXES.some((p) => raw.startsWith(p))) {
    return { enabled: true, url: raw, reason: null, resolvedFrom: CANONICAL_REDIS_READ_VAR };
  }
  if (raw && raw.startsWith('https://')) {
    // Upstash REST URL on read replica isn't useful for ioredis. Fall
    // back to primary instead of disabling outright.
    logger.warn(
      `[NV-SECRETS-001] ${CANONICAL_REDIS_READ_VAR} is an Upstash REST URL (https://) — ` +
      `falling back to primary (${CANONICAL_REDIS_VAR}) for read-side TCP consumers`,
    );
    return resolveRedisTcpUrl();
  }
  if (raw) {
    logger.warn(
      `[NV-SECRETS-001] ${CANONICAL_REDIS_READ_VAR} set but scheme invalid — ` +
      `expected redis:// or rediss://; falling back to primary`,
    );
  }
  // No read URL configured — silently fall back to primary.
  return resolveRedisTcpUrl();
}
