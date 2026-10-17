/**
 * JRX LLM Circuit Breaker — opossum-based circuit breaker for all LLM API calls
 * Fixes Audit Finding AI003: No circuit breaker on OpenRouter/external LLM calls
 * Pattern: Circuit opens at 50% failure rate → fast-fail for 60s → probe → close
 * @file src/utils/jrx-circuit-breaker.ts
 */
// JRX-PREFLIGHT-FIX-001 (2026-04-30): @types/opossum is now installed (transitively via
// our dependencies), so the @ts-expect-error suppression became an unused-directive TS2578.
// Removed it. The CircuitBreaker generic is still loose because opossum's typings don't
// thread through Parameters<T>/ReturnType<T> precisely, so we cast at the boundary below.
import CircuitBreaker from 'opossum';
import { createLogger } from './logger.js';

const logger = createLogger('./jrx-circuit-breaker');

// ── Shared metrics counters ───────────────────────────────────────────────────
const metrics = {
  opens: 0,
  closes: 0,
  halfOpens: 0,
  fallbacks: 0,
  successes: 0,
  failures: 0,
  timeouts: 0,
};

// ── Factory: creates a circuit breaker for any async function ─────────────────
export function createLlmCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    name?: string;
    timeoutMs?: number;
    errorThresholdPct?: number;
    resetTimeoutMs?: number;
    volumeThreshold?: number;
    fallback?: (...args: Parameters<T>) => ReturnType<T> | Promise<ReturnType<T>>;
  } = {}
): CircuitBreaker<Parameters<T>, Awaited<ReturnType<T>>> {
  const name = options.name ?? fn.name ?? 'unknown-llm';

  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeoutMs ?? 30_000,
    errorThresholdPercentage: options.errorThresholdPct ?? 50,
    resetTimeout: options.resetTimeoutMs ?? 60_000,
    volumeThreshold: options.volumeThreshold ?? 10,
    name,
  });

  breaker.on('open', () => {
    metrics.opens++;
    logger.error(`[CircuitBreaker:${name}] OPEN — failing fast`, { name, metrics });
  });

  breaker.on('close', () => {
    metrics.closes++;
    logger.info(`[CircuitBreaker:${name}] CLOSED — resuming normal operation`, { name });
  });

  breaker.on('halfOpen', () => {
    metrics.halfOpens++;
    logger.info(`[CircuitBreaker:${name}] HALF-OPEN — probing`, { name });
  });

  breaker.on('fallback', () => {
    metrics.fallbacks++;
    logger.warn(`[CircuitBreaker:${name}] Fallback triggered`, { name });
  });

  breaker.on('success', () => {
    metrics.successes++;
  });

  breaker.on('failure', (err: unknown) => {
    metrics.failures++;
    logger.warn(`[CircuitBreaker:${name}] Failure recorded`, { name, err: String(err) });
  });

  breaker.on('timeout', () => {
    metrics.timeouts++;
    logger.warn(`[CircuitBreaker:${name}] Timeout`, { name });
  });

  if (options.fallback) {
    breaker.fallback(options.fallback as any);
  } else {
    breaker.fallback(() => {
      throw new Error(
        `[CircuitBreaker:${name}] Circuit is OPEN — LLM service temporarily unavailable. ` +
        'The system has detected elevated error rates. Please retry in 60 seconds.'
      );
    });
  }

  // JRX-PREFLIGHT-FIX-001: opossum's `new CircuitBreaker(fn, opts)` returns
  // `CircuitBreaker<unknown[], unknown>` because the constructor doesn't preserve the
  // wrapped function's parameter/return types. We assert to the precise generic that
  // matches the wrapped fn so downstream callers get correct types.
  return breaker as unknown as CircuitBreaker<Parameters<T>, Awaited<ReturnType<T>>>;
}

// ── Singleton circuit breaker for the global OpenRouter LLM call ───────────────
let _globalLlmBreaker: CircuitBreaker | null = null;

export function getGlobalLlmCircuitBreaker(): CircuitBreaker {
  if (!_globalLlmBreaker) {
    _globalLlmBreaker = createLlmCircuitBreaker(
      async (callFn: () => Promise<unknown>) => callFn(),
      {
        name: 'openrouter-global',
        timeoutMs: 30_000,
        errorThresholdPct: 50,
        resetTimeoutMs: 60_000,
        volumeThreshold: 10,
      }
    );
  }
  return _globalLlmBreaker;
}

/**
 * Wraps any LLM call with the global circuit breaker.
 * Usage:
 *   const result = await withLlmCircuitBreaker(() => openRouterCall(params));
 */
export async function withLlmCircuitBreaker<T>(
  callFn: () => Promise<T>
): Promise<T> {
  const breaker = getGlobalLlmCircuitBreaker();
  return breaker.fire(callFn) as Promise<T>;
}

/** Returns current circuit breaker metrics for health endpoint */
export function getCircuitBreakerMetrics() {
  return {
    ...metrics,
    state: _globalLlmBreaker?.opened
      ? 'OPEN'
      : _globalLlmBreaker?.halfOpen
      ? 'HALF_OPEN'
      : 'CLOSED',
  };
}
