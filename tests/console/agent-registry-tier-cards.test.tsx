/**
 * @vitest-environment jsdom
 *
 * task-336 — /console/agent-registry tier cards regression
 *
 * The L1–L5 tier summary cards used to derive their available/total numbers
 * from `agents.filter(a => a.tier === tier.value)`, where `agents` is only
 * the current 20-row page slice. Page 1 happens not to contain a sample of
 * every tier, so every card collapsed to "0/0" even though the registry
 * contains 1,042 agents across all five tiers.
 *
 * The fix wires the cards to backend aggregates (`counts.byTierStatus` over
 * `globalCounts.byTier`) returned by `GET /api/jrx/agents`. This test stubs
 * `fetch` with a representative aggregate payload (only one L3 row in the
 * page slice) and asserts:
 *
 *   • every tier card renders the registry-wide total, not zero,
 *   • the numerator reflects the filter-aware `status === 'available'`
 *     count only (degraded agents are excluded so the cards stay
 *     consistent with the "Available: N / N" header chip),
 *   • when `globalCounts.byRomaLevel` is absent, cards render "—/—"
 *     rather than coercing the missing aggregate to "0/0".
 */
import './setup-jsdom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderWithProviders, screen, waitFor } from './test-utils';
import AgentRegistry from '../../client/src/pages/AgentRegistry';

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TIER_TOTALS = { L1: 200, L2: 250, L3: 300, L4: 200, L5: 92 };
const TIER_AVAILABLE = { L1: 180, L2: 230, L3: 270, L4: 180, L5: 80 };

function aggregatePayload(byRomaAvailable: Record<string, number>) {
  const byRomaLevel: Record<string, number> = { ...TIER_TOTALS };
  const byRomaLevelStatus: Record<string, { available: number; degraded: number; disabled: number; total: number }> = {};
  for (const t of Object.keys(byRomaLevel)) {
    const a = byRomaAvailable[t] ?? 0;
    byRomaLevelStatus[t] = {
      available: a,
      degraded: 0,
      disabled: byRomaLevel[t] - a,
      total: byRomaLevel[t],
    };
  }
  return { byRomaLevel, byRomaLevelStatus };
}

function stubAgentsFetch(opts: { withAggregates: boolean }) {
  const { byRomaLevel, byRomaLevelStatus } = aggregatePayload(TIER_AVAILABLE);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/jrx/agents')) {
      // Page slice deliberately contains only one L3-romaLevel row to prove
      // the cards are NOT being derived from `agents.filter(...)` (the old
      // bug, which would render 0/0 for L1/L2/L4/L5 and 1/1 for L3).
      const baseData: any = {
        total: 1042,
        registryTotal: 1042,
        loaded: 1042,
        agents: [
          { id: 'demo-l3', agent_id: 'demo-l3', name: 'Demo L3', tier: 'specialist', roma_level: 'L3', status: 'available', is_available: true, jurisdiction: ['IN'] },
        ],
      };
      if (opts.withAggregates) {
        baseData.counts = {
          total: 1042,
          byStatus: { available: 1042, degraded: 0, disabled: 0 },
          byJurisdiction: { IN: 148 },
          byTier: { specialist: 1042 },
          byTierStatus: { specialist: { available: 1042, degraded: 0, disabled: 0, total: 1042 } },
          byRomaLevel,
          byRomaLevelStatus,
        };
        baseData.globalCounts = {
          total: 1042,
          byStatus: { available: 1042, degraded: 0, disabled: 0 },
          byJurisdiction: { IN: 148 },
          byTier: { specialist: 1042 },
          byTierStatus: { specialist: { available: 1042, degraded: 0, disabled: 0, total: 1042 } },
          byRomaLevel,
          byRomaLevelStatus,
        };
      }
      return json({ success: true, data: baseData });
    }
    return json({});
  }) as unknown as typeof fetch;
}

describe('AgentRegistry tier cards (task-336)', () => {
  beforeEach(() => {
    // Suppress the toast hook's react-warning noise during render.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders registry-wide total per tier (not 0/0) when globalCounts is present', async () => {
    stubAgentsFetch({ withAggregates: true });
    renderWithProviders(<AgentRegistry />);

    for (const tier of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) {
      const node = await screen.findByTestId(`tier-count-${tier}`);
      const expected = `${TIER_AVAILABLE[tier]}/${TIER_TOTALS[tier]}`;
      await waitFor(() => expect(node.textContent).toBe(expected));
      expect(node.textContent).not.toBe('0/0');
    }
  });

  it('numerator excludes degraded agents (matches header "Available" chip)', async () => {
    // Override fetch with a fixture where L1 has 100 total: 60 available,
    // 30 degraded, 10 disabled. The card must show 60/100 (available-only),
    // not 90/100 (available+degraded) and not 100/100 (anything-not-disabled).
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/jrx/agents')) {
        const aggr = {
          total: 100,
          byStatus: { available: 60, degraded: 30, disabled: 10 },
          byJurisdiction: { IN: 100 },
          byTier: { specialist: 100 },
          byTierStatus: { specialist: { available: 60, degraded: 30, disabled: 10, total: 100 } },
          byRomaLevel: { L1: 100 },
          byRomaLevelStatus: { L1: { available: 60, degraded: 30, disabled: 10, total: 100 } },
        };
        return json({
          success: true,
          data: { total: 100, registryTotal: 100, loaded: 100, agents: [], counts: aggr, globalCounts: aggr },
        });
      }
      return json({});
    }) as unknown as typeof fetch;

    renderWithProviders(<AgentRegistry />);
    const node = await screen.findByTestId('tier-count-L1');
    await waitFor(() => expect(node.textContent).toBe('60/100'));
    expect(node.textContent).not.toBe('90/100');
    expect(node.textContent).not.toBe('100/100');
  });

  it('renders "—/—" placeholder (not "0/0") when globalCounts is missing', async () => {
    stubAgentsFetch({ withAggregates: false });
    renderWithProviders(<AgentRegistry />);

    for (const tier of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) {
      const node = await screen.findByTestId(`tier-count-${tier}`);
      await waitFor(() => expect(node.textContent).toBe('—/—'));
      expect(node.textContent).not.toBe('0/0');
    }
  });
});
