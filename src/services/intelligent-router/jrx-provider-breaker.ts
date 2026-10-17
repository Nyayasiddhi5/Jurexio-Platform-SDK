/**
 * NV-LLM-BREAKER-SHARED-001 — one shared provider gate for the whole cascade.
 *
 * Three defects this replaces (plan §9):
 *
 * 1. The breaker was an in-process `Map` (`PROVIDER_QUARANTINE` in
 *    `llm-orchestrator.ts`) that reset on every pod restart and was invisible to
 *    sibling pods. A provider returning 402 to pod A kept being hit by pods B–D
 *    for the full quarantine TTL, once per request each.
 * 2. `src/utils/jrx-circuit-breaker.ts` wires up a real breaker (opossum) but
 *    nothing on the live orchestration path ever calls it — so in practice there
 *    was no breaker at all, only a hard-fail quarantine.
 * 3. The STREAMING path kept its OWN `quarantinedProviders` set, local to a
 *    single `streamLLM` invocation, so a provider known to return 402 was
 *    re-attempted on the very next stream.
 *
 * Design notes:
 * - Redis (canonical `NYV_REDIS_TCP_URL`, NV-SECRETS-001) is the shared store;
 *   an in-process mirror is ALWAYS maintained so a Redis outage degrades to
 *   exactly today's behaviour rather than to "no protection at all". Secret
 *   values are never logged — only the resolved env-var NAME.
 * - Half-open is a single-probe token (`SET NX EX`), so across N pods exactly
 *   one request probes a recovering provider per probe interval instead of all
 *   of them stampeding the moment the cooldown expires.
 * - `agentzero` / `simulation` are never gated: they are the never-fail terminal
 *   rungs and breaking them would empty the cascade (NV-NEVER-EMPTY-001).
 */

import { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import { resolveRedisTcpUrl } from '../../utils/redis-tcp-url.js';

const logger = createLogger('./jrx-provider-breaker');

const KEY_PREFIX = 'nyv:llm:gate';

/** Providers that must never be gated — the cascade's guaranteed floor. */
const UNGATEABLE = new Set(['agentzero', 'simulation']);

export type BreakerState = 'closed' | 'open' | 'half_open' | 'quarantined';

export interface ProviderGate {
  provider: string;
  state: BreakerState;
  /** False → skip this provider without making a network call. */
  allowed: boolean;
  reason?: string;
  /** Rolling-window failure count that produced this state. */
  failures?: number;
  openUntil?: number;
}

interface LocalEntry {
  failures: number;
  successes: number;
  windowStartedAt: number;
  openUntil: number;
  quarantinedUntil: number;
  lastProbeAt: number;
  lastReason?: string;
}

function envInt(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.floor(n));
}

/** Rolling window over which failures are counted before the circuit opens. */
const WINDOW_MS = envInt('NYV_LLM_BREAKER_WINDOW_MS', 60_000, 5_000);
/** Consecutive-ish failures in the window that trip the circuit. */
const FAILURE_THRESHOLD = envInt('NYV_LLM_BREAKER_FAILURES', 4, 1);
/** How long the circuit stays open before a half-open probe is permitted. */
const OPEN_MS = envInt('NYV_LLM_BREAKER_OPEN_MS', 30_000, 1_000);
/** At most one half-open probe per provider per interval, cluster-wide. */
const PROBE_INTERVAL_MS = envInt('NYV_LLM_BREAKER_PROBE_MS', 10_000, 1_000);
/**
 * Hard quarantine TTL for non-retryable provider failures (402 / bad key /
 * unsupported model). Kept as the existing env var so ops tuning carries over.
 */
const QUARANTINE_MS = envInt('NYV_LLM_PROVIDER_QUARANTINE_MS', 10 * 60_000, 60_000);

const local = new Map<string, LocalEntry>();

