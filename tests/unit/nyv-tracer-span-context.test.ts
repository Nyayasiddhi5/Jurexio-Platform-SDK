/**
 * Tracer span-context regression — Task #61 (NYV-OBS-SPAN-CONTEXT-001).
 *
 * The orchestration root span used to be carried on the request as an
 * untyped `__rootSpan` extension property so that nested per-agent spans
 * deep inside `executeOrchestration()` could read it back and parent
 * themselves under it. A future code path that emitted a per-agent span
 * without copying that property silently turned every per-agent span into
 * an orphan span on the dashboard, with no compile-time signal that
 * anything had regressed.
 *
 * The fix: the tracer keeps the "current span" in an AsyncLocalStorage
 * that propagates through async/await and Promise.all branches, so
 * `startSpan()` / `withSpan()` auto-parent to the enclosing run's root
 * span without callers having to thread the span object through every
 * function signature. This suite locks in the three guarantees that
 * make the regression class impossible.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  startSpan,
  withSpan,
  runWithSpan,
  runWithRunRoot,
  getCurrentSpan,
  getRunRootSpan,
  _resetSpanLatencies,
} from '../../src/utils/nyv-tracer.js';

beforeEach(() => {
  _resetSpanLatencies();
});

describe('nyv-tracer — auto-parenting via AsyncLocalStorage', () => {
  it('startSpan() with no current ALS span produces a fresh root span', () => {
    const s = startSpan('orphan');
    expect(s.parentId).toBeUndefined();
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    s.finish('ok');
  });

  it('startSpan() inside runWithSpan() auto-parents to the ALS span', () => {
    const root = startSpan('root');
    runWithSpan(root, () => {
      const child = startSpan('child');
      expect(child.parentId).toBe(root.spanId);
      expect(child.traceId).toBe(root.traceId);
      child.finish('ok');
    });
    root.finish('ok');
  });

  it('explicit opts.parent still wins over the ALS current span', () => {
    const ambient = startSpan('ambient');
    const explicit = startSpan('explicit');
    runWithSpan(ambient, () => {
      const child = startSpan('child', { parent: explicit });
      expect(child.parentId).toBe(explicit.spanId);
      expect(child.traceId).toBe(explicit.traceId);
      child.finish('ok');
    });
    explicit.finish('ok');
    ambient.finish('ok');
  });

  it('withSpan() installs the new span as the current ALS span for fn', async () => {
    const root = startSpan('root');
    await runWithSpan(root, async () => {
      await withSpan('phase', { op: 'phase' }, async (phase) => {
        expect(getCurrentSpan()?.spanId).toBe(phase.spanId);
        const grandchild = startSpan('grandchild');
        expect(grandchild.parentId).toBe(phase.spanId);
        expect(grandchild.traceId).toBe(root.traceId);
        grandchild.finish('ok');
      });
    });
    root.finish('ok');
  });

  it('per-agent spans created across Promise.all branches all parent to the root', async () => {
    const root = startSpan('queen.orchestrate');
    const parents = await runWithSpan(root, async () => {
      // Simulates parallel `executeAgent()` dispatch: each branch enters
      // a fresh async context but inherits the same current ALS span.
      return Promise.all(
        ['a', 'b', 'c'].map(async (id) => {
          await new Promise((r) => setImmediate(r));
          const agentSpan = startSpan(`queen.agent:${id}`);
          const parentId = agentSpan.parentId;
          agentSpan.finish('ok');
          return parentId;
        }),
      );
    });
    expect(parents).toEqual([root.spanId, root.spanId, root.spanId]);
    root.finish('ok');
  });

  it('getCurrentSpan() returns undefined outside any runWithSpan scope', () => {
    expect(getCurrentSpan()).toBeUndefined();
    const root = startSpan('root');
    runWithSpan(root, () => {
      expect(getCurrentSpan()?.spanId).toBe(root.spanId);
    });
    expect(getCurrentSpan()).toBeUndefined();
    root.finish('ok');
  });
});

describe('nyv-tracer — run-root span context for direct-to-root parenting', () => {
  it('getRunRootSpan() returns undefined outside any runWithRunRoot scope', () => {
    expect(getRunRootSpan()).toBeUndefined();
  });

  it('getRunRootSpan() returns the pinned root from anywhere inside the run', async () => {
    const root = startSpan('queen.orchestrate');
    await runWithRunRoot(root, async () => {
      expect(getRunRootSpan()?.spanId).toBe(root.spanId);
      // Even nested inside an unrelated phase span (which DOES change
      // the ambient current span), the run root stays pinned.
      await withSpan('queen.execute', { op: 'queen.execute' }, async (phase) => {
        expect(getCurrentSpan()?.spanId).toBe(phase.spanId);
        expect(getRunRootSpan()?.spanId).toBe(root.spanId);
      });
    });
    root.finish('ok');
  });

  it('per-agent spans pinned to getRunRootSpan() parent to the run root, not the enclosing phase', async () => {
    // Mirrors the orchestrator: queen.orchestrate wraps the body, an
    // intermediate queen.execute phase span is the ambient current span,
    // and per-agent spans inside it must still attach DIRECTLY to
    // queen.orchestrate (preserving the original __rootSpan contract).
    const root = startSpan('queen.orchestrate');
    let agentParentId: string | undefined;
    let phaseSpanId: string | undefined;
    await runWithRunRoot(root, () =>
      runWithSpan(root, async () => {
        await withSpan('queen.execute', { op: 'queen.execute' }, async (phase) => {
          phaseSpanId = phase.spanId;
          await withSpan(
            'queen.agent',
            { op: 'queen.agent', parent: getRunRootSpan() },
            async (agent) => {
              agentParentId = agent.parentId;
              expect(agent.traceId).toBe(root.traceId);
            },
          );
        });
      }),
    );
    expect(agentParentId).toBe(root.spanId);
    expect(agentParentId).not.toBe(phaseSpanId);
    root.finish('ok');
  });

  it('runWithRunRoot does NOT change the ambient current span', () => {
    const root = startSpan('root');
    runWithRunRoot(root, () => {
      // ambient current span is untouched — only runWithSpan installs that.
      expect(getCurrentSpan()).toBeUndefined();
      expect(getRunRootSpan()?.spanId).toBe(root.spanId);
    });
    root.finish('ok');
  });
});
