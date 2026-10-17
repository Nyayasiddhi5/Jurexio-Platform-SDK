/**
 * NV-LEGALCHAT-RAG-EVENT-001 — the Queen must SURFACE the Step-0 retrieval counts,
 * not merely compute them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The route-level suite (`jrx-legalchat-quality-envelope.test.ts`) mocks
 * `queenOrchestrator.orchestrate`, so it proves the route *reads*
 * `metadata.ragStep0.chunkCount` correctly and proves nothing about whether the
 * Queen ever *writes* it. Deleting the `chunkCount` spread from the Queen's
 * `__ragStep0` stamp left that whole suite green — a survived mutation, i.e. the
 * producing half of the fix was unguarded. This file is that guard.
 *
 * It drives the REAL `queenOrchestrator.orchestrate()` with only the two external
 * boundaries stubbed (Auto-RAG and the LLM), so the assertion runs through the
 * real Step-0 → `completionDrivenResultMeta` → `result.metadata` chain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** What Auto-RAG returns for the run under test. Set per test. */
let autoRagResult: Record<string, unknown> = {};
/** Whether Auto-RAG throws instead of returning — the "not measured" case. */
let autoRagThrows = false;

const autoRagRetrieveMock = vi.fn(async () => {
  if (autoRagThrows) throw new Error('retrieval boom');
  return autoRagResult;
});

vi.mock('../../src/services/jrx-auto-rag-router.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  autoRagRetrieve: (...a: unknown[]) => autoRagRetrieveMock(...(a as [])),
}));

/* The dispatch boundary. Every Queen leaf, the planner and synthesis all go
 * through `withMiddleware` → `realLLMService`. Stubbing the middleware frame
 * (rather than the LLM underneath it) is what keeps the swarm from fail-fasting
 * on a node, which is what made a naive LLM-only stub useless here. */
vi.mock('../../src/orchestration/orchestration-middleware.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withMiddleware: vi.fn(async (input: any) => ({
    output: 'MOCK LEAF ANSWER for ' + String(input?.agentKey ?? 'agent'),
    pre: { recalledMemory: [], ctx: {}, ragContext: '', systemPrompt: '' },
    post: { stagesRun: ['pii', 'consent', 'metering', 'safety-verdict'], verdict: 'pass' },
  })),
}));

vi.mock('../../src/services/real-llm-service.js', () => {
  const svc = {
    executeRequest: vi.fn(async () => ({
      content: 'MOCK LLM ANSWER',
      model: 'mock-model',
      provider: 'mock',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      tokens: { prompt: 5, completion: 5, total: 10 },
      responseTime: 1,
      cost: 0,
    })),
    applyContextEngineering: vi.fn(async (p: unknown) => p),
  };
  return {
    realLLMService: svc,
    RealLLMService: class { static getInstance() { return svc; } },
  };
});

function ragResult(over: Record<string, unknown> = {}) {
  return {
    chunks: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    contextBlock: '\n\n--- Retrieved Authorities ---\nA\nB\nC',
    intent: 'research',
    capabilityTier: 'pro',
    layersUsed: ['unified-base', 'nys'],
    retrievalMethods: ['vector', 'graph'],
    totalFound: 3,
    confidence: 0.8,
    latencyMs: 4,
    ...over,
  };
}

async function orchestrateOnce(): Promise<any> {
  const { queenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');
  return queenOrchestrator.orchestrate({
    prompt: 'Is an anticipatory bail application under BNSS 482 maintainable?',
    type: 'general',
    userId: '42',
    jurisdiction: 'IN',
    requestId: `probe-${Math.random().toString(36).slice(2)}`,
    orchestrationMode: 'single_agent',
  } as never);
}

beforeEach(() => {
  autoRagThrows = false;
  autoRagResult = ragResult();
  autoRagRetrieveMock.mockClear();
  vi.resetModules();
});

describe('NV-LEGALCHAT-RAG-EVENT-001 — Queen surfaces measured Step-0 retrieval counts', () => {
  it('Step-0 Auto-RAG really is reached (positive control for the whole file)', async () => {
    await orchestrateOnce();
    expect(
      autoRagRetrieveMock,
      'Auto-RAG was never called — every assertion below would be vacuous',
    ).toHaveBeenCalled();
  });

  it('metadata.ragStep0 carries the real chunk count, layers and methods', async () => {
    const result = await orchestrateOnce();
    const step0 = result?.metadata?.ragStep0;
    expect(step0, 'the Queen must surface metadata.ragStep0').toBeTruthy();
    expect(step0.attempted).toBe(true);
    expect(step0.chunkCount, 'the count must be the measured one').toBe(3);
    expect(step0.layersUsed).toEqual(['unified-base', 'nys']);
    expect(step0.retrievalMethods).toEqual(['vector', 'graph']);
    expect(step0.intent).toBe('research');
    expect(step0.grounded).toBe(true);
  });

  it('a real zero-chunk retrieval surfaces chunkCount 0, not an absent count', async () => {
    autoRagResult = ragResult({ chunks: [], contextBlock: '', totalFound: 0, retrievalMethods: [] });
    const result = await orchestrateOnce();
    const step0 = result?.metadata?.ragStep0;
    expect(step0.chunkCount, 'searched and found nothing is a MEASUREMENT of 0').toBe(0);
    expect(step0.grounded).toBe(false);
    expect(step0.attempted).toBe(true);
  });

  /**
   * The distinction the SSE event depends on: a retrieval that never produced a
   * result must leave `chunkCount` ABSENT, so a reporter cannot present it as 0.
   */
  it('a thrown retrieval leaves chunkCount absent rather than reporting 0', async () => {
    autoRagThrows = true;
    const result = await orchestrateOnce();
    const step0 = result?.metadata?.ragStep0;
    expect(step0, 'Step-0 still ran, so the record must exist').toBeTruthy();
    expect(step0.attempted).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(step0, 'chunkCount'),
      'an unobserved count must not be materialised as 0',
    ).toBe(false);
    expect(step0.grounded).toBe(false);
  });
});
