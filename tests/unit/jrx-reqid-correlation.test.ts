/**
 * NV-REQID-CORRELATION-001 — one correlation id from ingress to dispatch.
 *
 * Why this exists: the v1 cost benchmark reported "3 completions" for a
 * single-issue request. That was wrong. `callJurexio` minted its own
 * `crypto.randomUUID()`, unrelated to the id returned to the caller, so no
 * provider log line could ever be joined to an API response. The harness
 * silently degraded to counting billed lines inside a *time window*, which on
 * a shared dev host attributes concurrent traffic to the request under test.
 *
 * Most of these are source-level assertions on purpose. The defect was a missing
 * argument at a call seam, so a behavioural mock of the LLM stack would have
 * happily passed while the seam stayed broken.
 *
 * The Queen-seeding assertion is the exception, and it is now BEHAVIOURAL
 * (NV-REQID-TEST-BRITTLE-001). It used to read the route source, find
 * `const queenRequest: OrchestrationRequest = {`, and require the literal
 * `requestId,` inside the next 400 characters. That is a measurement of comment
 * length, not of behaviour: on 2026-08-19 an unrelated 3-line comment was added
 * above `prompt:` and the test went red while `requestId,` was still present and
 * still propagating. A false red is worse than no test — it teaches the team to
 * dismiss the colour. The replacement drives the real handler and asserts the id
 * actually lands on the object the Queen receives, so the original regression
 * (route dispatches a Queen request with no caller id ⇒ leaf fan-out is only
 * attributable by time window) still fails it, and refactors do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const captured: { queen?: any } = {};

vi.mock('../../src/orchestration/jrx-sdk-orchestration-wrapper.js', () => ({
  executeWithFullSafetyRing: vi.fn(async () => ({
    content: 'MOCK SPECIALIST ANSWER',
    model: 'mock-model',
    provider: 'mock',
    responseTime: 5,
    tokens: { prompt: 10, completion: 10, total: 20 },
    orchestration: { compliancePassed: true },
    metadata: {},
  })),
  executeWithFullSafetyRingSimple: vi.fn(),
}));

vi.mock('../../src/orchestration/jrx-doc-pipeline-adapter.js', () => ({
  tryInvokeDocPipelineLeaves: vi.fn(async () => ({ invoked: false })),
  docPipelineSystemPrompt: () => 'doc system prompt',
}));

/* Partial mock: the route constructs the REAL `QueenLifecycleEmitter` and calls
 * `.on(...)` on it, so a bare class stub throws inside the handler — which
 * presents as "the id was lost" when in fact the instrument broke. */
vi.mock('../../src/orchestration/jrx-queen-orchestrator.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queenOrchestrator: {
    assessPromptComplexity: () => ({
      intent: 'analysis', complexity: 'complex', domains: ['legal'], requiresMultipleAgents: true,
    }),
    orchestrate: vi.fn(async (request: any) => {
      captured.queen = request;
      return {
        success: true,
        synthesizedOutput: 'MOCK QUEEN ANSWER',
        executions: [{ agentId: 'a', agentName: 'A', status: 'completed', tokens: 10, model: 'm', output: 'x' }],
        taskDecomposition: { complexity: 'complex', subtasks: [{}], decompositionAlgorithm: 'auto' },
        metadata: { totalTokens: { input: 10, output: 10 }, totalTime: 20, orchestrationPattern: 'parallel', totalCost: 0 },
      };
    }),
  },
  QueenLifecycleEmitter: (await importOriginal<Record<string, unknown>>()).QueenLifecycleEmitter,
}));

/* The statute / deterministic fast paths answer before dispatch and would leave
 * `captured.queen` undefined — an empty instrument reading as a pass. */
vi.mock('../../src/services/jrx-statute-qa-grounding.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isShortStatuteFaq: () => false,
  isStatuteQaGroundingEnabled: () => false,
  tryStatuteMappingFastPath: async () => null,
  tryStatuteFaqFastPath: async () => null,
  applyStatuteQaGroundingGate: async (a: any) => ({ content: a.answer, applied: false, corrected: false }),
}));

