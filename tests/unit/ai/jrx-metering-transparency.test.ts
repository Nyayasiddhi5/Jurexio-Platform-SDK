/**
 * NV-METER-WASTE-001 / NV-METER-ENVELOPE-001 — metering transparency regressions.
 *
 * These lock in the invariant that made the earlier savings numbers untrustworthy:
 * spend we DISCARD must be counted somewhere, but must never be billed; and the
 * response envelope must report the true number of billed completions rather than
 * the single call the caller happened to know about.
 *
 * Context: a swarm request on nysdev billed 5 completions while the envelope
 * reported 1, and the losing leg of the hedge — a full second paid call on every
 * hedged request — was recorded nowhere at all. Both were only discoverable by
 * grepping provider log lines on the host.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Response } from 'express';

import {
  nvRequestUsageContext,
  recordLlmUsage,
  getRequestUsage,
} from '../../../src/utils/jrx-request-usage-context.js';

/** Minimal Express `res` double — only `locals` is touched by the middleware. */
function fakeRes(): Response {
  return { locals: {} } as unknown as Response;
}

/**
 * Run `fn` inside a request usage context, as the middleware would, and return the
 * accumulator afterwards.
 */
function inRequest(fn: () => void): ReturnType<typeof getRequestUsage> {
  const res = fakeRes();
  let captured: ReturnType<typeof getRequestUsage>;
  nvRequestUsageContext({} as never, res, () => {
    fn();
    captured = getRequestUsage();
  });
  return captured!;
}

describe('request usage accumulator — waste is visible but never billed (NV-METER-WASTE-001)', () => {
  it('starts every counter at zero, including the waste counters', () => {
    const acc = inRequest(() => {});
    expect(acc).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      calls: 0,
      wastedPromptTokens: 0,
      wastedCompletionTokens: 0,
      wastedCostUsd: 0,
      wastedCalls: 0,
    });
  });

  it('keeps discarded spend out of the billable totals', () => {
    const acc = inRequest(() => {
      recordLlmUsage({ tokensIn: 1000, tokensOut: 500, costUsd: 0.01, model: 'winner', provider: 'google' });
      recordLlmUsage({ tokensIn: 900, tokensOut: 120, costUsd: 0.004, model: 'loser', provider: 'anthropic', wasted: true });
    });

    // Billable side: only the winner. A customer must never pay for a call we
    // chose to throw away.
    expect(acc!.promptTokens).toBe(1000);
    expect(acc!.completionTokens).toBe(500);
    expect(acc!.costUsd).toBeCloseTo(0.01, 10);
    expect(acc!.calls).toBe(1);

    // But the waste is not silent — that silence is what hid the hedge loser.
    expect(acc!.wastedPromptTokens).toBe(900);
    expect(acc!.wastedCompletionTokens).toBe(120);
    expect(acc!.wastedCostUsd).toBeCloseTo(0.004, 10);
    expect(acc!.wastedCalls).toBe(1);
  });

  it('never attributes the response to a discarded model', () => {
    // `model`/`provider` name the model that produced what the user received. A
    // cancelled hedge leg answering first must not relabel the response.
    const acc = inRequest(() => {
      recordLlmUsage({ tokensIn: 10, tokensOut: 5, costUsd: 0.001, model: 'loser', provider: 'openai', wasted: true });
      recordLlmUsage({ tokensIn: 10, tokensOut: 5, costUsd: 0.001, model: 'winner', provider: 'google' });
    });
    expect(acc!.model).toBe('winner');
    expect(acc!.provider).toBe('google');
  });

  it('sums fan-out across every call in the request', () => {
    // The Queen path is the reason this matters: 5 leaves + 1 synthesis is 6
    // billed completions behind a single HTTP response.
    const acc = inRequest(() => {
      for (let i = 0; i < 5; i++) {
        recordLlmUsage({ tokensIn: 2000, tokensOut: 800, costUsd: 0.002, model: `leaf-${i}`, provider: 'google' });
      }
      recordLlmUsage({ tokensIn: 6000, tokensOut: 4000, costUsd: 0.05, model: 'synthesis', provider: 'google' });
    });
    expect(acc!.calls).toBe(6);
    expect(acc!.promptTokens).toBe(5 * 2000 + 6000);
    expect(acc!.completionTokens).toBe(5 * 800 + 4000);
  });

  it('clamps negative and non-numeric provider values instead of corrupting the ledger', () => {
    const acc = inRequest(() => {
      recordLlmUsage({ tokensIn: -50, tokensOut: NaN, costUsd: -1, model: 'm', provider: 'p' });
      recordLlmUsage({ tokensIn: undefined, tokensOut: null, costUsd: undefined, wasted: true });
    });
    expect(acc!.promptTokens).toBe(0);
    expect(acc!.completionTokens).toBe(0);
    expect(acc!.costUsd).toBe(0);
    expect(acc!.wastedCostUsd).toBe(0);
    // The calls still happened, even if the provider reported nothing usable.
    expect(acc!.calls).toBe(1);
    expect(acc!.wastedCalls).toBe(1);
  });

  it('is a safe no-op outside a request (cron / worker contexts)', () => {
    expect(getRequestUsage()).toBeUndefined();
    expect(() => recordLlmUsage({ tokensIn: 1, tokensOut: 1, wasted: true })).not.toThrow();
  });
});

