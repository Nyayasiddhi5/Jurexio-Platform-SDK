/**
 * NV-QUEEN-COT-COLLECTIVE-001 / NV-QUEEN-COLLECTIVE-PARALLEL-001 — the two defects
 * that made the swarm path both unreliable and slow.
 *
 * Measured on nysdev before these fixes, same litigation-strategy prompt:
 *   - run A → HTTP 200, full 7.5k-char answer
 *   - run B → HTTP 500 `INTERNAL_ERROR: mandatory steps missing: cot`
 *   - 362 s wall while completions summed to 89 s (7s, 7s, 8s, 20s, 21s, 26s)
 *
 * The 500 was NOT a timeout: `nv-adaptive-router` sets `requireCoT: true` for every
 * `forceLegalBestOutcome` Queen request, but `executeCollectiveIntelligence` never
 * called `maybeRunQueenCoT` — only the decomposition path did. The quality envelope
 * then found `cot` missing and threw AFTER the swarm had produced a correct answer
 * and been billed for 6-13 completions. Full spend, full latency, zero delivered
 * value: the worst failure class in the platform.
 *
 * These tests lock the CONTRACT rather than the implementation: the router's
 * mandatory-step declaration and the Queen's ability to satisfy it must not drift
 * apart again, and independent collective agents must not be dispatched serially.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');
const queenSource = readFileSync(join(SRC, 'orchestration/jrx-queen-orchestrator.ts'), 'utf8');
const routerSource = readFileSync(join(SRC, 'orchestration/jrx-adaptive-router.ts'), 'utf8');
const envelopeSource = readFileSync(join(SRC, 'orchestration/jrx-quality-envelope.ts'), 'utf8');

/** Extract the body of `executeCollectiveIntelligence` for targeted assertions. */
function collectiveBody(): string {
  const start = queenSource.indexOf('public async executeCollectiveIntelligence');
  expect(start, 'executeCollectiveIntelligence not found — was it renamed?').toBeGreaterThan(-1);
  // Ends at the synthesis of the collective result envelope.
  const end = queenSource.indexOf('synthesizedOutput: polishedCollective', start);
  expect(end, 'collective result envelope not found').toBeGreaterThan(start);
  return queenSource.slice(start, end);
}

describe('NV-QUEEN-COT-COLLECTIVE-001 — the swarm path satisfies the CoT it is required to run', () => {
  it('still has a router branch that mandates CoT (the precondition for this defect)', () => {
    // If this ever stops being true the gate cannot fire, but the assertion also
    // documents WHY the Queen must run CoT rather than treating it as optional.
    expect(routerSource).toMatch(/requireCoT:\s*true/);
  });

  it('the quality envelope still fails closed on a missing mandatory cot step', () => {
    // The 500 came from here. Keeping this assertion means a future refactor that
    // silently downgrades the gate to a warning is caught deliberately, not by a
    // surprised customer.
    expect(envelopeSource).toContain("missingMandatory.push('cot')");
    expect(envelopeSource).toMatch(/mandatory steps missing/);
  });

  it('the collective/swarm path invokes CoT capture', () => {
    // The actual regression: this call was absent, so `queenCotApplied` stayed
    // false on every swarm request.
    expect(collectiveBody()).toContain('maybeRunQueenCoT(request)');
  });

  it('gates CoT capture on the swarm having actually produced output', () => {
    // Claiming reasoning over an empty swarm would be worse than failing: it would
    // convert a visible error into a silently ungrounded answer.
    const body = collectiveBody();
    const idx = body.indexOf('maybeRunQueenCoT(request)');
    const preceding = body.slice(Math.max(0, idx - 400), idx);
    expect(preceding).toMatch(/status === 'completed'/);
    expect(preceding).toMatch(/\.output/);
  });

  it('runs CoT capture before the result envelope is built', () => {
    // `queenCotApplied` is read when the metadata object is constructed, so a call
    // placed after that point would compile and still fail the gate.
    const body = collectiveBody();
    expect(body.indexOf('maybeRunQueenCoT(request)')).toBeGreaterThan(-1);
    // The metadata read lives after our slice ends, so simply being inside the
    // slice proves ordering; assert the flag read is genuinely downstream.
    const flagRead = queenSource.indexOf('queenCotApplied: asExt(request).__queenCotApplied === true', queenSource.indexOf('public async executeCollectiveIntelligence'));
    const cotCall = queenSource.indexOf('maybeRunQueenCoT(request)', queenSource.indexOf('public async executeCollectiveIntelligence'));
    expect(cotCall).toBeLessThan(flagRead);
  });
});

describe('NV-QUEEN-COLLECTIVE-PARALLEL-001 — independent collective agents run concurrently', () => {
  it('dispatches through the shared concurrency helper, not a serial await loop', () => {
    const body = collectiveBody();
    expect(body).toContain('runWithConcurrency');
    // The precise defect: `await this.executeAgent(...)` inside a for-loop made
    // wall-clock N × per-agent latency for agents that are independent by
    // construction.
    expect(body).not.toMatch(/for\s*\(const agent of config\.participants\)/);
  });

  it('reuses the tier execution policy rather than a second concurrency mechanism', () => {
    // NV-NO-DUPLICATE-001: the decomposition path already carries the policy
    // contract (maxConcurrentNodes + perNodeTimeoutMs, clamped by the
    // request-scoped deadline from NV-QUEEN-DEADLINE-001).
    const body = collectiveBody();
    expect(body).toContain('resolveRequestPolicy(request)');
    expect(body).toContain('maxConcurrentNodes');
    expect(body).toContain('perNodeTimeoutMs');
  });

  it('keeps consensus ROUNDS sequential while parallelising within a round', () => {
    // Rounds are causally ordered — round N+1 reacts to the agreement reached in
    // round N — so flattening them would change the meaning of consensus, not just
    // its speed. The round loop must survive.
    const body = collectiveBody();
    expect(body).toMatch(/for\s*\(let round = 0; round < config\.rounds; round\+\+\)/);
  });

  it('surfaces a failed or timed-out lane instead of silently dropping it', () => {
    // A partial swarm that looks complete is a correctness problem: synthesis would
    // answer confidently from fewer agents than the caller was charged for.
    const body = collectiveBody();
    expect(body).toContain('buildFailedExecutionFromError');
  });

  it('attributes each lane to a named agent so a timeout is diagnosable', () => {
    // `buildFailedExecutionFromError` falls back to 'unknown' when the subtask has
    // no assignedAgent, which would make timed-out swarm lanes untraceable.
    expect(collectiveBody()).toContain('assignedAgent: agent');
  });
});