function localEntry(provider: string): LocalEntry {
  let e = local.get(provider);
  if (!e) {
    e = {
      failures: 0,
      successes: 0,
      windowStartedAt: Date.now(),
      openUntil: 0,
      quarantinedUntil: 0,
      lastProbeAt: 0,
    };
    local.set(provider, e);
  }
  if (Date.now() - e.windowStartedAt > WINDOW_MS) {
    e.failures = 0;
    e.successes = 0;
    e.windowStartedAt = Date.now();
  }
  return e;
}

// ── Redis connection (lazy, fail-soft) ───────────────────────────────────────

let redisClient: Redis | null = null;
let redisDisabled = false;
let redisInitPromise: Promise<Redis | null> | null = null;

function isAuthError(err: Error): boolean {
  const m = (err?.message || '').toUpperCase();
  return m.includes('WRONGPASS') || m.includes('NOAUTH');
}

async function getRedis(): Promise<Redis | null> {
  if (redisDisabled) return null;
  if (redisClient) return redisClient;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    const resolution = resolveRedisTcpUrl();
    if (!resolution.enabled || !resolution.url) {
      redisDisabled = true;
      // Reason text from the resolver never contains a secret value.
      logger.warn(
        './jrx-provider-breaker: shared breaker disabled — per-pod fallback in use',
        { reason: resolution.reason },
      );
      return null;
    }
    try {
      const client = new Redis(resolution.url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        enableReadyCheck: false,
        connectTimeout: 3_000,
        tls: resolution.url.startsWith('rediss://') ? {} : undefined,
        reconnectOnError: (err: Error) => !isAuthError(err),
        retryStrategy: (times: number) => (redisDisabled || times > 3 ? null : Math.min(times * 500, 2_000)),
      });
      // Attached before the first command so WRONGPASS lands here rather than
      // becoming an unhandled error event storm.
      client.on('error', (e: Error) => {
        if (isAuthError(e) && !redisDisabled) {
          redisDisabled = true;
          logger.warn('./jrx-provider-breaker: Redis auth failed — falling back to per-pod breaker');
          try { client.disconnect(); } catch { /* already down */ }
        }
      });
      await client.ping();
      redisClient = client;
      logger.info('./jrx-provider-breaker: shared breaker ACTIVE', {
        resolvedFrom: resolution.resolvedFrom,
      });
      return client;
    } catch (err: any) {
      redisDisabled = true;
      logger.warn('./jrx-provider-breaker: Redis init failed — per-pod fallback in use', {
        err: String(err?.message || err).slice(0, 160),
      });
      return null;
    }
  })();

  return redisInitPromise;
}

const failKey = (p: string) => `${KEY_PREFIX}:${p}:fail`;
const openKey = (p: string) => `${KEY_PREFIX}:${p}:open`;
const probeKey = (p: string) => `${KEY_PREFIX}:${p}:probe`;
const quarantineKey = (p: string) => `${KEY_PREFIX}:${p}:quarantine`;

// ── Error classification (shared with the retry policy) ──────────────────────

/**
 * Non-retryable, provider-level faults: retrying or backing off cannot help, so
 * the cascade must fail over IMMEDIATELY and the provider must be quarantined.
 */
export function isHardProviderFault(message: string): boolean {
  return /insufficient credits|\b402\b|use case details have not been submitted|not a valid model id|invalid.?api.?key|incorrect api key|no api key|api key not valid|API_KEY_INVALID|\b401\b|\b403\b|on-demand throughput isn’t supported|on-demand throughput isn't supported|access denied|unauthoriz/i.test(
    message,
  );
}

// ── Gate reads ───────────────────────────────────────────────────────────────

/**
 * Load gate state for every provider in the cascade in ONE Redis pipeline.
 *
 * Batched deliberately: the previous per-attempt map lookup was free, and we
 * must not replace it with one network round trip per rung per request.
 */
