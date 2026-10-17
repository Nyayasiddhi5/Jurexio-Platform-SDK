import { describe, it, expect } from 'vitest';
import {
  getTopologyAlgorithmPlan,
  aggregateTopologyResults,
  refineAgentResults,
  TOP_10_TOPOLOGY_IDS,
} from '../../src/services/jrx-topology-algorithms.js';
import { SWARM_TOPOLOGIES } from '../../src/services/jrx-swarm-topology-service.js';

describe('./jrx-topology-algorithms', () => {
  it('defines algorithm plan for all 11 categories', () => {
    const cats = new Set(SWARM_TOPOLOGIES.map(t => t.category));
    for (const c of cats) {
      const plan = getTopologyAlgorithmPlan(c);
      expect(plan.algorithm).toBeTruthy();
      expect(plan.promptPrefix.length).toBeGreaterThan(10);
    }
  });

  it('TOP_10 topology IDs exist in catalog', () => {
    const ids = new Set(SWARM_TOPOLOGIES.map(t => t.id));
    for (const id of TOP_10_TOPOLOGY_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('TOP_10 soak: each topology resolves an algorithm plan and aggregates', () => {
    const byId = new Map(SWARM_TOPOLOGIES.map(t => [t.id, t]));
    for (const id of TOP_10_TOPOLOGY_IDS) {
      const topo = byId.get(id);
      expect(topo, `missing swarm topology ${id}`).toBeTruthy();
      const plan = getTopologyAlgorithmPlan(topo!.category);
      expect(plan.algorithm).toBeTruthy();
      expect(plan.promptPrefix.length).toBeGreaterThan(10);
      const agg = aggregateTopologyResults(
        topo!.category,
        [{ agentId: 'a1', result: 'Section 302 applies; therefore risk is moderate.', score: 0.7, latencyMs: 50 }],
        'synthesis fallback',
      );
      expect(agg.aggregatedResult.length).toBeGreaterThan(0);
      expect(agg.consensusScore).toBeGreaterThan(0);
    }
  });

  it('tournament aggregation picks highest-scoring agent', () => {
    const results = refineAgentResults('competitive', [
      { agentId: 'a1', result: 'short', score: 0.5, latencyMs: 100 },
      { agentId: 'a2', result: 'Section 302 IPC applies therefore conclusion risk HIGH', score: 0, latencyMs: 200 },
    ]);
    const agg = aggregateTopologyResults('competitive', results, '');
    expect(agg.algorithm).toBe('tournament_best_of_n');
    expect(agg.consensusScore).toBeGreaterThan(0.5);
    expect((agg.metadata as any).winnerAgentId).toBeTruthy();
  });

  it('consensus aggregation computes average score', () => {
    const results = [
      { agentId: 'a1', result: 'opinion A', score: 0.8, latencyMs: 50 },
      { agentId: 'a2', result: 'opinion B', score: 0.7, latencyMs: 60 },
    ];
    const agg = aggregateTopologyResults('consensus', results, 'synthesis');
    expect(agg.algorithm).toBe('weighted_vote');
    expect(agg.consensusScore).toBeCloseTo(0.75, 1);
  });
});
