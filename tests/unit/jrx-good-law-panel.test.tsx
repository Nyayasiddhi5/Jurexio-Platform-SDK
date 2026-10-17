/**
 * @vitest-environment jsdom
 *
 * NV-GOOD-LAW-PANEL-001 — guards on the lawyer-facing good-law panel.
 *
 * The verdict fixtures below are NOT written from the spec: they are the JSON
 * `src/services/jrx-citator-treatment.ts` actually emitted when driven through
 * `detectNegativeTreatment` (probe run 2026-08-19, `scripts/_nv-good-law-probe.ts`,
 * positive control 5150). The `authority` blocks match the shape
 * `resolveAuthority` returns in `src/routes/jrx-knowledge-plane-routes.ts`.
 *
 * Every `it` is designed to go red if the corresponding guard is removed — the
 * mutation list that was run to prove it is in the ledger entry.
 *
 * Rendered with react-dom directly rather than @testing-library/react: that
 * package's `@testing-library/dom` peer is not installed in this tree, so every
 * `tests/console` tsx suite fails to collect. Same 20-line harness as
 * `nv-reasoning-trail-panel.test.tsx`.
 */
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { GoodLawPanel } from '../../client/src/components/execution/GoodLawPanel';
import { ExecutionTraceRail } from '../../client/src/components/execution/ExecutionTraceRail';
import {
  readCoverage,
  readExtractedBy,
  readGoodLaw,
  readResolution,
  type NvTreatmentPayload,
} from '../../client/src/lib/jrx-good-law';

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

/** Probe output: two scanned passages, one overruling. */
const OVERRULED: NvTreatmentPayload = {
  authority: {
    citation: 'ADM Jabalpur v. Shivkant Shukla',
    title: 'ADDITIONAL DISTRICT MAGISTRATE JABALPUR versus SHIVKANT SHUKLA',
    court: 'Supreme Court of India',
    year: '1976',
    matchedCitation: 'AIR 1976 SC 1207',
    resolution: {
      matched: true,
      confidence: 0.8,
      method: 'all-tokens-in-title',
      exactModeRequested: false,
    },
  },
  direction: 'citing',
  goodLaw: 'overruled',
  treatments: [
    {
      citation: '(2017) 10 SCC 1',
      treatment: 'overruled',
      confidence: 0.82,
      paragraph: 'The view taken in ADM Jabalpur stands overruled by this Court.',
      extractedBy: 'deterministic',
    },
    {
      citation: '(2012) 6 SCC 613',
      treatment: 'followed',
      confidence: 0.65,
      paragraph: 'We respectfully follow the ratio in Maneka Gandhi.',
      extractedBy: 'deterministic',
    },
  ],
  coverage: { passagesScanned: 2, corpusCoveragePct: 70.4, retrievalLimited: true },
  limitations: 'Deterministic phrase extraction over retrieved passages. Not a citation graph.',
};

/** Probe output: authority resolved, nothing adverse found. The common case. */
const UNKNOWN: NvTreatmentPayload = {
  authority: {
    citation: 'Maneka Gandhi v. Union of India',
    title: 'MANEKA GANDHI versus UNION OF INDIA',
    court: 'Supreme Court of India',
    year: '1978',
    matchedCitation: '(1978) 1 SCC 248',
    resolution: {
      matched: true,
      confidence: 0.95,
      method: 'exact-citation',
      exactModeRequested: false,
    },
  },
  direction: 'citing',
  goodLaw: 'unknown',
  treatments: [],
  coverage: { passagesScanned: 1, corpusCoveragePct: 70.4, retrievalLimited: false },
  unknownReason: 'no_treatment_language_found',
};

/** The partner's mislabelling case: the endpoint could not identify the authority. */
const UNRESOLVED: NvTreatmentPayload = {
  authority: {
    citation: 'Kesavananda Bharati v. State of Kerala',
    title: null,
    court: null,
    year: null,
    matchedCitation: null,
    resolution: {
      matched: false,
      confidence: 0,
      method: 'unresolved',
      exactModeRequested: false,
    },
  },
  direction: 'citing',
  goodLaw: 'unknown',
  treatments: [],
  coverage: { passagesScanned: 20, corpusCoveragePct: 70.4, retrievalLimited: true },
  unknownReason: 'authority_not_identified',
};

