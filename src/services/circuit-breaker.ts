/**
 * Shared Circuit-Breaker Policy Module — Task #32 round 4
 * JRX-CB-POLICY-001
 *
 * Wraps `opossum` with a configured, named policy registry so that all
 * outbound capability/service invocations can opt into uniform timeout,
 * error-threshold, and reset behavior. Exposes:
 *
 *   getBreakerPolicy(name)                // returns shared CircuitBreaker.Options
 *   wrapWithBreaker(name, asyncFn, opts?) // returns a CircuitBreaker around fn
 *   runWithBreaker(name, asyncFn, opts?)  // .fire() the breaker once
 *   getBreakerStats(name)                 // for observability / tests
 *
 * Policies are keyed by logical surface (`outbound:capability`,
 * `outbound:llm`, `outbound:db`, `outbound:http`, `outbound:integration`).
 * Each surface has timeoutMs / errorThresholdPercentage / resetTimeoutMs /
 * volumeThreshold / rollingCountWindowMs that match production SLOs.
 */

import CircuitBreaker from 'opossum';

export type BreakerSurface =
  | 'outbound:capability'
  | 'outbound:llm'
  | 'outbound:db'
  | 'outbound:http'
  | 'outbound:integration'
  // JRX-OPS-BREAKER-EXTRA-001 (Task #28 round 3): named surfaces for the
  // queue and RAG retrieval paths so they can be wrapped explicitly via
  // runWithRetryAndBreaker(...). Documented in docs/v3.1.2/completed_docs/JRX-OBSERVABILITY.md.
  | 'outbound:queue'
  | 'outbound:rag';

export interface BreakerPolicy {
  timeoutMs: number;
  errorThresholdPercentage: number;
  resetTimeoutMs: number;
  volumeThreshold: number;
  rollingCountWindowMs: number;
}

// JRX-OPS-BREAKER-ENV-TUNE-001 (Task #28 round 10): each surface's
// timeoutMs / errorThresholdPercentage / resetTimeoutMs / volumeThreshold
// / rollingCountWindowMs is now overridable via env so SREs can tune
// per-deployment without a code change. Convention:
//
//   JRX_BREAKER_<SURFACE>_TIMEOUT_MS              (timeoutMs)
//   JRX_BREAKER_<SURFACE>_ERROR_PCT               (errorThresholdPercentage)
//   JRX_BREAKER_<SURFACE>_RESET_MS                (resetTimeoutMs)
//   JRX_BREAKER_<SURFACE>_VOLUME                  (volumeThreshold)
//   JRX_BREAKER_<SURFACE>_WINDOW_MS               (rollingCountWindowMs)
//
// where <SURFACE> is the upper-snake-case form of the surface tail
// (e.g. outbound:llm → JRX_BREAKER_LLM_*). Anything not set falls
// back to the in-code default below. The LLM defaults align with
// the Task #28 target failover example (~5 failures within a 30s
// window, open for 60s) — relax via env in dev.
const DEFAULT_POLICIES: Record<BreakerSurface, BreakerPolicy> = {
  'outbound:capability':  envPolicy('CAPABILITY',  { timeoutMs: 30_000, errorThresholdPercentage: 50, resetTimeoutMs: 30_000, volumeThreshold: 10, rollingCountWindowMs: 30_000 }),
  // NV-NSP-FIX-003 (2026-04-27): default LLM timeout raised 60s → 120s. NSP
  // integration tests showed Anthropic Claude Sonnet 4.6 chain-of-thought
  // requests landing at ~41s on a single shot; ensemble + fallback paths for
  // legal_research / doc_draft / risk_assessment routinely cross the old 60s
  // budget and surfaced as `408 NV SDK timeout after 60000ms` to NSP.
  // Operators can still tune via `JRX_BREAKER_LLM_TIMEOUT_MS` env override.
  'outbound:llm':         envPolicy('LLM',         { timeoutMs: 120_000, errorThresholdPercentage: 60, resetTimeoutMs: 60_000, volumeThreshold: 5,  rollingCountWindowMs: 30_000 }),
  'outbound:db':          envPolicy('DB',          { timeoutMs:  5_000, errorThresholdPercentage: 40, resetTimeoutMs: 15_000, volumeThreshold: 20, rollingCountWindowMs: 30_000 }),
  'outbound:http':        envPolicy('HTTP',        { timeoutMs: 10_000, errorThresholdPercentage: 50, resetTimeoutMs: 30_000, volumeThreshold: 10, rollingCountWindowMs: 30_000 }),
  'outbound:integration': envPolicy('INTEGRATION', { timeoutMs: 20_000, errorThresholdPercentage: 50, resetTimeoutMs: 60_000, volumeThreshold: 5,  rollingCountWindowMs: 60_000 }),
  'outbound:queue':       envPolicy('QUEUE',       { timeoutMs: 10_000, errorThresholdPercentage: 50, resetTimeoutMs: 30_000, volumeThreshold: 5,  rollingCountWindowMs: 30_000 }),
  'outbound:rag':         envPolicy('RAG',         { timeoutMs: 30_000, errorThresholdPercentage: 60, resetTimeoutMs: 30_000, volumeThreshold: 5,  rollingCountWindowMs: 60_000 }),
};

