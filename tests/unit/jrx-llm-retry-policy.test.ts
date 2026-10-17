/**
 * NV-LLM-RETRY-001 — retry classification + jittered backoff.
 *
 * Guards the two halves of the defect this policy fixed:
 *  - retryable classes (429 / 5xx / network blips) must back off, and
 *  - non-retryable classes (auth, 402, content filter, bad model id) must fail
 *    over IMMEDIATELY, because waiting 900 ms for a deterministic failure only
 *    burns the caller's deadline.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_RETRIES_PER_RUNG,
  backoffDelayMs,
  classifyAndDecide,
  classifyLlmError,
  sleepWithSignal,
} from '../../src/services/intelligent-router/jrx-llm-retry-policy.js';

describe('./jrx-llm-retry-policy: classification', () => {
  it('classifies retryable transport/capacity failures', () => {
    expect(classifyLlmError(new Error('429 Too Many Requests'))).toBe('rate_limit');
    expect(classifyLlmError(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe('rate_limit');
    expect(classifyLlmError(new Error('model is overloaded'))).toBe('rate_limit');
    expect(classifyLlmError(new Error('503 Service Unavailable'))).toBe('server_error');
    expect(classifyLlmError(new Error('502 Bad Gateway'))).toBe('server_error');
    expect(classifyLlmError(new Error('ECONNRESET'))).toBe('network');
    expect(classifyLlmError(new Error('fetch failed'))).toBe('network');
  });

  it('classifies deterministic provider faults that must never be retried', () => {
    expect(classifyLlmError(new Error('402 insufficient credits'))).toBe('payment');
    expect(classifyLlmError(new Error('401 invalid api key'))).toBe('auth');
    expect(classifyLlmError(new Error('403 access denied'))).toBe('auth');
    expect(classifyLlmError(new Error('blocked by content filter'))).toBe('content_filter');
    expect(classifyLlmError(new Error('is not a valid model id'))).toBe('model_not_found');
    expect(classifyLlmError(new Error('400 invalid request'))).toBe('bad_request');
  });

  it('separates a deliberate cancellation from a deadline overrun', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(classifyLlmError(abort)).toBe('cancelled');

    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(classifyLlmError(timeout)).toBe('timeout');
  });
});

describe('./jrx-llm-retry-policy: decisions', () => {
  it('backs off only on retryable classes', () => {
    const rateLimited = classifyAndDecide(new Error('429 rate limit'), 0, 60_000);
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.delayMs).toBeGreaterThan(0);

    for (const message of [
      '401 invalid api key',
      '402 insufficient credits',
      'blocked by content filter',
      '400 invalid request',
    ]) {
      const decision = classifyAndDecide(new Error(message), 0, 60_000);
      expect(decision.retryable, message).toBe(false);
      expect(decision.delayMs, message).toBe(0);
    }
  });

  it('flags auth/payment/bad-model as hard faults so the provider is gated', () => {
    expect(classifyAndDecide(new Error('402 insufficient credits'), 0).hardFault).toBe(true);
    expect(classifyAndDecide(new Error('401 invalid api key'), 0).hardFault).toBe(true);
    expect(classifyAndDecide(new Error('is not a valid model id'), 0).hardFault).toBe(true);
    // A 5xx is a blip, not a configuration fault — it must not quarantine.
    expect(classifyAndDecide(new Error('503 Service Unavailable'), 0).hardFault).toBe(false);
  });

  it('stops retrying the same rung after the schedule is exhausted', () => {
    expect(classifyAndDecide(new Error('429'), MAX_RETRIES_PER_RUNG - 1, 60_000).retryable).toBe(true);
    expect(classifyAndDecide(new Error('429'), MAX_RETRIES_PER_RUNG, 60_000).retryable).toBe(false);
  });

  it('refuses to back off when the request deadline cannot absorb the wait', () => {
    // 150 ms left cannot fit a backoff plus a real call, so fail over now.
    expect(classifyAndDecide(new Error('429'), 0, 150).retryable).toBe(false);
    expect(classifyAndDecide(new Error('429'), 0, 60_000).retryable).toBe(true);
  });

  it('produces jittered, monotonically escalating delays in the 100/300/900 family', () => {
    const bounds = [
      { index: 0, min: 50, max: 100 },
      { index: 1, min: 150, max: 300 },
      { index: 2, min: 450, max: 900 },
    ];
    for (const { index, min, max } of bounds) {
      for (let i = 0; i < 50; i += 1) {
        const d = backoffDelayMs(index);
        expect(d).toBeGreaterThanOrEqual(min);
        expect(d).toBeLessThanOrEqual(max);
      }
    }
    // Jitter must actually vary, otherwise pods stay synchronised.
    const samples = new Set(Array.from({ length: 40 }, () => backoffDelayMs(2)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('./jrx-llm-retry-policy: cancellable backoff', () => {
  it('returns immediately when the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await sleepWithSignal(5_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('short-circuits an in-flight backoff when the caller aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = sleepWithSignal(5_000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