export async function loadProviderGates(providers: string[]): Promise<Map<string, ProviderGate>> {
  const unique = [...new Set(providers.filter(Boolean))];
  const out = new Map<string, ProviderGate>();
  const now = Date.now();

  for (const p of unique) {
    if (UNGATEABLE.has(p)) {
      out.set(p, { provider: p, state: 'closed', allowed: true });
      continue;
    }
    const e = localEntry(p);
    if (e.quarantinedUntil > now) {
      out.set(p, { provider: p, state: 'quarantined', allowed: false, reason: e.lastReason });
    } else if (e.openUntil > now) {
      out.set(p, {
        provider: p,
        state: 'open',
        allowed: false,
        reason: e.lastReason,
        failures: e.failures,
        openUntil: e.openUntil,
      });
    } else {
      out.set(p, { provider: p, state: 'closed', allowed: true, failures: e.failures });
    }
  }

  const gateable = unique.filter((p) => !UNGATEABLE.has(p));
  if (gateable.length === 0) return out;

  const redis = await getRedis();
  if (!redis) return out;

  try {
    const pipeline = redis.pipeline();
    for (const p of gateable) {
      pipeline.get(quarantineKey(p));
      pipeline.pttl(openKey(p));
      pipeline.get(failKey(p));
    }
    const results = await pipeline.exec();
    if (!results) return out;

    gateable.forEach((p, i) => {
      const quarantineRaw = results[i * 3]?.[1] as string | null;
      const openTtl = Number(results[i * 3 + 1]?.[1] ?? -2);
      const failures = Number(results[i * 3 + 2]?.[1] ?? 0) || 0;
      const e = localEntry(p);

      if (quarantineRaw) {
        e.quarantinedUntil = now + QUARANTINE_MS;
        e.lastReason = String(quarantineRaw).slice(0, 160);
        out.set(p, { provider: p, state: 'quarantined', allowed: false, reason: e.lastReason });
        return;
      }
      if (openTtl > 0) {
        e.openUntil = now + openTtl;
        out.set(p, {
          provider: p,
          state: 'open',
          allowed: false,
          reason: 'breaker open (shared)',
          failures,
          openUntil: e.openUntil,
        });
        return;
      }
      // Redis says the provider is usable; clear a stale local open so a pod
      // that tripped locally recovers as soon as the cluster does.
      e.openUntil = 0;
      e.quarantinedUntil = 0;
      out.set(p, { provider: p, state: 'closed', allowed: true, failures });
    });
  } catch (err: any) {
    logger.warn('./jrx-provider-breaker: gate read failed — using per-pod state', {
      err: String(err?.message || err).slice(0, 120),
    });
  }

  return out;
}

/**
 * Try to claim the single cluster-wide half-open probe for an OPEN provider.
 *
 * Returns true when THIS request is the designated probe. Without this, every
 * pod would retry the recovering provider simultaneously the instant the
 * cooldown lapsed — the classic thundering-herd that keeps a struggling
 * provider down.
 */
export async function tryHalfOpenProbe(provider: string): Promise<boolean> {
  if (UNGATEABLE.has(provider)) return true;
  const e = localEntry(provider);
  const now = Date.now();
  // A hard quarantine is a configuration/billing fault: probing cannot fix it.
  if (e.quarantinedUntil > now) return false;

  const redis = await getRedis();
  if (!redis) {
    if (now - e.lastProbeAt < PROBE_INTERVAL_MS) return false;
    e.lastProbeAt = now;
    return true;
  }
  try {
    const claimed = await redis.set(
      probeKey(provider),
      String(now),
      'PX',
      PROBE_INTERVAL_MS,
      'NX',
    );
    if (claimed === 'OK') {
      e.lastProbeAt = now;
      return true;
    }
    return false;
  } catch {
    if (now - e.lastProbeAt < PROBE_INTERVAL_MS) return false;
    e.lastProbeAt = now;
    return true;
  }
}

// ── Outcome recording ────────────────────────────────────────────────────────