describe('good law — `unknown` never renders as safe', () => {
  it('labels unknown as "not cleared" and never as good law', () => {
    const c = renderPanel(<GoodLawPanel citation="Maneka Gandhi v. Union of India" payload={UNKNOWN} />);
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('unknown');
    expect(text(c, 'good-law-headline')).toMatch(/not cleared/i);
    expect(text(c, 'good-law-headline')).not.toMatch(/\bgood law\b/i);
    expect(text(c, 'good-law-detail')).toMatch(/NOT a finding that the authority is good law/i);
  });

  it('does not share the adverse palette with an overruled verdict', () => {
    // Colour is the whole signal for a scanning eye: `unknown` must be distinct
    // from BOTH an adverse finding and anything reassuring.
    expect(readGoodLaw(UNKNOWN).severity).toBe('unknown');
    expect(readGoodLaw(OVERRULED).severity).toBe('adverse');
    expect(readGoodLaw(UNKNOWN).adverse).toBe(false);
    expect(readGoodLaw(OVERRULED).adverse).toBe(true);
  });

  it('renders a verdict block for unknown rather than omitting the panel', () => {
    // A silent omission reads as "safe". The block must exist.
    const c = renderPanel(<GoodLawPanel citation="X" payload={UNKNOWN} />);
    expect(queryByTestId(c, 'good-law-headline')).not.toBeNull();
  });

  it('treats the unreachable `good` verdict as unverifiable, never as a clearance', () => {
    /* `good` cannot be produced by detectNegativeTreatment (absence of adverse
     * language in a bounded retrieval is not evidence of good law). If it ever
     * appears it is contract drift, and must not become a green tick. */
    const v = readGoodLaw({ ...UNKNOWN, goodLaw: 'good' });
    expect(v.state).toBe('unverifiable');
    expect(v.adverse).toBe(false);
    expect(v.headline).toMatch(/not cleared/i);
    const c = renderPanel(<GoodLawPanel citation="X" payload={{ ...UNKNOWN, goodLaw: 'good' }} />);
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('unverifiable');
  });

  it('treats an unrecognised future verdict as unverifiable, not as passed', () => {
    expect(readGoodLaw({ ...UNKNOWN, goodLaw: 'affirmed_by_larger_bench' }).state)
      .toBe('unverifiable');
  });

  it('reports "not checked" — not "good law" — before any check has run', () => {
    const c = renderPanel(<GoodLawPanel citation="Maneka Gandhi v. Union of India" payload={null} />);
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('not_checked');
    expect(text(c, 'good-law-detail')).toMatch(/not a statement that it is good law/i);
  });
});

describe('good law — coverage is always visible', () => {
  it('renders coverage on an adverse verdict', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={OVERRULED} />);
    expect(text(c, 'good-law-coverage-headline')).toMatch(/2 passages scanned/);
    expect(text(c, 'good-law-coverage-headline')).toMatch(/70\.4% of the India corpus/);
    expect(text(c, 'good-law-coverage-headline')).toMatch(/retrieval capped/);
  });

  it('renders coverage on an unknown verdict, where it matters most', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={UNKNOWN} />);
    expect(text(c, 'good-law-coverage-headline')).toMatch(/1 passage scanned/);
    expect(text(c, 'good-law-coverage-detail')).toMatch(/adverse treatment could exist/i);
  });

  it('renders coverage even when the payload omits the coverage block', () => {
    // A `coverage && <Coverage/>` guard would hide exactly the case where we
    // know least, so the readout must be renderable for every input.
    const c = renderPanel(<GoodLawPanel citation="X" payload={{ ...UNKNOWN, coverage: undefined }} />);
    expect(text(c, 'good-law-coverage-headline')).toMatch(/not reported/i);
    expect(readCoverage(undefined).weak).toBe(true);
  });

  it('is not behind the expander — coverage renders with treatment rows collapsed', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={OVERRULED} />);
    act(() => {
      byTestId(c, 'good-law-rows-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(queryByTestId(c, 'good-law-rows')).toBeNull();
    expect(queryByTestId(c, 'good-law-coverage-headline')).not.toBeNull();
  });

  it('calls a capped retrieval weak even at 100% corpus coverage', () => {
    // 100% embedded still means "nothing in the 20 passages we read".
    expect(readCoverage({ passagesScanned: 20, corpusCoveragePct: 100, retrievalLimited: true }).weak)
      .toBe(true);
  });
});

