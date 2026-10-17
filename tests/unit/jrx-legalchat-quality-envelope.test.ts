/**
 * NV-LEGALCHAT-QE-001 / NV-QE-DEFERRED-SPLIT-001
 *
 * Two honesty defects in the quality envelope, both found while building the
 * reasoning-trail panel:
 *
 *  1. `POST /api/jrx/legal-chat/send` drove the Queen directly and emitted NO
 *     envelope at all, so the surface a lawyer actually reviews carried the
 *     least auditability.
 *  2. `snapshotQualityEnvelope` pushed `deferred` records into `completed[]`, so
 *     a queued-and-unseen HITL review read as a passed gate on the wire.
 *
 * The route test drives the real router over HTTP (not a source grep) so the
 * assertions fail if the envelope stops being emitted or starts overstating.
 * The whole point of these gates is that a gate which did not run must never
 * render as a tick, so each test is written to go red on exactly that mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';
import {
  createQualityEnvelope,
  markSafetyRingGates,
  snapshotQualityEnvelope,
  buildQueenPathQualityEnvelope,
  MANDATORY_QUALITY_STEPS,
} from '../../src/orchestration/jrx-quality-envelope.js';

// ── Route-level harness ─────────────────────────────────────────────────────
// Only the Queen result is interesting; everything else is stubbed to the
// minimum that lets the real /send handler run to completion.

const orchestrateMock = vi.fn();

/**
 * NV-LEGALCHAT-CREDIT-001 — the pre-spend cap is a real dependency of this route
 * now, so the harness controls it. `enforceMock` decides allow/deny; `recordMock`
 * proves the post-spend loop that makes the cap capable of firing was dispatched.
 */
const enforceMock = vi.fn();
const recordMock = vi.fn();

vi.mock('../../src/services/jrx-ai-credit-enforcer.js', () => ({
  nvAICreditEnforcer: {
    enforce: (...a: unknown[]) => enforceMock(...a),
    record: (...a: unknown[]) => recordMock(...a),
  },
}));

/* `creditRecord` is OFF in test by default, which would make every post-hoc
 * accounting assertion vacuously pass. Forced ON so the record() leg is exercised
 * the way it runs in production. */
vi.mock('../../src/config/jrx-feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNyvFeatureOn: (flag: string) => (flag === 'creditRecord' ? true : false),
}));

/* The Queen's own token accounting is what the route falls back to; an
 * AsyncLocalStorage accumulator does not exist under this harness.
 *
 * NV-CREDIT-UNIVERSAL-001: `claimRequestUsageForBilling` must be stubbed too. The
 * route now claims the request before recording, so the platform-wide
 * response-finish recorder cannot bill the same turn twice. With no accumulator
 * the real implementation grants the claim — there is nothing that could
 * double-bill — which is what this returns. */
vi.mock('../../src/utils/jrx-request-usage-context.js', () => ({
  getRequestUsage: () => undefined,
  nvRequestUsageContext: (_req: any, _res: any, next: any) => next(),
  recordLlmUsage: () => {},
  claimRequestUsageForBilling: () => true,
}));

vi.mock('../../src/db/index.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock('../../src/middleware/jrx-auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: '42', organizationId: '7', role: 'user' };
    next();
  },
}));

vi.mock('../../src/middleware/legal-chat-rbac.js', () => ({
  requireLegalChatAccess: (_req: any, _res: any, next: any) => next(),
  requireSuperadmin: (_req: any, _res: any, next: any) => next(),
  isSuperadmin: () => false,
}));

vi.mock('../../src/services/legal-chat-event-bus.js', () => ({
  legalChatEventBus: { snapshot: () => [], subscribe: () => () => {}, isDone: () => true },
  publishTimeline: () => {},
}));

vi.mock('../../src/services/jrx-document-converter-service.js', () => ({
  extractTextFromSource: async () => '',
}));

vi.mock('../../src/orchestration/jrx-queen-orchestrator.js', () => ({
  queenOrchestrator: { orchestrate: (...a: unknown[]) => orchestrateMock(...a) },
  QueenLifecycleEmitter: class extends EventEmitter {},
}));

