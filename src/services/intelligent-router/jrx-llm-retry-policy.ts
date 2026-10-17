/**
 * NV-LLM-RETRY-001 — retry classification + jittered backoff for the cascade.
 *
 * Measured defect (plan §9): the cascade had NO backoff anywhere. On a provider
 * rate-limit (429) or a transient 5xx it advanced instantly to the next rung and
 * frequently hit the same shared upstream (several catalog rungs resolve to
 * OpenRouter), so a 429 burst walked the entire ladder in a few hundred
 * milliseconds and ended at AgentZero.
 *
 * The other half of the defect is that a blind retry is *worse* than none for
 * deterministic failures: a 401, a 402, a content-filter refusal or an
 * unresolvable model id will fail identically 900 ms later, so waiting only
 * burns the caller's deadline. Classification therefore drives everything —
 * retryable classes back off, non-retryable classes fail over immediately.
 */

export type LlmErrorClass =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'empty_response'
  | 'auth'
  | 'payment'
  | 'bad_request'
  | 'content_filter'
  | 'model_not_found'
  | 'cancelled'
  | 'unknown';

export interface RetryDecision {
  errorClass: LlmErrorClass;
  /** True → the same rung may be retried after `delayMs`. */
  retryable: boolean;
  delayMs: number;
  /** True → also gate the provider (hard fault, not a blip). */
  hardFault: boolean;
}

/**
 * Base backoff schedule in ms (plan §9: "roughly 100/300/900"). Jitter is
 * applied on top; the schedule is intentionally short because the cascade has
 * other rungs to try and a request-scoped deadline to respect.
 */
const BASE_DELAYS_MS = [100, 300, 900] as const;

export const MAX_RETRIES_PER_RUNG = BASE_DELAYS_MS.length;

function envFlagOff(name: string): boolean {
  return ['0', 'false', 'off', 'no'].includes(String(process.env[name] ?? '').trim().toLowerCase());
}

export function isRetryEnabled(): boolean {
  return !envFlagOff('NYV_LLM_RETRY');
}

/**
 * Full jitter (`random(0, base)`) rather than equal jitter: with several pods
 * retrying the same rate-limited provider, full jitter is what actually breaks
 * up the synchronised retry wave.
 */
export function backoffDelayMs(attemptIndex: number): number {
  const base = BASE_DELAYS_MS[Math.min(attemptIndex, BASE_DELAYS_MS.length - 1)]!;
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

export function classifyLlmError(err: unknown): LlmErrorClass {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  const m = raw.toLowerCase();

  if (/abort|cancel|hedge secondary not needed/.test(m)) {
    // Timeouts surface as AbortError too; a deadline overrun is a timeout, and
    // a deliberate cancellation must never be retried.
    if (/timeouterror|timed? ?out|timeout/.test(m)) return 'timeout';
    return 'cancelled';
  }
  if (/\b429\b|rate.?limit|too many requests|quota|resource.?exhausted|overloaded|capacity/.test(m)) {
    return 'rate_limit';
  }
  if (/\b(500|502|503|504)\b|internal server error|bad gateway|service unavailable|gateway timeout|server_error/.test(m)) {
    return 'server_error';
  }
  if (/timed? ?out|timeout|etimedout|deadline exceeded/.test(m)) return 'timeout';
  if (/econnreset|econnrefused|enotfound|eai_again|socket hang up|network|fetch failed|premature close/.test(m)) {
    return 'network';
  }
  if (/insufficient credits|\b402\b|payment|billing/.test(m)) return 'payment';
  if (/\b401\b|\b403\b|invalid.?api.?key|incorrect api key|api key not valid|api_key_invalid|unauthoriz|access denied|permission.?denied|use case details have not been submitted/.test(m)) {
    return 'auth';
  }
  if (/content.?filter|safety|blocked by|prohibited|recitation/.test(m)) return 'content_filter';
  if (/not a valid model id|model.?not.?found|does not exist|unsupported model|on-demand throughput/.test(m)) {
    return 'model_not_found';
  }
  if (/returned empty content|empty stream|no text content|non-json content/.test(m)) {
    return 'empty_response';
  }
  if (/\b400\b|\b404\b|\b422\b|invalid request|validation/.test(m)) return 'bad_request';
  return 'unknown';
}

/**
 * Which classes deserve a second chance on the SAME rung.
 *
 * `empty_response` and `unknown` are deliberately excluded: an empty body is
 * usually the model burning its budget on hidden reasoning (Sarvam-M does this),
 * which repeats deterministically, so failing over to a different model is both
 * faster and more likely to succeed than waiting.
 */
const RETRYABLE: ReadonlySet<LlmErrorClass> = new Set<LlmErrorClass>([
  'rate_limit',
  'server_error',
  'network',
]);

/** Classes that mean "this provider is unusable for a while", not "try again". */
const HARD_FAULT: ReadonlySet<LlmErrorClass> = new Set<LlmErrorClass>([
  'auth',
  'payment',
  'model_not_found',
]);

/**
 * @param attemptIndex 0-based retry index for this rung.
 * @param remainingMs  request deadline remaining; a backoff that would not leave
 *                     room for the retry itself is pointless, so we fail over.
 */
export function classifyAndDecide(
  err: unknown,
  attemptIndex: number,
  remainingMs?: number,
): RetryDecision {
  const errorClass = classifyLlmError(err);
  const hardFault = HARD_FAULT.has(errorClass);

  if (!isRetryEnabled() || !RETRYABLE.has(errorClass) || attemptIndex >= MAX_RETRIES_PER_RUNG) {
    return { errorClass, retryable: false, delayMs: 0, hardFault };
  }

  const delayMs = backoffDelayMs(attemptIndex);
  // Guard band: the retry needs the backoff plus enough time to actually run.
  if (remainingMs != null && remainingMs < delayMs + 2_000) {
    return { errorClass, retryable: false, delayMs: 0, hardFault };
  }
  return { errorClass, retryable: true, delayMs, hardFault };
}

/** Cancellable sleep so a backoff never outlives the request that scheduled it. */
export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
