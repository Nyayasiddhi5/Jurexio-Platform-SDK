/**
 * Regression — AG-UI streaming cross-user event isolation
 * (Task #36 → Task #64 architectural rewrite).
 *
 * History
 * -------
 * Round 2 of Task #27 fixed a critical concurrency bug: two simultaneous
 * `POST /api/jrx/stream` requests sharing a global EventEmitter on the Queen
 * Orchestrator could cross-receive each other's agent execution events
 * (including outputPreview content). The original fix (Tasks #27/#36/#37)
 * stamped every Queen lifecycle payload with `orchestrationId` and made
 * the route filter listeners on it.
 *
 * Task #64 replaces that fragile contract with structural isolation:
 * each `orchestrate()` call owns a private `QueenLifecycleEmitter` passed
 * via `OrchestrationRequest.lifecycleEvents`, and the orchestrator emits
 * lifecycle events ONLY onto that per-request emitter. The singleton
 * QueenOrchestrator EventEmitter no longer carries lifecycle events at
 * all — the wire that previously could leak between requests does not
 * exist any more.
 *
 * This regression suite locks the new contract in three complementary ways:
 *
 *   1. End-to-end isolation — spin up the real AG-UI route, fire two
 *      concurrent authenticated requests with disjoint task content from
 *      two different users, and assert that each SSE stream contains only
 *      its own request's content (zero cross-leak) plus at least one of
 *      every Queen lifecycle event type the route forwards.
 *
 *   2. Architectural source guard #1 — `nv-queen-orchestrator.ts` MUST
 *      NOT call `this.emit(...)` (singleton) for any lifecycle event.
 *      All lifecycle emits MUST go through `emitLifecycle(request, ...)`
 *      / `request.lifecycleEvents.emit(...)`. A future regression that
 *      reverts to the singleton would re-introduce the cross-leak risk;
 *      this guard fails CI before that ever ships.
 *
 *   3. Architectural source guard #2 — `nv-agui-stream-routes.ts` MUST
 *      NOT subscribe to lifecycle events on the singleton orchestrator
 *      (no `queenOrchestrator.on('<lifecycle>'…)` /
 *      `queenOrchestrator.onLifecycle(...)`). Listeners attach to the
 *      per-request `QueenLifecycleEmitter`, ensuring the global emitter
 *      never accumulates listeners across requests.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  OrchestrationRequest,
  OrchestrationResult,
  TaskDecomposition,
  AgentExecution,
} from '../../src/orchestration/jrx-queen-orchestrator.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────────────

const TASK_A = 'Draft an NDA clause for technology transfer with confidentiality obligations';
const TASK_B = 'Explain GDPR Article 17 right to erasure for personal data subjects';

// Substrings unique to task A (must appear in stream A, must NOT appear in B).
const A_KEYWORDS = ['NDA', 'technology transfer', 'confidentiality obligations'];
// Substrings unique to task B (must appear in stream B, must NOT appear in A).
const B_KEYWORDS = ['GDPR', 'Article 17', 'right to erasure', 'personal data'];

let server: http.Server;
let baseUrl: string;
let tokenA: string;
let tokenB: string;

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap — spin up an isolated Express app with the AG-UI route mounted
// and stub queenOrchestrator.orchestrate to emit real lifecycle events.
// ──────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // The auth middleware reads `JWT_SECRET` (not the platform-specific
  // `NYV_JWT_SECRET` defaulted in tests/setup.ts) and refuses to start
  // without one. Set a deterministic test value so jwt.sign and
  // jwt.verify agree across this suite.
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-task-36-regression';

  // Lazy import AFTER setup.ts mocks (db / openai / ioredis / drizzle) are in
  // place so the route module's transitive imports do not touch real I/O.
  const aguiRouter = (await import('../../src/routes/jrx-agui-stream-routes.js')).default;
  const { queenOrchestrator } = await import('../../src/orchestration/jrx-queen-orchestrator.js');

  // Replace the Queen's orchestrate() with a deterministic emitter that
  // mirrors the real lifecycle event sequence on the request's
  // per-request `lifecycleEvents` emitter (Task #64). The AG-UI route
  // populates `req.lifecycleEvents` with a fresh `QueenLifecycleEmitter`
  // before calling orchestrate(); the mock emits onto that same emitter
  // so the route's listeners receive the events. We keep the
  // `orchestrationId` stamp on payloads (it's still a typed required
  // field, used for client-side correlation) but cross-request isolation
  // is now structural — each request's emitter is private, so two
  // concurrent runs cannot see each other's events even if the id were
  // dropped.
  vi.spyOn(queenOrchestrator, 'orchestrate').mockImplementation(
    async (req: OrchestrationRequest): Promise<OrchestrationResult> => {
      const orchestrationId: string = req.orchestrationId ?? 'orch-test-fallback';
      const prompt: string = req.prompt ?? '';

      const events = req.lifecycleEvents;
      if (!events) {
        throw new Error(
          '[test mock] req.lifecycleEvents is missing — the route must populate it before calling orchestrate() (Task #64).',
        );
      }

    // Emit asynchronously via setImmediate so concurrent invocations
    // genuinely interleave their event emission. With per-request
    // emitters there is no shared wire to race on, but interleaving
    // still exercises the route's listener handlers under realistic
    // microtask ordering.
    const emit = <K extends keyof import('../../src/orchestration/jrx-queen-orchestrator.js').QueenLifecycleEventMap>(
      event: K,
      payload: Omit<import('../../src/orchestration/jrx-queen-orchestrator.js').QueenLifecycleEventMap[K], 'orchestrationId'>,
    ) =>
    new Promise<void>((resolve) => {
      setImmediate(() => {
        // Stamp orchestrationId so the mock's payloads satisfy the typed
        // event interfaces. The cast is unavoidable given the generic
        // Omit<…> input merged with the id; the runtime shape matches.
        events.emit(event, { ...(payload as object), orchestrationId } as import('../../src/orchestration/jrx-queen-orchestrator.js').QueenLifecycleEventMap[K]);
        resolve();
      });
    });

    await emit('decomposition_complete', {
    algorithm: 'HTA',
    pattern: 'parallel',
    complexity: 'moderate',
    subtaskCount: 2,
    subtasks: [
      {
        id: 'st-1',
        type: 'research',
        description: prompt.slice(0, 200),
        assignedAgent: 'AgentResearch',
        complexity: 'moderate',
      },
      {
        id: 'st-2',
        type: 'analysis',
        description: prompt.slice(0, 200),
        assignedAgent: 'AgentAnalysis',
        complexity: 'moderate',
      },
    ],
    });

    await emit('agent_started', {
    subtaskId: 'st-1',
    subtaskType: 'research',
    agentId: 'a1',
    agentName: 'AgentResearch',
    agentTier: 'pro',
    romaLevel: 5,
    description: prompt.slice(0, 240),
    });
    await emit('agent_completed', {
    subtaskId: 'st-1',
    agentId: 'a1',
    agentName: 'AgentResearch',
    durationMs: 50,
    // outputPreview embeds the request's prompt — this is exactly the
    // data that previously cross-leaked between concurrent streams.
    outputPreview: `RESEARCH RESULT for: ${prompt.slice(0, 200)}`,
    outputLength: 200,
    via: 'llm',
    model: 'gpt-4o',
    });
    await emit('agent_started', {
    subtaskId: 'st-2',
    subtaskType: 'analysis',
    agentId: 'a2',
    agentName: 'AgentAnalysis',
    agentTier: 'pro',
    romaLevel: 5,
    description: prompt.slice(0, 240),
    });
    await emit('agent_completed', {
    subtaskId: 'st-2',
    agentId: 'a2',
    agentName: 'AgentAnalysis',
    durationMs: 60,
    outputPreview: `ANALYSIS for: ${prompt.slice(0, 200)}`,
    outputLength: 240,
    via: 'llm',
    model: 'gpt-4o',
    });

    // Multi-agent run → triggers synthesis lifecycle (route requires both
    // synthesis_started AND synthesis_complete to forward the pattern).
    await emit('synthesis_started', {
    agentCount: 2,
    failedCount: 0,
    format: 'markdown',
    language: 'en',
    });
    const synthesized = `Final synthesis for: ${prompt}`;
    await emit('synthesis_complete', {
    length: synthesized.length,
    format: 'markdown',
    language: 'en',
    });

      // Build a properly typed TaskDecomposition + AgentExecution[] so the
      // mock's return value satisfies OrchestrationResult without escape
      // hatches. Values are minimal but realistic.
      const taskDecomposition: TaskDecomposition = {
        originalPrompt: prompt,
        analyzedIntent: 'mock_intent',
        taskType: 'mock_task',
        complexity: 'moderate',
        subtasks: [
          {
            id: 'st-1',
            type: 'research',
            description: prompt.slice(0, 200),
            dependencies: [],
            priority: 1,
            estimatedComplexity: 'moderate',
            requiredCapabilities: [],
            status: 'completed',
          },
          {
            id: 'st-2',
            type: 'analysis',
            description: prompt.slice(0, 200),
            dependencies: [],
            priority: 1,
            estimatedComplexity: 'moderate',
            requiredCapabilities: [],
            status: 'completed',
          },
        ],
        orchestrationPattern: 'parallel',
        estimatedAgents: 2,
        estimatedTime: 100,
        decompositionAlgorithm: 'HTA',
      };
      const now = Date.now();
      const executions: AgentExecution[] = [
        {
          agentId: 'a1',
          agentName: 'AgentResearch',
          subtaskId: 'st-1',
          startTime: now,
          endTime: now + 50,
          status: 'completed',
        },
        {
          agentId: 'a2',
          agentName: 'AgentAnalysis',
          subtaskId: 'st-2',
          startTime: now,
          endTime: now + 60,
          status: 'completed',
        },
      ];

      return {
        success: true,
        taskDecomposition,
        executions,
        synthesizedOutput: synthesized,
        metadata: {
          totalTime: 100,
          totalTokens: { input: 50, output: 100 },
          totalCost: 0.001,
          agentsUsed: 2,
          orchestrationPattern: 'parallel',
        },
      };
    },
  );

  const app: Express = express();
  app.use(express.json());
  app.use('/api/jrx/stream', aguiRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const secret = process.env.JWT_SECRET!;
  // Mint two distinct user JWTs — proves cross-USER isolation, not just
  // cross-request isolation.
  tokenA = jwt.sign(
    { userId: 'user-A-task36', email: 'usera-task36@example.com', role: 'user' },
    secret,
    { expiresIn: '1h' },
  );
  tokenB = jwt.sign(
    { userId: 'user-B-task36', email: 'userb-task36@example.com', role: 'user' },
    secret,
    { expiresIn: '1h' },
  );
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SSE consumer
// ──────────────────────────────────────────────────────────────────────────────

interface ParsedStream {
  raw: string;
  events: Array<Record<string, unknown>>;
}

async function runStream(token: string, task: string): Promise<ParsedStream> {
  const resp = await fetch(`${baseUrl}/api/jrx/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      pattern: 'P11',
      task,
      jurisdiction: 'IN',
      includeThinking: false,
      // Disable citation block — the canned IN citations include "Companies
      // Act 2013" and other generic legal text that has no bearing on the
      // cross-leak invariant we are proving.
      includeCitations: false,
    }),
  });
  expect(resp.status).toBe(200);
  const raw = await resp.text();
  const events: Array<Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice('data: '.length).trim();
    if (data === '[DONE]' || data === '') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* ignore non-JSON SSE lines */
    }
  }
  return { raw, events };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. End-to-end isolation regression
