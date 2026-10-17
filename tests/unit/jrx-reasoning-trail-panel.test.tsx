/**
 * @vitest-environment jsdom
 * * NV-REASONING-TRAIL-001 — guards on the reasoning-trail panel.
 *
 * The fixtures are NOT hand-written from a spec: they are the JSON that
 * `src/orchestration/jrx-quality-envelope.ts` actually emitted when driven
 * through `createQualityEnvelope → markIngressGates → markSafetyRingGates →
 * markResponseAndAudit → snapshotQualityEnvelope` (probe run 2026-08-19).
 * Keeping the executed output here is what makes these assertions about the
 * platform rather than about a description of it.
 *
 * Every `it` below is designed to go red if the corresponding guard in
 * `client/src/lib/jrx-reasoning-trail.ts` is removed — see the ledger entry for
 * the mutation list that was run to prove it.
 */
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { ReasoningTrailPanel } from '../../client/src/components/execution/ReasoningTrailPanel';
import {
  buildTrailStages,
  readAuthorities,
  resolveStageState,
  type NvQualityEnvelope,
  type NvReasoningTrailSource,
} from '../../client/src/lib/jrx-reasoning-trail';

/* Rendered with react-dom directly rather than @testing-library/react: that
 * package's `@testing-library/dom` peer is not installed in this tree, so every
 * `tests/console/*.test.tsx` suite currently fails to collect. Adding the dep
 * would mean rewriting the shared lockfile, so these tests carry their own
 * 20-line harness instead of importing a broken one. */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderPanel(ui: React.ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
}

function byTestId(scope: HTMLElement, id: string): HTMLElement {
  const el = scope.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  return el;
}

function queryByTestId(scope: HTMLElement, id: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function allByTestId(scope: HTMLElement, id: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
}

function text(scope: HTMLElement, id: string): string {
  return byTestId(scope, id).textContent ?? '';
}

/** Probe output: partner-lean run, three optional stages scaled off, ok=true. */
const BUDGET_ENVELOPE: NvQualityEnvelope = {
  requestId: 'probe-budget-scaled-off',
  path: 'specialist',
  partnerLean: true,
  risk: 'medium',
  completed: [
    'identity', 'consent_credits', 'task_classify', 'jurisdiction_prompts', 'pii',
    'compliance_precheck', 'rag_grounding', 'llm_route_budget', 'hallucination',
    'citation', 'bias', 'response_format', 'metering_audit',
  ],
  scaledOptional: ['cot', 'maker_checker', 'hitl'],
  missingMandatory: [],
  ok: true,
  failClosed: true,
  steps: [
    { id: 'identity', status: 'completed', note: 'ingress', at: '2026-08-19T17:33:38.905Z' },
    { id: 'consent_credits', status: 'completed', note: 'ingress', at: '2026-08-19T17:33:38.905Z' },
    { id: 'task_classify', status: 'completed', note: 'ingress', at: '2026-08-19T17:33:38.905Z' },
    { id: 'jurisdiction_prompts', status: 'completed', note: 'ingress', at: '2026-08-19T17:33:38.905Z' },
    { id: 'pii', status: 'completed', note: 'safety-ring', at: '2026-08-19T17:33:38.905Z' },
    { id: 'compliance_precheck', status: 'completed', note: 'safety-ring', at: '2026-08-19T17:33:38.905Z' },
    {
      id: 'rag_grounding',
      status: 'completed',
      note: 'RAG intentionally skipped (partner lean / cost path)',
      at: '2026-08-19T17:33:38.905Z',
    },
    { id: 'llm_route_budget', status: 'completed', at: '2026-08-19T17:33:38.905Z' },
    { id: 'hallucination', status: 'completed', at: '2026-08-19T17:33:38.905Z' },
    { id: 'citation', status: 'completed', at: '2026-08-19T17:33:38.905Z' },
    { id: 'bias', status: 'completed', note: 'bias gate', at: '2026-08-19T17:33:38.905Z' },
    { id: 'cot', status: 'skipped_scaled', note: 'not required for this risk', at: '2026-08-19T17:33:38.905Z' },
    { id: 'maker_checker', status: 'skipped_scaled', note: 'lean skips Queen maker-checker', at: '2026-08-19T17:33:38.905Z' },
    { id: 'hitl', status: 'skipped_scaled', at: '2026-08-19T17:33:38.905Z' },
    { id: 'response_format', status: 'completed', at: '2026-08-19T17:33:38.905Z' },
    { id: 'metering_audit', status: 'completed', at: '2026-08-19T17:33:38.905Z' },
  ],
};

/** Probe output: citation gate failed, HITL deferred, ok=false. `steps[]` is
 *  truncated to the three interesting records on purpose so the record-less
 *  fallback path is exercised alongside the record path. */
const FAILED_ENVELOPE: NvQualityEnvelope = {
  requestId: 'probe-citation-gate-failed',
  path: 'specialist',
  partnerLean: false,
  risk: 'medium',
  completed: [
    'identity', 'consent_credits', 'task_classify', 'jurisdiction_prompts', 'pii',
    'compliance_precheck', 'rag_grounding', 'llm_route_budget', 'hallucination', 'bias',
    'cot', 'maker_checker', 'hitl', 'response_format', 'metering_audit',
  ],
  scaledOptional: [],
  missingMandatory: ['citation'],
  ok: false,
  failClosed: true,
  steps: [
    { id: 'identity', status: 'completed', note: 'ingress', at: '2026-08-19T17:33:38.905Z' },
    { id: 'citation', status: 'failed', at: '2026-08-19T17:33:38.905Z' },
    { id: 'hitl', status: 'deferred', note: 'HITL queue may be async', at: '2026-08-19T17:33:38.905Z' },
  ],
};

function source(over: Partial<NvReasoningTrailSource> = {}): NvReasoningTrailSource {
  return {
    qualityEnvelope: BUDGET_ENVELOPE,
    routing: { path: 'specialist', reason: 'processed', complexity: 'moderate', risk: 'medium' },
    layersUsed: ['unified-base', 'nys_global', 'adaptive'],
    trust: { grounded: true, citationsPresent: true, authoritiesDelivered: 3, qualityOk: true, compliancePassed: true },
    riskBadge: 'YELLOW',
    auditHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    chainOfThought: { steps: ['a', 'b'] },
    ...over,
  };
}

function statesOf(envelope: NvQualityEnvelope): Record<string, string> {
  return Object.fromEntries(buildTrailStages(envelope).map((s) => [s.id, s.state]));
}

describe('reasoning trail — scaled-off is neither a pass nor a failure', () => {
  it('does not resolve a scaled-off optional stage to passed or failed', () => {
    const states = statesOf(BUDGET_ENVELOPE);
    for (const id of ['cot', 'maker_checker', 'hitl']) {
      expect(states[id]).toBe('scaled_off');
    }
  });

  it('renders zero passed rows for the three scaled-off stages', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source()} defaultOpen />);
    const list = byTestId(c, 'trail-stage-list');
    // 16 canonical gates, 13 completed + 3 scaled off — a UI showing 16 ticks lies.
    expect(allByTestId(list, 'trail-stage-passed')).toHaveLength(13);
    expect(allByTestId(list, 'trail-stage-scaled_off')).toHaveLength(3);
    expect(allByTestId(list, 'trail-stage-failed')).toHaveLength(0);
    expect(text(c, 'trail-counts')).toMatch(/13 completed · 3 scaled off/);
  });

  it('never lets scaledOptional fall through to the completed[] tick fallback', () => {
    // Record-less envelope: only the summary arrays. `hitl` is in BOTH lists on
    // some legacy payloads; scaled-off must win.
    const state = resolveStageState('hitl', {
      completed: ['hitl'],
      scaledOptional: ['hitl'],
    });
    expect(state).toBe('scaled_off');
  });
});

