/**
 * NV-MEM-FANIN-BOUND-001 / NV-QUEEN-STAGE-ATTRIBUTION-001 — the 236 s that a
 * forced-Queen swarm spent OUTSIDE its model calls.
 *
 * Measured on live jrx-prod (deploy 2026-08-16T0910Z-aws-ssm), one request,
 * HTTP 200, 366.1 s wall clock. Read from the span tree, not inferred:
 *
 *   queen.orchestrate                    366.1s
 *     queen.agent  swarm-agent-0          98.5s   llm  8.1s   NON-LLM  90.3s
 *     queen.agent  swarm-agent-1          98.5s   llm  8.1s   NON-LLM  90.4s
 *     queen.agent  swarm-agent-2          98.8s   llm  8.1s   NON-LLM  90.6s
 *     queen.agent  swarm-aggregate       112.4s   llm 22.0s   NON-LLM  90.5s
 *     queen.synthesis                    151.7s   llm 61.2s   NON-LLM  90.5s
 *
 * The non-LLM cost is a CONSTANT ~90.4 s in every leg — the signature of a fixed
 * timeout budget, not of variable work. 90.4 ≈ 3 x 30 s:
 * `capabilityManifest.invoke` wraps every call in
 * `runWithRetryAndBreaker(..., 'outbound:capability')`, whose breaker timeout is
 * 30_000 ms and whose DEFAULT_RETRY is `maxAttempts: 3` with an `isRetryable`
 * predicate matching `/timed?[- ]?out/`. A source that exhausts its full breaker
 * budget is therefore retried twice more, each retry certain to hit the same
 * wall, and the retries emit NO log lines — which is exactly why the original
 * probe reported "zero retry/backoff log lines" while paying for retry churn.
 *
 * These tests lock the two properties that matter:
 *   1. the fan-in cannot exceed ONE breaker attempt (the retry churn is gone)
 *   2. it stays content-neutral — a source that returns in time is still fully
 *      merged, so this is a pure latency fix that needs no quality re-gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fanInMemoryRecall, type MemoryRecallSource, getFanInGraceMs } from '../../../src/orchestration/jrx-memory-fan-in.js';
import { getBreakerPolicy } from '../../../src/services/circuit-breaker.js';

const SRC = join(process.cwd(), 'src');
const BUDGET_MS = getBreakerPolicy('outbound:capability').timeoutMs;

function source(id: string, run: MemoryRecallSource['run']): MemoryRecallSource {
  return { id, label: id, run };
}

const never = () => new Promise<never>(() => {});

describe('NV-MEM-FANIN-BOUND-001 — recall is bounded by one breaker attempt', () => {
  it('does not wait longer than a single breaker attempt for a hanging source', async () => {
    vi.useFakeTimers();
    try {
      const promise = fanInMemoryRecall({
        query: 'anticipatory bail under BNSS 482',
        sources: [source('memory.tiered.recall', never)],
      });
      // Advance to just before the budget: still pending — we must not cut a
      // recall that could legitimately still arrive.
      await vi.advanceTimersByTimeAsync(BUDGET_MS - 10);
      let settled = false;
      void promise.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled, 'fan-in resolved before its budget elapsed').toBe(false);

      await vi.advanceTimersByTimeAsync(20);
      // Degrades to empty rather than throwing: recall is best-effort and must
      // never fail the Queen turn.
      await expect(promise).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is bounded by ONE attempt, not three — the measured 3x30s churn cannot recur', async () => {
    vi.useFakeTimers();
    try {
      const promise = fanInMemoryRecall({
        query: 'q',
        sources: [source('memory.tiered.recall', never)],
      });
      await vi.advanceTimersByTimeAsync(BUDGET_MS + 50);
      await expect(promise).resolves.toEqual([]);
      // The regression being locked out: 3 x 30s = 90s was the measured cost.
      expect(BUDGET_MS * 3).toBeGreaterThan(BUDGET_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a slow-but-healthy source still returns its items (content-neutral)', async () => {
    vi.useFakeTimers();
    try {
      const promise = fanInMemoryRecall({
        query: 'q',
        sources: [source('memory.tiered.recall', () => new Promise((resolve) => {
          setTimeout(() => resolve([{ id: 'm1', content: 'prior holding' }]), BUDGET_MS - 1_000);
        }))],
      });
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      await expect(promise).resolves.toEqual([{ id: 'm1', content: 'prior holding' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one hanging source does not suppress a fast sibling — fan-out is preserved', async () => {
    vi.useFakeTimers();
    try {
      const promise = fanInMemoryRecall({
        query: 'q',
        sources: [
          source('memory.tiered.recall', never),
          source('memory.mem0.recall', async () => [{ id: 'fast', content: 'from mem0' }]),
        ],
      });
      await vi.advanceTimersByTimeAsync(getFanInGraceMs() + 50);
      await expect(promise).resolves.toEqual([{ id: 'fast', content: 'from mem0' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait the full breaker budget after a sibling already returned items', async () => {
    vi.useFakeTimers();
    try {
      const promise = fanInMemoryRecall({
        query: 'q',
        sources: [
          source('memory.tiered.recall', never),
          source('memory.mem0.recall', async () => [{ id: 'fast', content: 'from mem0' }]),
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(getFanInGraceMs() + 20);
      await expect(promise).resolves.toEqual([{ id: 'fast', content: 'from mem0' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still dedupes across sources (no behaviour change to the merge)', async () => {
    const dup = { id: 'same', content: 'identical content' };
    await expect(fanInMemoryRecall({
      query: 'q',
      sources: [
        source('memory.tiered.recall', async () => [dup]),
        source('memory.mem0.recall', async () => [{ ...dup }]),
      ],
    })).resolves.toEqual([dup]);
  });

  it('binds the budget to the live breaker policy, not a hardcoded literal', () => {
    const src = readFileSync(join(SRC, 'orchestration/jrx-memory-fan-in.ts'), 'utf8');
    expect(src, 'budget must derive from getBreakerPolicy so JRX_BREAKER_CAPABILITY_TIMEOUT_MS stays authoritative')
      .toContain("getBreakerPolicy('outbound:capability').timeoutMs");
    expect(src, 'a hardcoded 30_000 would silently desync from the breaker')
      .not.toMatch(/FANIN_BUDGET_MS\s*=\s*30_?000/);
  });
});

describe('NV-QUEEN-STAGE-ATTRIBUTION-001 — every ring stage reports its own duration', () => {
  const mw = readFileSync(join(SRC, 'orchestration/orchestration-middleware.ts'), 'utf8');

  it('splits the ring into pre / exec / post so non-LLM cost is directly measurable', () => {
    for (const span of ['queen.mw.pre', 'queen.mw.exec', 'queen.mw.post']) {
      expect(mw, `missing ${span} span — leg overhead would again only be inferable from log timestamps`)
        .toContain(`'${span}'`);
    }
  });

  it('spans the two stages the measurement blamed: memory fan-in and RAG', () => {
    expect(mw).toContain("'queen.mw.pre.memory'");
    expect(mw).toContain("'queen.mw.pre.rag'");
  });

  it('reuses the existing tracer rather than adding a second timing mechanism', () => {
    expect(mw, 'NV-NO-DUPLICATE-001: must use utils/jrx-tracer.js withSpan')
      .toContain("from '../utils/jrx-tracer.js'");
  });

  it('reports per-source recall duration on success as well as failure', () => {
    const fanin = readFileSync(join(SRC, 'orchestration/jrx-memory-fan-in.ts'), 'utf8');
    expect(fanin).toContain('recall source ok');
    // Failure path previously logged no duration at all, which is why 90.4s of
    // cost was invisible behind a single "Timed out after 30000ms" warn.
    const failIdx = fanin.indexOf('recall source failed');
    expect(fanin.slice(failIdx, failIdx + 400)).toContain('durationMs');
  });
});
