/**
 * NV-COMPLETION-DRIVEN-001 — optional stages must not hold the critical path
 * after the useful result is already in.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isCapabilityErrorRetryable } from '../../src/services/circuit-breaker.js';
import { settleOptional, proceedOnFirstUseful, OPTIONAL_STAGE_GRACE_MS } from '../../src/orchestration/jrx-completion-driven.js';

const SRC = join(process.cwd(), 'src');
const CONTRACT_SRC = readFileSync(join(SRC, 'orchestration/jrx-orchestration-response-contract.ts'), 'utf8');
const SANITIZE_SRC = readFileSync(join(SRC, 'utils/jrx-client-outcome-sanitize.ts'), 'utf8');
const ROUTES_SRC = readFileSync(join(SRC, 'routes/jrx-orchestration-routes.ts'), 'utf8');

describe('NV-COMPLETION-DRIVEN-001 — timeout is not a capability retry', () => {
  it('does not retry breaker timeouts (aligns with LLM RETRYABLE excluding timeout)', () => {
    expect(isCapabilityErrorRetryable(new Error('Timed out after 30000ms'))).toBe(false);
    expect(isCapabilityErrorRetryable(new Error('TimeoutError'))).toBe(false);
    expect(isCapabilityErrorRetryable(new Error('The operation was aborted'))).toBe(false);
  });

  it('still retries transient 502/503 and connection resets', () => {
    expect(isCapabilityErrorRetryable(new Error('ECONNRESET'))).toBe(true);
    expect(isCapabilityErrorRetryable(new Error('upstream 503'))).toBe(true);
  });
});

describe('NV-COMPLETION-DRIVEN-001 — settleOptional proceeds on grace', () => {
  it('returns the value when the promise wins', async () => {
    await expect(settleOptional(Promise.resolve(42), 50)).resolves.toEqual({
      timedOut: false,
      value: 42,
    });
  });

  it('times out without waiting for a hanging promise', async () => {
    vi.useFakeTimers();
    try {
      const hanging = new Promise<number>(() => {});
      const raced = settleOptional(hanging, 200);
      await vi.advanceTimersByTimeAsync(200);
      await expect(raced).resolves.toEqual({ timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('default grace is milliseconds, not the 30s breaker', () => {
    expect(OPTIONAL_STAGE_GRACE_MS).toBeLessThanOrEqual(2_000);
    expect(OPTIONAL_STAGE_GRACE_MS).toBeGreaterThanOrEqual(50);
  });
});

describe('NV-COMPLETION-DRIVEN-001 — wiring contracts in Queen / middleware', () => {
  const queen = readFileSync(join(SRC, 'orchestration/jrx-queen-orchestrator.ts'), 'utf8');
  const mw = readFileSync(join(SRC, 'orchestration/orchestration-middleware.ts'), 'utf8');

  it('skips per-leaf memory after Step-0 (skipMemory, like skipRag)', () => {
    expect(queen).toContain('memoryAlreadyApplied = true');
    expect(queen).toContain('skipMemory:');
    expect(mw).toContain('if (input.skipMemory)');
  });

  it('CoT is idempotent and does not await a second capture on the swarm path', () => {
    expect(queen).toContain('if (ext.__queenCotApplied) return true');
    const collectiveStart = queen.indexOf('public async executeCollectiveIntelligence');
    const collectiveSlice = queen.slice(collectiveStart, collectiveStart + 12_000);
    expect(collectiveSlice).toMatch(/void maybeRunQueenCoT\(request\)/);
    expect(collectiveSlice).not.toMatch(/await maybeRunQueenCoT\(request\)/);
  });

  it('overlaps CoT with synthesis via settleOptional rather than blocking after the answer', () => {
    expect(queen).toContain('settleOptional(cotPromise');
    expect(queen).toContain('__queenCotSkippedProgression = true');
  });

  it('runs hallucination and citation in parallel after the answer exists', () => {
    expect(mw).toContain('Promise.allSettled(safetyJobs.map');
    expect(mw).toContain('failOpen');
  });

  it('stamps requestPhase on the Queen result', () => {
    expect(queen).toContain('setRequestPhase');
    expect(queen).toContain('requestPhase:');
  });

  it('Step-0 grounding releases on first useful source instead of Promise.all', () => {
    // The defect: `await Promise.all([ragPromise, memPromise])` made Step-0 cost the
    // slower of the two every time, up to parallelTimeoutMs (20-35s), even when RAG
    // had already returned authorities.
    expect(queen).not.toContain('await Promise.all([ragPromise, memPromise])');
    expect(queen).toContain('proceedOnFirstUseful([');
    expect(queen).toContain('trackSettled(ragPromise)');
    expect(queen).toContain('trackSettled(memPromise)');
  });
});

describe('NV-COMPLETION-DRIVEN-001 — proceedOnFirstUseful', () => {
  it('releases after grace when one source is useful and the other hangs', async () => {
    vi.useFakeTimers();
    try {
      const useful = Promise.resolve({ contextBlock: 'authorities' });
      const hanging = new Promise<{ recalledCount: number }>(() => {});
      const raced = proceedOnFirstUseful(
        [
          { promise: useful, isUseful: (v) => !!(v as { contextBlock?: string }).contextBlock },
          { promise: hanging, isUseful: (v) => Number((v as { recalledCount?: number }).recalledCount) > 0 },
        ],
        100,
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(raced).resolves.toEqual({ releasedEarly: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT release early on a fast empty result — an empty source is not progress', async () => {
    vi.useFakeTimers();
    try {
      const empty = Promise.resolve({ contextBlock: '' });
      let releaseSlow: (v: { recalledCount: number }) => void = () => {};
      const slowUseful = new Promise<{ recalledCount: number }>((r) => {
        releaseSlow = r;
      });
      const raced = proceedOnFirstUseful(
        [
          { promise: empty, isUseful: (v) => !!(v as { contextBlock?: string }).contextBlock },
          { promise: slowUseful, isUseful: (v) => Number((v as { recalledCount?: number }).recalledCount) > 0 },
        ],
        100,
      );
      // Well past the grace window: an empty sibling must not have released the pair.
      await vi.advanceTimersByTimeAsync(5_000);
      releaseSlow({ recalledCount: 3 });
      await vi.advanceTimersByTimeAsync(0);
      // All settled, so the release was NOT an early grace release.
      await expect(raced).resolves.toEqual({ releasedEarly: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejected source cannot strand the pair or raise an unhandled rejection', async () => {
    const failed = Promise.reject(new Error('recall exploded'));
    const useful = Promise.resolve({ contextBlock: 'x' });
    await expect(
      proceedOnFirstUseful(
        [
          { promise: failed, isUseful: () => true },
          { promise: useful, isUseful: (v) => !!(v as { contextBlock?: string }).contextBlock },
        ],
        10,
      ),
    ).resolves.toHaveProperty('releasedEarly');
  });

  it('empty source list is a no-op', async () => {
    await expect(proceedOnFirstUseful([], 10)).resolves.toEqual({ releasedEarly: false });
  });
});

describe('NV-COMPLETION-DRIVEN-001 — requestPhase reaches the partner payload', () => {

  it('the unified contract always emits a phase', () => {
    expect(CONTRACT_SRC).toContain('requestPhase:');
    expect(CONTRACT_SRC).toContain("'ready' : 'failed_infra'");
  });

  it('the sanitizer keeps requestPhase / optionalDegraded but strips the internal CoT flag', () => {
    // Regression guard: osDepth IS stripped, so phase must not be smuggled inside it.
    expect(SANITIZE_SRC).toContain('delete out.osDepth');
    expect(SANITIZE_SRC).toContain('delete out.queenCotSkippedProgression');
    expect(SANITIZE_SRC).not.toContain('delete out.requestPhase');
    expect(SANITIZE_SRC).not.toContain('delete out.optionalDegraded');
  });

  it('the Queen route forwards the phase it computed', () => {
    expect(ROUTES_SRC).toContain('requestPhase: (queenResult.metadata as any)?.requestPhase');
    expect(ROUTES_SRC).toContain('optionalDegraded: !!(queenResult.metadata as any)?.optionalDegraded');
  });
  it('echoes the sessionId so a partner can continue the same session', () => {
    // NV-SESSION-ECHO-001: the route mints an ecosystem session id for NSP/NYM and
    // stores session memory under it. Without echoing it back, every turn minted a
    // new id and turn-1 memory was unreachable — multi-turn was impossible.
    expect(CONTRACT_SRC).toContain('sessionId: input.sessionId');
    const echoes = ROUTES_SRC.match(/\.\.\.\(sessionId \? \{ sessionId \} : \{\}\)/g) || [];
    expect(echoes.length).toBeGreaterThanOrEqual(3); // queen + specialist + doc-pipeline
    expect(SANITIZE_SRC).not.toContain('delete out.sessionId');
  });

  it('surfaces a stable orchestrationId for multi-leaf Queen runs', () => {
    expect(CONTRACT_SRC).toContain('orchestrationId: input.orchestrationId');
    expect(ROUTES_SRC).toContain('orchestrationId: (queenResult.metadata as any)?.orchestrationId');
  });
});