vi.mock('../../src/services/intelligent-router/model-catalog.js', () => ({ MODEL_CATALOG: [] }));

vi.mock('../../src/services/intelligent-router/intelligent-router.js', () => ({
  pickSequence: () => ({ primary: { id: 'test-model', provider: 'test' }, sequence: [], inputs: {} }),
}));

vi.mock('../../src/services/jrx-sme/jrx-sme-mem0-hooks.js', () => ({
  recallSmePreferences: async () => ({ hits: 0, facts: [], recent: [] }),
  storeSmeInteraction: async () => {},
  applyRubricToMem0: async () => {},
}));

vi.mock('../../src/services/jrx-sme-approved-rag-ingest.js', () => ({
  ingestApprovedChatToRag: async () => {},
}));

vi.mock('../../src/services/jrx-sme/jrx-sme-grpo-redis-queue.js', () => ({
  enqueueTrainingPair: async () => false,
  bumpEma: async () => {},
}));

/**
 * Boot the real router, POST /send, and read the SSE stream until the terminal
 * event. The response is a live keep-alive stream, so the socket is force-closed
 * rather than waited on — `server.close()` alone would hang.
 */
async function runSend(
  queenResult: Record<string, unknown>,
  bodyOverride: Record<string, unknown> = {},
): Promise<Array<Record<string, any>>> {
  orchestrateMock.mockReset();
  orchestrateMock.mockResolvedValue(queenResult);
  const { default: router } = await import('../../src/routes/jrx-legal-chat-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/jrx/legal-chat', router);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/jrx/legal-chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Is an anticipatory bail application maintainable?',
        ...bodyOverride,
      }),
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let raw = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.includes('"step":"run_complete"') || raw.includes('"step":"run_failed"')) break;
    }
    void reader.cancel().catch(() => {});
    return raw
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter((e): e is Record<string, any> => e !== null);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

/** A Queen result whose middleware ring measurably ran every safety stage. */
function fullRingResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    synthesizedOutput: 'Anticipatory bail under s.482 BNSS is maintainable where…',
    executions: [{ agentId: 'a1', model: 'test-model' }],
    citations: [],
    safetyVerdict: { verdict: 'allow', details: {} },
    metadata: {
      agentsUsed: 1,
      totalTokens: { input: 10, output: 20 },
      safetyStagesRun: [
        'hallucination', 'citation', 'bias', 'pii', 'consent',
        'metering', 'safety-verdict',
      ],
      ragStep0: { attempted: true, grounded: true, timedOut: false, chunkCount: 4, layersUsed: ['unified-base', 'nys'], retrievalMethods: ['vector'], intent: 'research' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  orchestrateMock.mockReset();
  enforceMock.mockReset();
  recordMock.mockReset();
  enforceMock.mockResolvedValue({
    allowed: true, budgetLimit: 800_000, usedToday: 1_000, remainingToday: 799_000, tier: 'pro',
  });
  recordMock.mockResolvedValue(undefined);
  vi.resetModules();
});