describe('reasoning trail — mandatory failures are shown as failures', () => {
  it('resolves a missingMandatory gate to missing_mandatory, not passed', () => {
    expect(resolveStageState('citation', FAILED_ENVELOPE)).toBe('missing_mandatory');
  });

  it('surfaces an explicit do-not-rely warning for an unmet mandatory gate', () => {
    const c = renderPanel(
      <ReasoningTrailPanel source={source({ qualityEnvelope: FAILED_ENVELOPE })} defaultOpen />,
    );
    expect(text(c, 'trail-mandatory-alert')).toMatch(/1 mandatory gate unmet/i);
    expect(allByTestId(byTestId(c, 'trail-stage-list'), 'trail-stage-missing_mandatory'))
      .toHaveLength(1);
  });

  it('does not tick a deferred HITL even though the server folds it into completed[]', () => {
    // snapshotQualityEnvelope() pushes `deferred` records into `completed[]`;
    // trusting that array would report an async review as signed off.
    expect(FAILED_ENVELOPE.completed).toContain('hitl');
    expect(resolveStageState('hitl', FAILED_ENVELOPE)).toBe('deferred');
  });

  it('renders a mandatory gate with no evidence anywhere as not captured, never passed', () => {    // Neither a record nor a mention in completed[] — an older/truncated
    // envelope. `completed[]` legitimately ticks a gate when it names one; the
    // guard under test is that SILENCE does not.
    const states = statesOf({
      ...FAILED_ENVELOPE,
      completed: FAILED_ENVELOPE.completed!.filter((id) => id !== 'pii'),
    });
    expect(states.pii).toBe('not_captured');
    expect(states.pii).not.toBe('passed');
  });
});

describe('reasoning trail — fail-closed posture', () => {
  it('surfaces armed fail-closed enforcement', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source()} />);
    expect(text(c, 'trail-fail-closed')).toMatch(/Fail-closed: armed/);
  });

  it('says advisory, not armed, when the platform would degrade instead of refusing', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source({
      qualityEnvelope: { ...BUDGET_ENVELOPE, failClosed: false },
    })} />);
    expect(text(c, 'trail-fail-closed')).toMatch(/not armed/i);
    expect(text(c, 'trail-fail-closed')).not.toMatch(/Fail-closed: armed/);
  });

  it('escalates when enforcement is armed and a mandatory gate is unmet', () => {
    const c = renderPanel(
      <ReasoningTrailPanel source={source({ qualityEnvelope: FAILED_ENVELOPE })} />,
    );
    expect(text(c, 'trail-fail-closed')).toMatch(/mandatory gate missing/i);
  });
});

