/**
 * NV-LLM-DEADLINE-001 — task-tiered per-attempt budgets + request-scoped deadline.
 *
 * Measured defect: every provider attempt used ONE flat budget (45s sync /
 * 120s stream) and nothing propagated "how much of the request's wall clock is
 * actually left", so a five-rung cascade could spend minutes on a request the
 * caller wanted in seconds.
 */
import { describe, it, expect } from 'vitest';
import {
  NV_TASK_TIER_TIMEOUTS,
  attemptBudgetMs,
  startRequestDeadline,
  timeRemainingMs,
} from '../../src/config/jrx-timeout-policy.js';

describe('./jrx-timeout-policy: task tiers', () => {
  it('orders the tiers micro < fast < standard < deep', () => {
    expect(NV_TASK_TIER_TIMEOUTS.micro).toBeLessThan(NV_TASK_TIER_TIMEOUTS.fast);
    expect(NV_TASK_TIER_TIMEOUTS.fast).toBeLessThan(NV_TASK_TIER_TIMEOUTS.standard);
    expect(NV_TASK_TIER_TIMEOUTS.standard).toBeLessThan(NV_TASK_TIER_TIMEOUTS.deep);
  });

  it('caps a micro attempt far below the old flat 45s provider budget', () => {
    expect(attemptBudgetMs('micro')).toBeLessThanOrEqual(20_000);
  });
});

describe('./jrx-timeout-policy: request deadline', () => {
  it('reports remaining time that decreases and never goes negative', async () => {
    const deadline = startRequestDeadline(1_500);
    const first = timeRemainingMs(deadline)!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1_500);

    await new Promise((r) => setTimeout(r, 60));
    const second = timeRemainingMs(deadline)!;
    expect(second).toBeLessThan(first);

    await new Promise((r) => setTimeout(r, 1_600));
    expect(timeRemainingMs(deadline)).toBe(0);
  });

  it('treats a missing deadline as unbounded so callers opt in', () => {
    expect(timeRemainingMs(undefined)).toBeUndefined();
    expect(attemptBudgetMs('standard', undefined)).toBe(NV_TASK_TIER_TIMEOUTS.standard);
  });

  it('clamps the attempt budget to whatever the request has left', () => {
    // Deep tier wants ~120s but only 8s of the request budget remains.
    expect(attemptBudgetMs('deep', 8_000)).toBe(8_000);
    // With plenty left, the tier cap governs.
    expect(attemptBudgetMs('micro', 600_000)).toBe(NV_TASK_TIER_TIMEOUTS.micro);
  });

  it('keeps a 3s floor so a nearly exhausted deadline fails fast instead of mid-generation', () => {
    // Opening a call certain to be cut mid-stream still gets billed, so the floor
    // is a clean fail rather than an unbounded shrink toward zero.
    expect(attemptBudgetMs('standard', 200)).toBe(3_000);
    expect(attemptBudgetMs('standard', 0)).toBe(3_000);
  });

  it('gives streaming attempts a longer floor than the sync tier cap', () => {
    expect(attemptBudgetMs('micro', 600_000, true)).toBeGreaterThanOrEqual(
      attemptBudgetMs('micro', 600_000),
    );
  });
});