/** A success closes the circuit immediately — that is the half-open contract. */
export function recordProviderSuccess(provider: string): void {
  if (UNGATEABLE.has(provider)) return;
  const e = localEntry(provider);
  e.successes += 1;
  e.failures = 0;
  e.openUntil = 0;
  void (async () => {
    const redis = await getRedis();
    if (!redis) return;
    try {
      await redis.pipeline().del(failKey(provider)).del(openKey(provider)).exec();
    } catch { /* breaker state is advisory; never fail a served request on it */ }
  })();
}

/**
 * Record a provider failure and open the circuit / quarantine as warranted.
 *
 * `retryable === false` (4xx, auth, content filter) hard-quarantines: those are
 * deterministic and re-attempting them is pure latency and spend.
 */
export function recordProviderFailure(
  provider: string,
  opts: { message: string; retryable: boolean },
): void {
  if (UNGATEABLE.has(provider)) return;
  const e = localEntry(provider);
  const now = Date.now();
  const reason = String(opts.message || '').slice(0, 160);
  e.lastReason = reason;

  const hard = !opts.retryable && isHardProviderFault(opts.message);
  if (hard) {
    e.quarantinedUntil = now + QUARANTINE_MS;
    e.openUntil = now + QUARANTINE_MS;
    logger.warn('./jrx-provider-breaker: provider quarantined (shared)', {
      provider,
      reason,
      ttlMs: QUARANTINE_MS,
    });
  } else {
    e.failures += 1;
    if (e.failures >= FAILURE_THRESHOLD) {
      e.openUntil = now + OPEN_MS;
      logger.warn('./jrx-provider-breaker: breaker OPEN', {
        provider,
        failures: e.failures,
        openMs: OPEN_MS,
      });
    }
  }

  void (async () => {
    const redis = await getRedis();
    if (!redis) return;
    try {
      if (hard) {
        await redis
          .pipeline()
          .set(quarantineKey(provider), reason, 'PX', QUARANTINE_MS)
          .set(openKey(provider), String(now), 'PX', QUARANTINE_MS)
          .exec();
        return;
      }
      const pipeline = redis.pipeline();
      pipeline.incr(failKey(provider));
      pipeline.pexpire(failKey(provider), WINDOW_MS);
      const res = await pipeline.exec();
      const failures = Number(res?.[0]?.[1] ?? 0) || 0;
      if (failures >= FAILURE_THRESHOLD) {
        await redis.set(openKey(provider), String(now), 'PX', OPEN_MS);
      }
    } catch { /* advisory state only */ }
  })();
}

/**
 * Explicit hard quarantine for callers that already classified the fault.
 * Kept so the orchestrator has one entry point rather than reproducing the
 * classification logic at the call site (NV-NO-DUPLICATE-001).
 */
export function quarantineProviderShared(provider: string, reason: string): void {
  recordProviderFailure(provider, { message: reason, retryable: false });
}

/** Ops/health snapshot — provider names and states only, never secrets. */
export function getProviderBreakerSnapshot(): Array<{
  provider: string;
  state: BreakerState;
  failures: number;
  successes: number;
  openForMs: number;
  reason?: string;
}> {
  const now = Date.now();
  return [...local.entries()]
    .map(([provider, e]) => ({
      provider,
      state: (e.quarantinedUntil > now
        ? 'quarantined'
        : e.openUntil > now
          ? 'open'
          : 'closed') as BreakerState,
      failures: e.failures,
      successes: e.successes,
      openForMs: Math.max(0, e.openUntil - now),
      reason: e.lastReason,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function isSharedBreakerActive(): boolean {
  return redisClient !== null && !redisDisabled;
}

/** Tests only — drop local state and any Redis handle. */
export async function __resetProviderBreaker(): Promise<void> {
  local.clear();
  if (redisClient) {
    try { redisClient.disconnect(); } catch { /* ignore */ }
  }
  redisClient = null;
  redisDisabled = false;
  redisInitPromise = null;
}