/**
 * Read JRX_BREAKER_<SURFACE>_* overrides on top of the in-code defaults.
 * Invalid (non-numeric / out-of-range) overrides silently fall back to
 * the default — this is operational config, not runtime input.
 */
function envPolicy(tag: string, defaults: BreakerPolicy): BreakerPolicy {
  const num = (key: string, def: number, lo = 0, hi = Number.MAX_SAFE_INTEGER) => {
    const raw = process.env[`JRX_BREAKER_${tag}_${key}`];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
  };
  return {
    timeoutMs:                num('TIMEOUT_MS', defaults.timeoutMs,                  1),
    errorThresholdPercentage: num('ERROR_PCT',  defaults.errorThresholdPercentage,   1, 100),
    resetTimeoutMs:           num('RESET_MS',   defaults.resetTimeoutMs,             1),
    volumeThreshold:          num('VOLUME',     defaults.volumeThreshold,            1),
    rollingCountWindowMs:     num('WINDOW_MS',  defaults.rollingCountWindowMs,       1),
  };
}

const breakerRegistry = new Map<string, CircuitBreaker<any[], any>>();

export function getBreakerPolicy(surface: BreakerSurface): BreakerPolicy {
  return DEFAULT_POLICIES[surface];
}

function policyToOpossumOptions(p: BreakerPolicy) {
  return {
    timeout: p.timeoutMs,
    errorThresholdPercentage: p.errorThresholdPercentage,
    resetTimeout: p.resetTimeoutMs,
    volumeThreshold: p.volumeThreshold,
    rollingCountTimeout: p.rollingCountWindowMs,
  };
}

/**
 * Returns a shared CircuitBreaker wrapping the given async function for the
 * named surface. Re-uses the same breaker instance for the same `name` so
 * stats (open/half-open/closed) accumulate across calls.
 */
export function wrapWithBreaker<TArgs extends any[], TRet>(
  name: string,
  fn: (...args: TArgs) => Promise<TRet>,
  surface: BreakerSurface = 'outbound:capability',
): CircuitBreaker<TArgs, TRet> {
  const cached = breakerRegistry.get(name) as CircuitBreaker<TArgs, TRet> | undefined;
  if (cached) return cached;
  const policy = DEFAULT_POLICIES[surface];
  const breaker = new CircuitBreaker<TArgs, TRet>(fn, policyToOpossumOptions(policy));
  breakerRegistry.set(name, breaker as CircuitBreaker<any[], any>);
  return breaker;
}

/**
 * Convenience: fire a one-shot call through the named breaker.
 * For per-call functions, use `wrapWithBreaker` with a stable name first.
 */
export async function runWithBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  surface: BreakerSurface = 'outbound:capability',
): Promise<T> {
  const breaker = wrapWithBreaker(name, fn, surface);
  return breaker.fire() as Promise<T>;
}