// ──────────────────────────────────────────────────────────────────────────────

describe('AG-UI stream — cross-user event isolation regression (Task #36)', () => {
  it('two concurrent users see only their own task content (zero cross-leak)', async () => {
    const [streamA, streamB] = await Promise.all([
      runStream(tokenA, TASK_A),
      runStream(tokenB, TASK_B),
    ]);

    // ── Each stream contains its OWN keywords ─────────────────────────────
    for (const kw of A_KEYWORDS) {
      expect(streamA.raw, `stream A missing own keyword "${kw}"`).toContain(kw);
    }
    for (const kw of B_KEYWORDS) {
      expect(streamB.raw, `stream B missing own keyword "${kw}"`).toContain(kw);
    }

    // ── Critical invariant: NEITHER stream contains the OTHER's keywords ──
    // Whole-string search across ALL SSE event payloads (including
    // outputPreview, decomposition subtasks, text_delta, run_completed
    // result.answer, etc.). This is what would fail if Queen ever emits
    // a lifecycle event without orchestrationId.
    for (const kw of B_KEYWORDS) {
      expect(streamA.raw, `LEAK: stream A contains stream B keyword "${kw}"`).not.toContain(kw);
    }
    for (const kw of A_KEYWORDS) {
      expect(streamB.raw, `LEAK: stream B contains stream A keyword "${kw}"`).not.toContain(kw);
    }
  }, 30_000);

  it('each stream contains at least one of every Queen lifecycle event type', async () => {
    const [streamA, streamB] = await Promise.all([
      runStream(tokenA, TASK_A),
      runStream(tokenB, TASK_B),
    ]);

    for (const [label, stream] of [['A', streamA], ['B', streamB]] as const) {
      // The AG-UI route maps Queen lifecycle events to AG-UI events:
      //   decomposition_complete → pattern_event subtype="queen_decomposition"
      //   agent_started          → tool_call (tool="agent:<name>")
      //   agent_completed        → tool_result (tool="agent:<name>")
      //   synthesis_started      → pattern_event subtype="synthesis_started"
      //   synthesis_complete     → pattern_event subtype="synthesis_complete"
      const subtypes = new Set(
        stream.events
          .filter((e) => e.type === 'pattern_event')
          .map((e) => e.subtype as string),
      );
      expect(subtypes.has('queen_decomposition'), `stream ${label} missing queen_decomposition`).toBe(true);
      expect(subtypes.has('synthesis_started'), `stream ${label} missing synthesis_started`).toBe(true);
      expect(subtypes.has('synthesis_complete'), `stream ${label} missing synthesis_complete`).toBe(true);

      const agentToolCalls = stream.events.filter(
        (e) => e.type === 'tool_call' && typeof e.tool === 'string' && (e.tool as string).startsWith('agent:'),
      );
      const agentToolResults = stream.events.filter(
        (e) => e.type === 'tool_result' && typeof e.tool === 'string' && (e.tool as string).startsWith('agent:'),
      );
      expect(agentToolCalls.length, `stream ${label} missing agent tool_call events`).toBeGreaterThan(0);
      expect(agentToolResults.length, `stream ${label} missing agent tool_result events`).toBeGreaterThan(0);

      // Every agent tool_call must be paired with a matching tool_result —
      // no half-emitted lifecycle.
      expect(agentToolResults.length).toBe(agentToolCalls.length);
    }
  }, 30_000);
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Architectural source guards (Task #64) — fail CI if a future regression
//    re-introduces the shared-singleton wire that previously could leak
//    lifecycle events between concurrent requests.
// ──────────────────────────────────────────────────────────────────────────────

describe('Queen lifecycle architectural guards (Task #64)', () => {
  // The full set of lifecycle events whose payloads must never traverse the
  // singleton emitter. Hard-coded against `QueenLifecycleEventMap` rather
  // than re-derived from the route source so that "the route stops
  // subscribing entirely" cannot silently disable the guard.
  const LIFECYCLE_EVENTS = [
    'decomposition_complete',
    'agent_started',
    'agent_completed',
    'agent_failed',
    'synthesis_started',
    'synthesis_complete',
  ] as const;

  it('./jrx-queen-orchestrator.ts never calls this.emit / super.emit for a lifecycle event', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const queenSrcPath = path.resolve(here, '../../src/orchestration/jrx-queen-orchestrator.ts');
    const src = readFileSync(queenSrcPath, 'utf8');
    const lines = src.split('\n');

    for (const evt of LIFECYCLE_EVENTS) {
      // Match `this.emit('<evt>', …)` AND `super.emit('<evt>', …)`. Either
      // would dispatch the event on the singleton QueenOrchestrator and
      // re-introduce the cross-request leak surface that Task #64
      // eliminated. `emitLifecycle(request, '<evt>', …)` is the correct
      // path (it routes through `request.lifecycleEvents`).
      const re = new RegExp(`(?:this|super)\\.emit\\(\\s*['"]${evt}['"]`);
      const offending = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => re.test(line));

      expect(
        offending.length,
        offending
          .map(
            ({ idx, line }) =>
              `\n  nv-queen-orchestrator.ts:${idx + 1}: ${line.trim()}`,
          )
          .join('') ||
          '',
      ).toBe(0);
    }

    // And — to make sure the test isn't trivially passing because the file
    // shrank — there must still be at least one `emitLifecycle(request,` per
    // lifecycle event going through the per-request emitter path.
    for (const evt of LIFECYCLE_EVENTS) {
      const re = new RegExp(`emitLifecycle\\(\\s*request\\s*,\\s*['"]${evt}['"]`);
      const found = lines.some((line) => re.test(line));
      expect(
        found,
        `expected emitLifecycle(request, '${evt}', …) in nv-queen-orchestrator.ts — none found. ` +
          `Either the event was removed from the orchestrator or it is being emitted via the singleton; either way the test fixtures and the route's listener for '${evt}' are now stale.`,
      ).toBe(true);
    }
  });

  it('./jrx-agui-stream-routes.ts never subscribes to lifecycle events on the singleton', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const routeSrcPath = path.resolve(here, '../../src/routes/jrx-agui-stream-routes.ts');
    const routeSrc = readFileSync(routeSrcPath, 'utf8');
    const lines = routeSrc.split('\n');

    // Forbidden patterns: any of `queenOrchestrator.on('<lifecycle>', …)`,
    // `queenOrchestrator.once(…)`, `queenOrchestrator.onLifecycle(…)`, or
    // `queenOrchestrator.addListener(…)` for a lifecycle event would
    // re-introduce the global listener growth + cross-leak surface that
    // Task #64 eliminated. The correct pattern is to construct a per-
    // request `QueenLifecycleEmitter`, attach listeners directly on it,
    // and pass it via `OrchestrationRequest.lifecycleEvents`.
    for (const evt of LIFECYCLE_EVENTS) {
      const re = new RegExp(
        `queenOrchestrator\\.(on|once|onLifecycle|addListener)\\(\\s*['"]${evt}['"]`,
      );
      const offending = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => re.test(line));

      expect(
        offending.length,
        offending
          .map(
            ({ idx, line }) =>
              `\n  nv-agui-stream-routes.ts:${idx + 1}: ${line.trim()}`,
          )
          .join('') ||
          '',
      ).toBe(0);
    }

    // And — guard against the route accidentally dropping its listener
    // wiring entirely — there must be at least one `queenEvents.on('<evt>'` /
    // equivalent per-request subscription per lifecycle event the route
    // forwards. We auto-derive the set the route subscribes to from any
    // identifier ending in `Events` to remain robust against renames.
    const perReqSubscribeRe = /[A-Za-z_][A-Za-z0-9_]*Events\.on\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
    const perReqSubscribed = new Set(
      Array.from(routeSrc.matchAll(perReqSubscribeRe), (m) => m[1]),
    );
    expect(
      perReqSubscribed.size,
      'No per-request emitter subscriptions (`<...>Events.on(\'<evt>\', …)`) discovered in nv-agui-stream-routes.ts — ' +
        'the route appears to have stopped wiring lifecycle events through the per-request emitter. ' +
        'Without per-request subscriptions the AG-UI stream cannot forward Queen lifecycle progress to clients.',
    ).toBeGreaterThan(0);
  });
});