vi.mock('../../src/services/jrx-nys-deterministic-answer.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  couldBeDeterministic: () => false,
  tryNysDeterministicAnswer: async () => null,
}));

vi.mock('../../src/services/jrx-adaptive-path-ema.js', () => ({
  applyAdaptivePathLearning: async (d: any) => d,
  recordAdaptivePathOutcome: async () => {},
}));

import orchestrationRouter from '../../src/routes/jrx-orchestration-routes.js';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const CLIENT = 'src/services/jrx-client.ts';
const WRAPPER = 'src/orchestration/jrx-sdk-orchestration-wrapper.ts';

/** Reach the route's own handler, bypassing app-level auth middleware. */
function orchestrateHandler(path: string): (req: any, res: any) => Promise<void> {
  const layer = (orchestrationRouter as unknown as { stack: any[] }).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post,
  );
  if (!layer) throw new Error(`no POST handler for ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

interface CallResult { status: number; payload: any; events: any[] }

async function callOrchestrate(path: string, body: Record<string, unknown>): Promise<CallResult> {
  const handler = orchestrateHandler(path);
  const req: any = { body, headers: {}, method: 'POST', path, query: {}, on: () => undefined };
  const out: CallResult = { status: 200, payload: undefined, events: [] };
  const res: any = {
    headersSent: false,
    writableEnded: false,
    status(c: number) { out.status = c; return res; },
    json(p: any) { out.payload = p; return res; },
    setHeader() { return res; },
    flushHeaders() { return res; },
    write(chunk: string) {
      const m = /^event: (\S+)\ndata: ([\s\S]*)\n\n$/.exec(String(chunk));
      if (m) { try { out.events.push(JSON.parse(m[2]!)); } catch { /* [DONE] sentinel */ } }
      return true;
    },
    end() { res.writableEnded = true; return res; },
    on() { return res; },
  };
  await handler(req, res);
  return out;
}

/* `orchestrationMode: 'parallel'` is what forces the Queen branch; every optional
 * gate is off so the assertion is about id propagation, not the safety ring. */
const QUEEN_BODY = {
  prompt:
    'Advise on anticipatory bail under BNSS 482 given PMLA attachment exposure, '
    + 'parallel SEBI proceedings and the limitation position.',
  taskType: 'analysis',
  orchestrationMode: 'parallel',
  enableHallucinationCheck: false,
  enableCitationVerification: false,
  enableExplainability: false,
  enableRAG: false,
  enableMemory: false,
  enableHITL: false,
} as const;

beforeEach(() => {
  captured.queen = undefined;
});

describe('NV-REQID-CORRELATION-001: correlation id threading', () => {
  it('./jrx-client accepts a caller-supplied requestId on its options', () => {
    const src = read(CLIENT);
    const iface = src.slice(
      src.indexOf('export interface NvOrchestrationOptions'),
      src.indexOf('export interface NvOrchestrationOptions') + 1200,
    );
    expect(iface).toMatch(/requestId\?:\s*string/);
  });

  it('./jrx-client inherits the inbound id instead of always minting', () => {
    const src = read(CLIENT);
    // The mint must be a fallback (`||`), never unconditional.
    expect(src).toMatch(
      /const requestId = inboundRequestId \|\| crypto\.randomUUID\(\)/,
    );
  });

  it('./jrx-client no longer mints an id unconditionally at the entry seam', () => {
    const src = read(CLIENT);
    const fn = src.slice(src.indexOf('export async function callJurexio'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // A bare `const requestId = crypto.randomUUID();` is the regression.
    expect(body).not.toMatch(/const requestId = crypto\.randomUUID\(\);/);
  });

  it('the safety-ring wrapper forwards req.id as requestId, not only sessionId', () => {
    const src = read(WRAPPER);
    expect(src).toMatch(/requestId:\s*req\.id/);
    // sessionId alone was the bug: it does not reach the dispatch id.
    const optsBlock = src.slice(src.indexOf('sessionId: req.id') - 800, src.indexOf('sessionId: req.id') + 200);
    expect(optsBlock).toMatch(/requestId:\s*req\.id/);
  });

  it('the id reaching the provider is the same field real-llm-service logs', () => {
    // jrx-client sets `id` on LLMRequest; real-llm-service logs `request.id`.
    // If either side is renamed, correlation silently breaks again.
    expect(read(CLIENT)).toMatch(/const llmRequest: LLMRequest = \{\s*\n\s*id: requestId/);
    expect(read('src/services/real-llm-service.ts')).toMatch(/requestId: request\.id/);
  });

  it('the route still returns an id to the caller (the join key exists)', () => {
    expect(read('src/routes/jrx-orchestration-routes.ts')).toMatch(/requestId/);
  });
});

describe('NV-REQID-CORRELATION-001: Queen path attribution', () => {
  const QUEEN = 'src/orchestration/jrx-queen-orchestrator.ts';

  /**
   * REPLACES the 400-character-window source grep (NV-REQID-TEST-BRITTLE-001).
   *
   * What the original protected: the route building a Queen request that carries
   * NO caller id, so every leaf dispatch inside the Queen is attributable only by
   * time window. That is asserted here directly — on the object the Queen is
   * actually handed — so the regression still fails, and a comment or a field
   * reorder in the route does not.
   */
  it('the route seeds the Queen request with the caller id', async () => {
    await callOrchestrate('/orchestrate', QUEEN_BODY);
    expect(captured.queen, 'Queen branch was not exercised — instrument failure, not a pass').toBeTruthy();
    const seeded = captured.queen.requestId;
    expect(typeof seeded, 'the Queen request must carry a requestId').toBe('string');
    expect(String(seeded ?? '').length, 'an empty id is no id').toBeGreaterThan(0);
    // Deleting the field, or passing a fresh uuid, both break the join below.
    expect(seeded).not.toBe(captured.queen.orchestrationId);
  });

  it('the id the Queen receives is the SAME id the caller is given back', async () => {
    // This is the join key. A Queen request seeded with its own fresh uuid would
    // satisfy "has a requestId" and still leave provider logs unjoinable.
    const out = await callOrchestrate('/orchestrate', QUEEN_BODY);
    const returned = out.payload?.requestId ?? out.payload?.data?.requestId;
    expect(returned, 'the route must return an id for the caller to join on').toBeTruthy();
    expect(captured.queen?.requestId).toBe(returned);
  });

  it('two requests get two different ids (the id is per-request, not a constant)', async () => {
    await callOrchestrate('/orchestrate', QUEEN_BODY);
    const first = captured.queen?.requestId;
    captured.queen = undefined;
    await callOrchestrate('/orchestrate', QUEEN_BODY);
    expect(captured.queen?.requestId).toBeTruthy();
    expect(captured.queen?.requestId).not.toBe(first);
  });

  it('OrchestrationRequest declares requestId so the route can pass it', () => {
    const src = read(QUEEN);
    const iface = src.slice(src.indexOf('export interface OrchestrationRequest {'));
    expect(iface.slice(0, 700)).toMatch(/requestId\?:\s*string/);
  });

  it('orchestrationId prefers the caller id over a random one', () => {
    expect(read(QUEEN)).toMatch(
      /request\.requestId \? `orch-\$\{request\.requestId\}` : undefined/,
    );
  });

  it('no dispatch site mints a standalone id (all derive from the parent)', () => {
    const src = read(QUEEN);
    // These were the 5 sites that severed attribution: leaf, synthesis stream,
    // synthesis blocking fallback, CoT capture, and planning.
    expect(src).not.toMatch(/id:\s+crypto\.randomUUID\(\),/);
    expect(src).not.toMatch(/requestId: crypto\.randomUUID\(\)/);
  });

  it('leaf and synthesis ids carry a parent-scoped prefix', () => {
    const src = read(QUEEN);
    for (const suffix of ['leaf-', 'synthesis', 'cot', 'plan']) {
      expect(src).toContain(`::${suffix}`);
    }
  });
});