export interface RetryOptions {
  /** Maximum total attempts including the first call. Default 3. */
  maxAttempts?: number;
  /** Base delay before first retry, ms. Default 100. */
  baseDelayMs?: number;
  /** Cap on per-attempt delay, ms. Default 2000. */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether an error is transient and worth retrying.
   * Defaults to retrying on opossum 'timeout', breaker open ('Breaker is
   * open'), and ECONN* / 5xx-ish messages. NEVER retries on validation /
   * permission / unknown-capability errors (those throw "structured-input
   * failure" or "[CapabilityManifest] ..." and are caller bugs, not
   * transient infra failures).
   */
  isRetryable?: (e: unknown) => boolean;
}

/**
 * NV-COMPLETION-DRIVEN-001 — timeout is not retryable.
 *
 * LLM classifyLlmError already excludes `timeout` from RETRYABLE. Capability
 * DEFAULT_RETRY used to match `/timed?[- ]?out/` as retryable, converting one
 * 30s hang into 90s (measured Queen leaf). A call that exhausted its budget
 * will exhaust it again; retrying it holds the leaf after the useful result
 * from a sibling is already in.
 */
export function isCapabilityErrorRetryable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (!msg) return false;
  if (/structured-input failure/i.test(msg)) return false;
  if (/\[CapabilityManifest\]/i.test(msg)) return false;
  if (/not exposed to tier|not enabled in jurisdiction|unknown capability/i.test(msg)) return false;
  if (/aborted|aborterror|the operation was aborted/i.test(msg)) return false;
  if (/timed?[- ]?out|TimeoutError|ETIMEDOUT/i.test(msg)) return false;
  if (/Breaker is open/i.test(msg)) return false;
  if (/ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up/i.test(msg)) return true;
  if (/\b(502|503|504)\b/.test(msg)) return true;
  return false;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
  isRetryable: isCapabilityErrorRetryable,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * JRX-CB-RETRY-001 (round 10d): bounded exponential backoff layered on
 * top of a shared, name-cached breaker. The breaker is created with a
 * generic `(args: unknown[]) => Promise<unknown>` adapter so per-call
 * arguments flow through `.fire(...args)` — never captured by the
 * closure cached in the breaker registry. Retries fire only on
 * transient infra errors.
 */
const RETRY_BREAKER_PREFIX = 'retry::';

function getOrCreateRetryBreaker(
  name: string,
  surface: BreakerSurface,
): CircuitBreaker<unknown[], unknown> {
  const key = RETRY_BREAKER_PREFIX + name;
  const cached = breakerRegistry.get(key) as CircuitBreaker<unknown[], unknown> | undefined;
  if (cached) return cached;
  // The wrapped function expects [fn, ...args] — but we model it as a
  // single thunk passed in via fire() so per-call closures work
  // correctly. The thunk pattern is the canonical opossum-with-shared-
  // registry escape hatch.
  const adapter = async (...args: unknown[]) => {
    const thunk = args[0] as () => Promise<unknown>;
    return thunk();
  };
  const policy = DEFAULT_POLICIES[surface];
  const breaker = new CircuitBreaker<unknown[], unknown>(adapter, policyToOpossumOptions(policy));
  breakerRegistry.set(key, breaker as CircuitBreaker<any[], any>);
  return breaker;
}

export async function runWithRetryAndBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  surface: BreakerSurface = 'outbound:capability',
  retry: RetryOptions = {},
): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_RETRY, ...retry };
  const breaker = getOrCreateRetryBreaker(name, surface);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return (await breaker.fire(fn)) as T;
    } catch (e: unknown) {
      lastErr = e;
      const transient = opts.isRetryable(e);
      if (!transient || attempt >= opts.maxAttempts) {
        throw e;
      }
      const delay = Math.min(
        opts.maxDelayMs,
        opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * opts.baseDelayMs),
      );
      await sleep(delay);
    }
  }
  // Unreachable, but keeps TS exhaustive.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Test/observability helper — returns stats for a retry-breaker by its
 * canonical name (without the internal `retry::` prefix).
 */
export function getRetryBreakerStats(name: string): ReturnType<typeof getBreakerStats> {
  return getBreakerStats(RETRY_BREAKER_PREFIX + name);
}

export function getBreakerStats(name: string): {
  state: 'open' | 'half-open' | 'closed' | 'unknown';
  fires: number; failures: number; successes: number; rejects: number; timeouts: number;
} | null {
  const b = breakerRegistry.get(name);
  if (!b) return null;
  const s = (b as any).stats ?? {};
  let state: 'open' | 'half-open' | 'closed' | 'unknown' = 'unknown';
  if ((b as any).opened) state = 'open';
  else if ((b as any).halfOpen) state = 'half-open';
  else if ((b as any).closed) state = 'closed';
  return {
    state,
    fires:     s.fires ?? 0,
    failures:  s.failures ?? 0,
    successes: s.successes ?? 0,
    rejects:   s.rejects ?? 0,
    timeouts:  s.timeouts ?? 0,
  };
}

export function listBreakers(): string[] {
  return Array.from(breakerRegistry.keys());
}

/** Test helper — clears breaker registry between suites. */
export function _resetBreakerRegistry(): void {
  for (const b of breakerRegistry.values()) {
    try { b.shutdown(); } catch { /* opossum may not have shutdown in older versions */ }
  }
  breakerRegistry.clear();
}

export { CircuitBreaker };
export default CircuitBreaker;

/**
 * Compatibility shim — `circuitBreakerManager` is the legacy named export
 * that `services/llm-providers/unified-llm-adapter.ts:15` (and any future
 * provider helper) imports. The canonical primitive in this module is
 * `runWithBreaker(name, fn)`; the shim simply forwards `.execute(name, fn)`
 * to it. Added 2026-05-10 (Session-11) when the wire-chain pulled the
 * provider classes (and therefore the adapter) into the runtime graph for
 * the first time and surfaced the long-dormant missing-export error.
 */
export const circuitBreakerManager = {
  execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return runWithBreaker(name, fn);
  },
  list(): string[] {
    return listBreakers();
  },
  stats(name: string) {
    return getBreakerStats(name);
  },
};
