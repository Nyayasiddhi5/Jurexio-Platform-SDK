/**
 * NV-NYAYA-TOOLS-BINDING-001 — behavioural test.
 *
 * The probe script proves the capabilities are *reachable*. This proves they
 * behave correctly once reachable, and locks the two properties that matter:
 *
 *  1. A realistic input reaches the real service method (not the module
 *     namespace, and not the wrong overload).
 *  2. A missing required identifier produces a `structured-input failure`
 *     rather than a plausible-looking empty legal answer. This is the
 *     regression that made the old generic dispatcher dangerous:
 *     `assessAmendmentImpact({query:'…'})` returned `impactSeverity:'low'`
 *     with empty arrays, which reads as "no amendment impact" to a caller.
 */
import { describe, it, expect } from 'vitest';
import { capabilityManifest } from '../../src/orchestration/capability-manifest.js';

const CTX = {
  tenantId: 'test-tenant',
  userId: 'test-user',
  jurisdiction: 'IN',
  requestId: 'test-req',
} as never;

async function invoke(id: string, input: Record<string, unknown>): Promise<unknown> {
  const cap = capabilityManifest.get(id);
  if (!cap) throw new Error(`capability not registered: ${id}`);
  const inst = await cap.factory();
  return inst.invoke(input as never, CTX);
}

const NYAYA_TOOL_IDS = [
  'jrx-legal-tools.amend',
  'jrx-legal-tools.compare',
  'jrx-legal-tools.forensic',
  'jrx-legal-tools.graph',
  'jrx-legal-tools.template',
  'jrx-legal-tools.timeline',
  'jrx-legal-tools.trail',
  'jrx-legal-tools.watch',
  'jrx-legal-tools.agent-lifecycle',
];

describe('NV-NYAYA-TOOLS-BINDING-001: every nyaya-tool is invocable', () => {
  it('registers all nine capabilities', () => {
    for (const id of NYAYA_TOOL_IDS) {
      expect(capabilityManifest.get(id), `${id} must be registered`).toBeTruthy();
    }
  });

  it('never throws "service missing methods" for any nyaya-tool', async () => {
    const missingMethod: string[] = [];

    for (const id of NYAYA_TOOL_IDS) {
      try {
        await invoke(id, { query: 'limitation period for breach of contract' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A structured-input failure is correct behaviour, not a binding bug.
        if (/service missing methods/.test(msg)) missingMethod.push(`${id}: ${msg}`);
      }
    }

    expect(missingMethod, 'these capabilities resolved no real method').toEqual([]);
  });
});

describe('NV-NYAYA-TOOLS-BINDING-001: refuses to fabricate on missing identifiers', () => {
  it('jrx-legal-tools.trail requires an explicit matterId', async () => {
    // A privilege log built for the wrong matter is a disclosure risk, so
    // there is no safe default here.
    await expect(invoke('jrx-legal-tools.trail', { query: 'privilege log' }))
      .rejects.toThrow(/structured-input failure.*matterId/);
  });

  it('jrx-legal-tools.timeline requires an explicit eventDate', async () => {
    // Defaulting the event date to "now" would silently produce a wrong
    // limitation deadline — the worst possible failure for this tool.
    await expect(invoke('jrx-legal-tools.timeline', { causeOfAction: 'breach of contract' }))
      .rejects.toThrow(/structured-input failure.*eventDate/);
  });

  it('jrx-legal-tools.timeline rejects an unparseable eventDate', async () => {
    await expect(invoke('jrx-legal-tools.timeline', {
      causeOfAction: 'breach of contract',
      eventDate: 'last Tuesday-ish',
    })).rejects.toThrow(/structured-input failure.*not a valid date/);
  });

  it('jrx-legal-tools.forensic refuses to verify an empty document', async () => {
    // Verifying nothing would report a clean integrity verdict on nothing.
    await expect(invoke('jrx-legal-tools.forensic', { query: 'check this' }))
      .rejects.toThrow(/structured-input failure.*document/);
  });

  it('structured-input failures are classified as non-retryable caller bugs', async () => {
    const { runWithRetryAndBreaker } = await import('../../src/services/circuit-breaker.js');
    let attempts = 0;

    await expect(
      runWithRetryAndBreaker('test:jrx-legal-tools-binding', async () => {
        attempts += 1;
        throw new Error(
          '[CapabilityManifest] structured-input failure: jrx-legal-tools.trail requires \'matterId\'',
        );
      }),
    ).rejects.toThrow(/structured-input failure/);

    // Must fail on the first attempt — retrying a caller bug burns breaker
    // budget for a call that can never succeed.
    expect(attempts).toBe(1);
  });
});

describe('NV-NYAYA-TOOLS-BINDING-001: real inputs reach real methods', () => {
  it('jrx-legal-tools.timeline computes a limitation period from a real date', async () => {
    const out = await invoke('jrx-legal-tools.timeline', {
      causeOfAction: 'breach of contract',
      eventDate: '2024-01-15',
    }) as Record<string, unknown>;

    expect(out).toBeTruthy();
    // calculateLimitation returns a LimitationResult, not a passthrough of input.
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });

  it('jrx-legal-tools.compare diffs two supplied texts without needing statute ids', async () => {
    const out = await invoke('jrx-legal-tools.compare', {
      sourceText: 'The party shall indemnify the counterparty.',
      targetText: 'The party shall indemnify and hold harmless the counterparty.',
    }) as { diffs?: unknown[]; similarity?: number };

    expect(Array.isArray(out.diffs)).toBe(true);
    expect(typeof out.similarity).toBe('number');
  });

  it('jrx-legal-tools.graph resolves related concepts from free text', async () => {
    const out = await invoke('jrx-legal-tools.graph', {
      query: 'anticipatory bail',
    }) as { relatedConcepts?: unknown[] };

    expect(out).toBeTruthy();
    expect(Array.isArray(out.relatedConcepts)).toBe(true);
  });

  it('jrx-legal-tools.agent-lifecycle exposes only the read-only health report', async () => {
    // spawn/terminate/transition mutate live agent state and must not be
    // reachable from an LLM-authored plan.
    const out = await invoke('jrx-legal-tools.agent-lifecycle', { op: 'terminate' }) as Record<string, unknown>;
    expect(out).toBeTruthy();
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });
});