describe('reasoning trail — authorities over citationsPresent', () => {
  it('does not claim citations are present when zero authorities were delivered', () => {
    // Pre-NV-CITE-GROUND-001 payloads returned citationsPresent:true with none.
    const c = renderPanel(<ReasoningTrailPanel source={source({
      trust: { grounded: true, citationsPresent: true, authoritiesDelivered: 0 },
    })} />);
    expect(text(c, 'trail-authorities')).toMatch(/No authorities delivered/i);
    expect(text(c, 'trail-authorities')).not.toMatch(/\bcitations present\b/i);
    expect(readAuthorities({ citationsPresent: true, authoritiesDelivered: 0 }).present).toBe(false);
  });

  it('prefers the count when one is delivered', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source()} />);
    expect(text(c, 'trail-authorities')).toMatch(/3 authorities delivered/);
  });

  it('admits the count is unknown rather than trusting the boolean', () => {
    const readout = readAuthorities({ citationsPresent: true });
    expect(readout.unknown).toBe(true);
    expect(readout.present).toBe(false);
    const c = renderPanel(
      <ReasoningTrailPanel source={source({ trust: { citationsPresent: true } })} />,
    );
    expect(text(c, 'trail-authorities')).toMatch(/not captured/i);
  });
});

describe('reasoning trail — layers and route reason', () => {
  it('flags that no corpus was consulted when unified-base is the only layer', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source({ layersUsed: ['unified-base'] })} />);
    expect(text(c, 'trail-layers')).toMatch(/Caselaw corpus not consulted/i);
  });

  it('does not flag corpus absence when a knowledge layer ran', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source()} />);
    expect(text(c, 'trail-layers')).not.toMatch(/not consulted/i);
    expect(text(c, 'trail-layers')).toMatch(/nys_global/);
  });

  it('reports a sanitised route reason as withheld instead of as reasoning', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source()} />);
    expect(text(c, 'trail-routing-reason')).toMatch(/sanitised/i);
  });

  it('shows a real route reason when diagnostics are exposed', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source({
      routing: { reason: 'high-risk drafting → queen', complexity: 'complex' },
    })} />);
    expect(text(c, 'trail-routing-reason')).toMatch(/high-risk drafting → queen/);
  });
});

describe('reasoning trail — graceful degradation', () => {
  it('renders "not captured" without throwing when the envelope is absent', () => {
    let c!: HTMLElement;
    expect(() => { c = renderPanel(<ReasoningTrailPanel source={null} />); }).not.toThrow();
    expect(byTestId(c, 'reasoning-trail-panel').getAttribute('data-trail-state'))
      .toBe('not-captured');
    expect(text(c, 'trail-not-captured')).toMatch(/not a pass/i);
    expect(queryByTestId(c, 'trail-stage-passed')).toBeNull();
  });

  it('does not throw on an empty-object envelope and shows no ticks', () => {
    let c!: HTMLElement;
    expect(() => {
      c = renderPanel(<ReasoningTrailPanel source={{ qualityEnvelope: {} }} />);
    }).not.toThrow();
    expect(queryByTestId(c, 'trail-stage-passed')).toBeNull();
  });

  it('renders a partial envelope without inventing passes', () => {
    const c = renderPanel(<ReasoningTrailPanel source={{
      qualityEnvelope: { steps: [{ id: 'pii', status: 'completed' }], ok: true },
    }} defaultOpen />);
    const list = byTestId(c, 'trail-stage-list');
    expect(allByTestId(list, 'trail-stage-passed')).toHaveLength(1);
    expect(allByTestId(list, 'trail-stage-not_captured')).toHaveLength(15);
  });

  it('reports absent chainOfThought as not captured', () => {
    const c = renderPanel(<ReasoningTrailPanel source={source({ chainOfThought: undefined })} />);
    expect(text(c, 'trail-cot')).toMatch(/Not captured/i);
  });

  it('resolves every stage to not_captured for a null / undefined envelope', () => {
    // Direct call: the panel short-circuits on `!hasEnvelope` before reaching
    // this branch, so without this assertion a mutation turning the guard into
    // `return 'passed'` survives the whole suite (it did, on the first run).
    for (const id of ['pii', 'citation', 'cot']) {
      expect(resolveStageState(id, null)).toBe('not_captured');
      expect(resolveStageState(id, undefined)).toBe('not_captured');
    }
    expect(buildTrailStages(null).every((s) => s.state === 'not_captured')).toBe(true);
  });

  it('keeps an unrecognised server stage visible instead of dropping it', () => {
    const states = statesOf({
      steps: [{ id: 'new_future_gate', status: 'failed' }],
      missingMandatory: [],
    });
    expect(states.new_future_gate).toBe('failed');
  });
});