describe('response envelope reports true completions (NV-METER-ENVELOPE-001)', () => {
  const decision = {
    path: 'queen',
    reason: 'test',
    complexity: 'complex',
    risk: 'medium',
    detectedLanguage: 'en',
    docTask: null,
    primaryCapabilityIds: [],
  } as never;
  const qualityEnvelope = {} as never;

  /* Imported once, up front, so the builder can be called SYNCHRONOUSLY inside the
   * AsyncLocalStorage callback. An async callback would let a failed expect()
   * reject after the test had already passed. */
  let buildUnifiedOrchestrationContract: typeof import(
    '../../../src/orchestration/jrx-orchestration-response-contract.js'
  )['buildUnifiedOrchestrationContract'];

  beforeEach(async () => {
    ({ buildUnifiedOrchestrationContract } = await import(
      '../../../src/orchestration/jrx-orchestration-response-contract.js'
    ));
  });

  function build(tokens: { prompt?: number; completion?: number; total?: number }) {
    return buildUnifiedOrchestrationContract({
      content: 'An answer about BNSS section 482.',
      requestId: 'req-test',
      decision,
      qualityEnvelope,
      tokens,
      latencyMs: 1234,
      model: 'gemini-3.7-flash',
      provider: 'google',
    });
  }

  /** Run `fn` inside a request usage context, propagating assertion failures. */
  function inRequestSync(fn: () => void): void {
    let thrown: unknown;
    nvRequestUsageContext({} as never, fakeRes(), () => {
      try { fn(); } catch (e) { thrown = e; }
    });
    if (thrown) throw thrown;
  }

  it('prefers the accumulator over the caller figure, exposing fan-out', () => {
    inRequestSync(() => {
      // Five leaves the caller never sees, then the synthesis it does.
      for (let i = 0; i < 5; i++) {
        recordLlmUsage({ tokensIn: 1000, tokensOut: 400, costUsd: 0.001, model: 'leaf', provider: 'google' });
      }
      recordLlmUsage({ tokensIn: 3000, tokensOut: 2000, costUsd: 0.02, model: 'synth', provider: 'google' });

      // The Queen passes only what it tallied for the synthesis call.
      const out = build({ prompt: 3000, completion: 2000, total: 5000 });

      expect(out.cost.completions).toBe(6);
      expect(out.cost.tokens.prompt).toBe(5 * 1000 + 3000);
      expect(out.cost.tokens.completion).toBe(5 * 400 + 2000);
      // The old behaviour — and the reason our own plan understated cost.
      expect(out.cost.tokens.total).not.toBe(5000);
    });
  });

  it('falls back to the caller figure when nothing was recorded (cache hit)', () => {
    inRequestSync(() => {
      const out = build({ prompt: 120, completion: 80, total: 200 });
      // A cache hit legitimately makes zero provider calls, so the caller's
      // figure must survive rather than being zeroed out.
      expect(out.cost.completions).toBe(0);
      expect(out.cost.tokens.total).toBe(200);
    });
  });

  it('omits the waste block unless something was actually discarded', () => {
    inRequestSync(() => {
      recordLlmUsage({ tokensIn: 10, tokensOut: 10, costUsd: 0.001, model: 'm', provider: 'google' });
      const clean = build({ prompt: 10, completion: 10, total: 20 });
      expect(clean.cost.wasted).toBeUndefined();

      recordLlmUsage({ tokensIn: 900, tokensOut: 120, costUsd: 0.004, model: 'loser', provider: 'anthropic', wasted: true });
      const hedged = build({ prompt: 10, completion: 10, total: 20 });
      expect(hedged.cost.wasted).toEqual({
        completions: 1,
        promptTokens: 900,
        completionTokens: 120,
        costUsd: 0.004,
      });
      // Waste is reported but not charged: billable tokens exclude it.
      expect(hedged.cost.tokens.completion).toBe(10);
    });
  });

  it('works outside a request context without throwing', () => {
    const out = build({ prompt: 5, completion: 5, total: 10 });
    expect(out.cost.completions).toBeUndefined();
    expect(out.cost.tokens.total).toBe(10);
  });
});