describe('good law — extractedBy is visible per row', () => {
  it('renders one provenance chip per treatment row', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={OVERRULED} />);
    const rows = allByTestId(c, 'good-law-row');
    expect(rows).toHaveLength(2);
    expect(allByTestId(c, 'good-law-row-extracted-by')).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-extracted-by')).toBe('deterministic');
    }
  });

  it('gives an LLM row a different label from a deterministic one', () => {
    const llm: NvTreatmentPayload = {
      ...OVERRULED,
      treatments: [
        { ...OVERRULED.treatments![0]!, extractedBy: 'llm' },
        OVERRULED.treatments![1]!,
      ],
    };
    const c = renderPanel(<GoodLawPanel citation="X" payload={llm} />);
    const labels = allByTestId(c, 'good-law-row-extracted-by').map((e) => e.textContent);
    expect(labels[0]).toMatch(/AI-suggested/i);
    expect(labels[1]).toMatch(/Verified phrase/i);
    expect(labels[0]).not.toBe(labels[1]);
    expect(readExtractedBy('llm').reproducible).toBe(false);
    expect(readExtractedBy('deterministic').reproducible).toBe(true);
  });

  it('does not default an unlabelled row to deterministic', () => {
    const unlabelled: NvTreatmentPayload = {
      ...OVERRULED,
      treatments: [{ treatment: 'overruled', confidence: 0.82, paragraph: 'x', citation: null }],
    };
    const c = renderPanel(<GoodLawPanel citation="X" payload={unlabelled} />);
    expect(byTestId(c, 'good-law-row').getAttribute('data-extracted-by')).toBe('unknown');
    expect(text(c, 'good-law-row-extracted-by')).toMatch(/unknown/i);
    expect(readExtractedBy(undefined).reproducible).toBe(false);
  });
});

describe('good law — an unidentified authority is unmistakable', () => {
  it('replaces the verdict with "authority not identified"', () => {
    const c = renderPanel(
      <GoodLawPanel citation="Kesavananda Bharati v. State of Kerala" payload={UNRESOLVED} />,
    );
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state'))
      .toBe('unresolved_authority');
    expect(text(c, 'good-law-headline')).toMatch(/not identified/i);
    expect(text(c, 'good-law-resolution-badge')).toMatch(/NOT identified/i);
  });

  it('says the withheld passages may concern a different case', () => {
    // The partner's actual failure: "Kesavananda Bharati" token-matched a 2018
    // Kerala HC matter named "KESAVAN".
    const c = renderPanel(<GoodLawPanel citation="X" payload={UNRESOLVED} />);
    expect(text(c, 'good-law-detail')).toMatch(/may concern a different case/i);
    expect(allByTestId(c, 'good-law-row')).toHaveLength(0);
  });

  it('does not report matched when the resolution block is missing entirely', () => {
    const r = readResolution({ citation: 'X' });
    expect(r.matched).toBe(false);
    expect(r.reported).toBe(false);
  });

  it('outranks the wire verdict — an unmatched authority cannot report overruled', () => {
    /* Defence in depth: the route already forces `unknown` when unresolved. If a
     * future change drops that, the panel must still refuse to attribute the
     * finding to the requested authority. */
    const drifted: NvTreatmentPayload = { ...OVERRULED, authority: UNRESOLVED.authority };
    expect(readGoodLaw(drifted).state).toBe('unresolved_authority');
    expect(readGoodLaw(drifted).adverse).toBe(false);
  });

  it('surfaces method and confidence so a token match differs from a citation match', () => {
    const tokens = renderPanel(<GoodLawPanel citation="X" payload={OVERRULED} />);
    expect(text(tokens, 'good-law-resolution-method')).toMatch(/method=all-tokens-in-title/);
    expect(text(tokens, 'good-law-resolution-method')).toMatch(/confidence=0\.8/);
    expect(text(tokens, 'good-law-resolution-detail')).toMatch(/KESAVAN/);
    act(() => root!.unmount());
    root = null;

    const exact = renderPanel(<GoodLawPanel citation="X" payload={UNKNOWN} />);
    expect(text(exact, 'good-law-resolution-method')).toMatch(/method=exact-citation/);
    expect(text(exact, 'good-law-resolution-badge')).toMatch(/identified by citation/i);
  });

  it('offers exact mode on a token match and re-queries with exact=true', async () => {
    const fetchTreatment = vi.fn().mockResolvedValue(UNKNOWN);
    const c = renderPanel(
      <GoodLawPanel citation="Kesavananda Bharati" payload={OVERRULED} fetchTreatment={fetchTreatment} />,
    );
    const retry = byTestId(c, 'good-law-exact-retry');
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchTreatment).toHaveBeenCalledTimes(1);
    expect(fetchTreatment.mock.calls[0]![1]).toMatchObject({ exact: true });
  });

  it('offers exact mode when the authority was NOT identified', () => {
    /* This assertion exists because mutation M15 (`offerExactMode: false` in the
     * unmatched branch) SURVIVED the first mutation run: the offer was made by
     * the code and rendered on screen, but nothing asserted it, so removing it
     * would have been invisible. "No answer beats a plausible wrong one" is the
     * whole point of exact mode, and the unresolved case is where it matters. */
    expect(readResolution(UNRESOLVED.authority).offerExactMode).toBe(true);
    const c = renderPanel(<GoodLawPanel citation="Kesavananda Bharati" payload={UNRESOLVED} />);
    expect(queryByTestId(c, 'good-law-exact-retry')).not.toBeNull();
    expect(text(c, 'good-law-exact-retry')).toMatch(/exact citation only/i);
  });

  it('does not offer exact mode when exact mode was already in force', () => {
    const alreadyExact: NvTreatmentPayload = {
      ...UNRESOLVED,
      authority: {
        ...UNRESOLVED.authority,
        resolution: { matched: false, confidence: 0, method: 'unresolved', exactModeRequested: true },
      },
    };
    const c = renderPanel(<GoodLawPanel citation="X" payload={alreadyExact} />);
    expect(queryByTestId(c, 'good-law-exact-retry')).toBeNull();
    expect(readResolution(alreadyExact.authority).offerExactMode).toBe(false);
  });

  it('does not offer exact mode on an exact-citation match', () => {
    expect(readResolution(UNKNOWN.authority).offerExactMode).toBe(false);
  });
});