describe('NV-LEGALCHAT-QE-001 — legal-chat/send emits a real quality envelope', () => {
  it('carries a qualityEnvelope on the run_complete event', async () => {
    const events = await runSend(fullRingResult());
    const done = events.find((e) => e.step === 'run_complete');
    expect(done, 'run_complete must be emitted').toBeTruthy();
    const qe = done!.data?.qualityEnvelope;
    expect(qe, 'run_complete.data.qualityEnvelope must be present').toBeTruthy();
    expect(Array.isArray(qe.steps)).toBe(true);
    expect(qe.steps.length).toBeGreaterThan(0);
    expect(qe.path).toBe('queen');
  });

  it('keeps the pre-existing run_complete fields (additive wire change only)', async () => {
    const events = await runSend(fullRingResult());
    const data = events.find((e) => e.step === 'run_complete')!.data;
    for (const key of [
      'response', 'citations', 'model', 'tokensIn', 'tokensOut', 'safetyBlocked', 'agentsUsed',
    ]) {
      expect(data, `NSP consumes ${key}`).toHaveProperty(key);
    }
  });

  it('reports the ring gates it measured as completed', async () => {
    const events = await runSend(fullRingResult());
    const qe = events.find((e) => e.step === 'run_complete')!.data.qualityEnvelope;
    for (const gate of ['hallucination', 'citation', 'bias', 'pii', 'rag_grounding']) {
      expect(qe.completed, `${gate} measurably ran`).toContain(gate);
    }
  });

  /**
   * The mutation that survived on this codebase earlier today was exactly this
   * shape: a short-circuit existed but nothing asserted it. An absent ring must
   * never yield ticks.
   */
  it('does NOT report ring gates as passed when the Queen surfaced no ring evidence', async () => {
    const noEvidence = fullRingResult({
      metadata: { agentsUsed: 1, totalTokens: { input: 1, output: 1 } },
    });
    const events = await runSend(noEvidence);
    const qe = events.find((e) => e.step === 'run_complete')!.data.qualityEnvelope;

    for (const gate of ['hallucination', 'citation', 'bias', 'pii']) {
      expect(qe.completed, `${gate} never ran — must not be ticked`).not.toContain(gate);
      expect(qe.deferred).not.toContain(gate);
    }
    for (const gate of ['hallucination', 'citation', 'pii']) {
      expect(qe.missingMandatory, `${gate} must be reported missing`).toContain(gate);
    }
    expect(qe.ok, 'an envelope missing mandatory gates is not ok').toBe(false);
    // A gate with no evidence must leave NO record at all, so no consumer can
    // read a status off it.
    const ids = (qe.steps as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain('hallucination');
  });

  it('reports a gate whose ring job rejected as missing, not passed', async () => {
    // citation absent from stagesRun = the allSettled job rejected.
    const partial = fullRingResult({
      metadata: {
        agentsUsed: 1,
        totalTokens: { input: 1, output: 1 },
        safetyStagesRun: ['hallucination', 'bias', 'pii', 'consent', 'metering', 'safety-verdict'],
        ragStep0: { attempted: true, grounded: false, timedOut: false },
      },
    });
    const events = await runSend(partial);
    const qe = events.find((e) => e.step === 'run_complete')!.data.qualityEnvelope;
    expect(qe.completed).toContain('hallucination');
    expect(qe.completed).not.toContain('citation');
    expect(qe.missingMandatory).toContain('citation');
  });

  it('reports the pre-spend credit cap as enforced, because it now runs', async () => {
    const events = await runSend(fullRingResult());
    const qe = events.find((e) => e.step === 'run_complete')!.data.qualityEnvelope;
    expect(qe.completed).toContain('consent_credits');
    expect(qe.missingMandatory).not.toContain('consent_credits');
    const rec = (qe.steps as Array<{ id: string; note?: string }>).find((s) => s.id === 'consent_credits');
    expect(rec?.note ?? '').toMatch(/pre-spend AI-credit cap enforced/i);
  });

  it('distinguishes an attempted-but-ungrounded retrieval from a grounded one', async () => {
    const events = await runSend(fullRingResult({
      metadata: {
        agentsUsed: 1,
        totalTokens: { input: 1, output: 1 },
        safetyStagesRun: ['hallucination', 'citation', 'safety-verdict'],
        ragStep0: { attempted: true, grounded: false, timedOut: false, chunkCount: 0 },
      },
    }));
    const qe = events.find((e) => e.step === 'run_complete')!.data.qualityEnvelope;
    const rag = (qe.steps as Array<{ id: string; note?: string }>).find((s) => s.id === 'rag_grounding');
    expect(rag?.note ?? '').toMatch(/ungrounded/i);
  });
});

/**
 * NV-LEGALCHAT-CREDIT-001 — the cap is enforced BEFORE the model is called, and
 * the envelope reports what actually happened rather than a constant.
 *
 * A permanently-`failed` mandatory gate is its own defect: it trains consumers to
 * ignore `ok: false`. So these tests pin both directions — green when the cap ran,
 * red when it did not — because a gate that can only ever say one thing is
 * indistinguishable from no gate.
 */
describe('NV-LEGALCHAT-CREDIT-001 — pre-spend AI-credit enforcement on legal chat', () => {
  it('enforces before the Queen is dispatched, not after', async () => {
    await runSend(fullRingResult());
    expect(enforceMock, 'the cap must be consulted at all').toHaveBeenCalled();
    expect(orchestrateMock).toHaveBeenCalled();
    // Vitest stamps a monotonic global call index; comparing them is what proves
    // the cap is pre-spend rather than a post-hoc accounting call.
    expect(
      enforceMock.mock.invocationCallOrder[0],
      'the cap must run BEFORE model spend',
    ).toBeLessThan(orchestrateMock.mock.invocationCallOrder[0]!);
  });

  it('prices the attached document, not just the bare question', async () => {
    // A 60 KB attachment is the dominant cost term; estimating on the instruction
    // alone waves a request past a cap it exceeds.
    await runSend(fullRingResult());
    const bare = Number(enforceMock.mock.calls[0]![0].estimatedTokens);
    enforceMock.mockClear();
    await runSend(fullRingResult(), { prompt: 'x'.repeat(60_000) });
    const withDoc = Number(enforceMock.mock.calls[0]![0].estimatedTokens);
    expect(withDoc, 'a much larger prompt must cost more').toBeGreaterThan(bare);
  });

  it('a refusal terminates the run with CREDIT_CAP_EXCEEDED and never calls the model', async () => {
    enforceMock.mockResolvedValue({
      allowed: false,
      reason: 'Daily token budget exceeded.',
      budgetLimit: 50_000,
      usedToday: 50_000,
      remainingToday: 0,
      tier: 'solo',
      retryAfterSeconds: 1200,
    });
    const events = await runSend(fullRingResult());
    expect(orchestrateMock, 'a capped request must not reach the Queen').not.toHaveBeenCalled();
    const failed = events.find((e) => e.step === 'run_failed');
    expect(failed, 'the stream must terminate with run_failed').toBeTruthy();
    // Same code /orchestrate and /orchestrate/stream use, so a partner branches once.
    expect(failed!.data?.code).toBe('CREDIT_CAP_EXCEEDED');
    expect(failed!.data?.retryAfterSeconds).toBe(1200);
    expect(events.find((e) => e.step === 'run_complete'), 'no answer may be delivered').toBeFalsy();
  });

  it('an enforcer that throws fails SOFT — the answer ships, the gate reports red', async () => {
    // Matching /orchestrate: a broken credit table must never withhold a lawyer's
    // answer. But the envelope must then say the guard did not run.
    enforceMock.mockRejectedValue(new Error('relation nv_schema.ai_credit_usage does not exist'));
    const events = await runSend(fullRingResult());
    const done = events.find((e) => e.step === 'run_complete');
    expect(done, 'fail-soft: the answer is still delivered').toBeTruthy();
    const qe = done!.data.qualityEnvelope;
    expect(qe.completed, 'an unenforced request must not tick the gate').not.toContain('consent_credits');
    expect(qe.missingMandatory).toContain('consent_credits');
    const rec = (qe.steps as Array<{ id: string; note?: string }>).find((s) => s.id === 'consent_credits');
    expect(rec?.note ?? '').toMatch(/did NOT run/i);
  });

  it('records post-spend usage, without which the cap could never fire', async () => {
    // enforce() sums nv_schema.ai_credit_usage. If nothing on this path writes a
    // row, usedToday stays 0 forever and the cap is a decorative no-op.
    await runSend(fullRingResult());
    expect(recordMock, 'no record() => the cap can never trip').toHaveBeenCalled();
    const rec = recordMock.mock.calls[0]![0];
    expect(rec.tokensUsed, 'the recorded spend must be the real token total').toBe(30);
    expect(rec.requestId).toMatch(/^orch_/);
  });

  it('does not record a row when the run produced no measurable spend', async () => {
    await runSend(fullRingResult({
      metadata: { agentsUsed: 1, totalTokens: { input: 0, output: 0 }, safetyStagesRun: ['consent'] },
    }));
    expect(recordMock, 'a zero-token row would pollute the daily sum').not.toHaveBeenCalled();
  });
});

/**
 * NV-LEGALCHAT-RAG-EVENT-001 — the `rag_retrieval` SSE event read
 * `r.metadata.rag`, a field the Queen never populates, so it had ALWAYS reported
 * `chunks: 0, status: 'ok'`. A client watching it concluded retrieval ran and
 * found nothing. These tests exist to keep "retrieved nothing" and "we have no
 * measurement" from ever collapsing into the same payload again.
 */
describe('NV-LEGALCHAT-RAG-EVENT-001 — rag_retrieval carries real, measured counts', () => {
  const resolved = (events: Array<Record<string, any>>) =>
    events.filter((e) => e.step === 'rag_retrieval' && e.status !== 'running').at(-1)!;

  it('reports the real chunk count from the Queen Step-0 measurement', async () => {
    const events = await runSend(fullRingResult());
    const ev = resolved(events);
    expect(ev, 'a resolved rag_retrieval event must be emitted').toBeTruthy();
    expect(ev.status).toBe('ok');
    expect(ev.data.chunks, 'the count must be the measured one, not a default').toBe(4);
    expect(ev.data.retrieved).toBe(true);
    expect(ev.data.layersUsed).toEqual(['unified-base', 'nys']);
    expect(ev.data.retrievalMethods).toEqual(['vector']);
    expect(ev.data.evidence).toBe('measured');
  });

  it('a genuine zero-chunk retrieval says so — measured, and retrieved:false', async () => {
    const events = await runSend(fullRingResult({
      metadata: {
        agentsUsed: 1,
        totalTokens: { input: 1, output: 1 },
        ragStep0: { attempted: true, grounded: false, timedOut: false, chunkCount: 0, layersUsed: ['unified-base'], retrievalMethods: [] },
      },
    }));
    const ev = resolved(events);
    expect(ev.status).toBe('ok');
    expect(ev.data.evidence).toBe('measured');
    expect(ev.data.chunks).toBe(0);
    expect(ev.data.retrieved, 'searched and found nothing').toBe(false);
    expect(ev.data.attempted).toBe(true);
  });

  /** THE original defect. `chunks: 0` + `status: 'ok'` must never mean "no data". */
  it('no Step-0 evidence is NOT reported as a successful zero-chunk retrieval', async () => {
    const events = await runSend(fullRingResult({
      metadata: { agentsUsed: 1, totalTokens: { input: 1, output: 1 } },
    }));
    const ev = resolved(events);
    expect(ev.status, 'absence of data is not ok').not.toBe('ok');
    expect(ev.status).toBe('skipped');
    expect(ev.data.evidence).toBe('absent');
    expect(ev.data.chunks, 'never 0 — 0 is a measurement we do not have').toBeNull();
    expect(ev.data.retrieved).toBeNull();
    expect(String(ev.data.reason ?? '')).toMatch(/unknown, not zero/i);
  });

  it('a timed-out retrieval is distinguishable from both of the above', async () => {
    const events = await runSend(fullRingResult({
      metadata: {
        agentsUsed: 1,
        totalTokens: { input: 1, output: 1 },
        ragStep0: { attempted: true, grounded: false, timedOut: true },
      },
    }));
    const ev = resolved(events);
    expect(ev.status, 'a timeout is not a successful retrieval').toBe('failed');
    expect(ev.data.evidence).toBe('measured');
    expect(ev.data.timedOut).toBe(true);
    expect(ev.data.chunks, 'the count was never observed').toBeNull();
    expect(String(ev.data.reason ?? '')).toMatch(/timed out/i);
  });

  it('the four outcomes are mutually exclusive on (status, chunks)', async () => {
    // The property that actually matters: no two distinct retrieval realities may
    // produce the same (status, chunks) pair.
    const cases: Array<[string, Record<string, unknown> | undefined]> = [
      ['grounded', { attempted: true, grounded: true, timedOut: false, chunkCount: 4 }],
      ['zero', { attempted: true, grounded: false, timedOut: false, chunkCount: 0 }],
      ['timeout', { attempted: true, grounded: false, timedOut: true }],
      ['absent', undefined],
    ];
    const seen = new Set<string>();
    for (const [label, ragStep0] of cases) {
      const events = await runSend(fullRingResult({
        metadata: {
          agentsUsed: 1,
          totalTokens: { input: 1, output: 1 },
          ...(ragStep0 ? { ragStep0 } : {}),
        },
      }));
      const ev = resolved(events);
      const key = `${ev.status}|${String(ev.data.chunks)}`;
      expect(seen.has(key), `${label} collides with an earlier outcome on ${key}`).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(4);
  });
});

describe('NV-QE-DEFERRED-SPLIT-001 — a deferred record never reads as completed', () => {
  function deferredHitlEnvelope() {
    const env = createQualityEnvelope({
      requestId: 'deferred-1',
      path: 'queen',
      partnerLean: false,
      risk: 'high',
      requireCoT: false,
      requireMakerChecker: false,
      requireHitlScaled: true,
    });
    markSafetyRingGates(env, {
      ragAttempted: true,
      hallucinationRan: true,
      citationRan: true,
      llmRouted: true,
      hitlRan: false,
    });
    return snapshotQualityEnvelope(env);
  }

  it('a queued HITL review is absent from completed[] and present in deferred[]', () => {
    const snap = deferredHitlEnvelope();
    expect(snap.completed, 'no human has seen this answer').not.toContain('hitl');
    expect(snap.deferred).toContain('hitl');
  });

  it('steps[] stays authoritative and carries the honest per-stage status', () => {
    const snap = deferredHitlEnvelope();
    const rec = snap.steps.find((s) => s.id === 'hitl');
    expect(rec?.status).toBe('deferred');
    // Anything a consumer could read as a pass must not say 'completed'.
    expect(rec?.status).not.toBe('completed');
  });

  it('deferring HITL does not change fail-closed accounting', () => {
    // Deferred is not failed, so it must not manufacture a missing mandatory
    // gate (which would 500 the orchestrate route in production).
    const snap = deferredHitlEnvelope();
    expect(snap.missingMandatory).not.toContain('hitl');
  });

  it('the three summary arrays are disjoint', () => {
    const snap = deferredHitlEnvelope();
    const all = [...snap.completed, ...snap.scaledOptional, ...snap.deferred];
    expect(new Set(all).size, 'a stage must appear in exactly one bucket').toBe(all.length);
  });

  it('every completed[] entry is backed by a completed record in steps[]', () => {
    const snap = buildQueenPathQualityEnvelope({
      requestId: 'x',
      risk: 'high',
      requireCoT: false,
      requireMakerChecker: true,
      requireHitlScaled: true,
      ingressGates: { identityVerified: true, taskClassified: true, jurisdictionResolved: true },
      safetyStagesRun: ['hallucination', 'citation', 'pii', 'safety-verdict', 'metering'],
      ragStep0: { attempted: true, grounded: true, timedOut: false },
      llmRouted: true,
      cotRan: false,
      makerCheckerRan: false,
      hitlRan: false,
      responseFormatted: true,
      meteringRan: false,
    });
    for (const id of snap.completed) {
      const rec = snap.steps.find((s) => s.id === id);
      expect(rec?.status, `${id} is in completed[] so its record must say completed`).toBe('completed');
    }
    expect(snap.deferred).toContain('hitl');
    // maker-checker was required by risk and did not run — that stays visible.
    expect(snap.missingMandatory).toContain('maker_checker');
  });

  it('an unmarked mandatory gate is reported missing rather than assumed', () => {
    const snap = buildQueenPathQualityEnvelope({
      requestId: 'x',
      risk: 'low',
      requireCoT: false,
      requireMakerChecker: false,
      requireHitlScaled: false,
      ingressGates: { identityVerified: false, taskClassified: false, jurisdictionResolved: false },
      llmRouted: false,
      cotRan: false,
      makerCheckerRan: false,
      hitlRan: false,
      responseFormatted: false,
      meteringRan: false,
    });
    expect(snap.completed).toEqual([]);
    for (const id of MANDATORY_QUALITY_STEPS) {
      expect(snap.missingMandatory, `${id} had no evidence`).toContain(id);
    }
    expect(snap.ok).toBe(false);
  });
});