describe('good law — the limitation is stated in the UI, not only in the payload', () => {
  it('states that this is not a citator', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={UNKNOWN} />);
    expect(text(c, 'good-law-limitation')).toMatch(/not a citator/i);
    expect(text(c, 'good-law-limitation')).toMatch(/no citation graph/i);
    expect(text(c, 'good-law-limitation')).toMatch(/never asserts that an authority is good law/i);
  });

  it('states the limitation even when the payload omits `limitations`', () => {
    // The constraint is a property of the platform, not of one response.
    const c = renderPanel(<GoodLawPanel citation="X" payload={{ ...UNKNOWN, limitations: undefined }} />);
    expect(text(c, 'good-law-limitation')).toMatch(/not a citator/i);
  });

  it('warns that similarity is not treatment', () => {
    const c = renderPanel(<GoodLawPanel citation="X" payload={UNKNOWN} />);
    expect(text(c, 'good-law-not-similarity'))
      .toMatch(/similar cases are not cases that treated this one/i);
  });
});

describe('good law — rail integration (NV-GOOD-LAW-PANEL-001 host contract)', () => {
  it('mounts inside ExecutionTraceRail only when the host supplies an authority', () => {
    const withAuthority = renderPanel(
      <ExecutionTraceRail events={[]} goodLawCitation="Maneka Gandhi v. Union of India" />,
    );
    expect(queryByTestId(withAuthority, 'good-law-panel')).not.toBeNull();
    act(() => root!.unmount());
    root = null;

    const without = renderPanel(<ExecutionTraceRail events={[]} />);
    expect(queryByTestId(without, 'good-law-panel')).toBeNull();
  });

  it('does not fire an upstream check just because the rail mounted', () => {
    // The rail is on six surfaces. Auto-firing here would cost two NYS searches
    // per page load on every one of them.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPanel(<ExecutionTraceRail events={[]} goodLawCitation="Maneka Gandhi" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('good law — fetch behaviour', () => {
  it('does not fire a check on mount — one call costs two upstream searches', () => {
    const fetchTreatment = vi.fn();
    renderPanel(<GoodLawPanel citation="Maneka Gandhi" fetchTreatment={fetchTreatment} />);
    expect(fetchTreatment).not.toHaveBeenCalled();
  });

  it('runs the check on the reader action and renders the verdict', async () => {
    const fetchTreatment = vi.fn().mockResolvedValue(OVERRULED);
    const c = renderPanel(<GoodLawPanel citation="ADM Jabalpur" fetchTreatment={fetchTreatment} />);
    await act(async () => {
      byTestId(c, 'good-law-check').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchTreatment)
      .toHaveBeenCalledWith('ADM Jabalpur', expect.objectContaining({ exact: false }));
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('overruled');
  });

  it('drops the previous verdict on a failed re-check rather than leaving it stale', async () => {
    const fetchTreatment = vi.fn()
      .mockResolvedValueOnce(UNKNOWN)
      .mockRejectedValueOnce(new Error('upstream 503'));
    const c = renderPanel(<GoodLawPanel citation="X" fetchTreatment={fetchTreatment} />);
    await act(async () => {
      byTestId(c, 'good-law-check').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('unknown');
    await act(async () => {
      byTestId(c, 'good-law-check').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(text(c, 'good-law-error')).toMatch(/upstream 503/);
    expect(byTestId(c, 'good-law-panel').getAttribute('data-good-law-state')).toBe('not_checked');
  });
});
