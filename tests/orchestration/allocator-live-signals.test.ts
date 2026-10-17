/**
 * Hierarchical Task Allocator — live-signal smart routing
 * JRX-ORCH-SMART-003 (Task #33)
 *
 * Verifies that the allocator now blends live signals (recent success
 * rate, P95 latency, active concurrency, per-jurisdiction outcomes)
 * with the static jurisdiction + tier ranking, and that the routing
 * weights are exposed for inspection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const REGISTRY_AGENTS = [
  {
    id: 'agent-fast-and-good',
    name: 'Fast & Good',
    version: '1', tier: 'L2', romaLevel: 'L2', category: 'corporate',
    practiceArea: 'corporate',
    systemPrompt: '', capabilities: ['legal-research'], tools: [], protocols: [],
    preferredModels: [], fallbackModels: [],
    jurisdictions: ['IN'],
  },
  {
    id: 'agent-slow-and-bad',
    name: 'Slow & Bad',
    version: '1', tier: 'L2', romaLevel: 'L2', category: 'corporate',
    practiceArea: 'corporate',
    systemPrompt: '', capabilities: ['legal-research'], tools: [], protocols: [],
    preferredModels: [], fallbackModels: [],
    jurisdictions: ['IN'],
  },
  {
    id: 'agent-saturated',
    name: 'Saturated',
    version: '1', tier: 'L2', romaLevel: 'L2', category: 'corporate',
    practiceArea: 'corporate',
    systemPrompt: '', capabilities: ['legal-research'], tools: [], protocols: [],
    preferredModels: [], fallbackModels: [],
    jurisdictions: ['IN'],
  },
  {
    id: 'agent-wrong-jurisdiction',
    name: 'Wrong Jurisdiction',
    version: '1', tier: 'L2', romaLevel: 'L2', category: 'corporate',
    practiceArea: 'corporate',
    systemPrompt: '', capabilities: ['legal-research'], tools: [], protocols: [],
    preferredModels: [], fallbackModels: [],
    jurisdictions: ['US'],
  },
];

vi.mock('../../src/services/agent-registry-service.js', () => ({
  getAllAgents: () => REGISTRY_AGENTS,
  getAgentsByCapability: (cap: string) =>
    REGISTRY_AGENTS.filter((a) => a.capabilities.includes(cap)),
}));

vi.mock('../../src/orchestration/agent-hierarchy-coordinator.js', () => ({
  agentHierarchyCoordinator: { coordinate: vi.fn().mockResolvedValue(undefined) },
}));

describe('HierarchicalTaskAllocator — live signal smart routing', () => {
  beforeEach(async () => {
    const { agentPerformanceTracker } = await import('../../src/services/agent-performance-tracker.js');
    agentPerformanceTracker.__resetForTests();
  });

  it('prefers an agent with high success + low latency over an equally tiered laggard', async () => {
    const { agentPerformanceTracker } = await import('../../src/services/agent-performance-tracker.js');
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');

    // Seed: fast-and-good = many wins, low latency.
    for (let i = 0; i < 30; i++) {
      agentPerformanceTracker.record({
        agentKey: 'agent-fast-and-good',
        success: true,
        latencyMs: 200,
        qualityScore: 0.95,
        timestamp: new Date(),
      });
    }
    // Seed: slow-and-bad = many failures, high latency.
    for (let i = 0; i < 30; i++) {
      agentPerformanceTracker.record({
        agentKey: 'agent-slow-and-bad',
        success: false,
        latencyMs: 9_000,
        qualityScore: 0.1,
        timestamp: new Date(),
      });
    }

    const alloc = await hierarchicalTaskAllocator.allocate('t1', {
      capability: 'legal-research',
      jurisdiction: 'IN',
    });

    expect(alloc.assignedAgent).toBe('agent-fast-and-good');
    expect(alloc.candidates).toContain('agent-fast-and-good');
    expect(alloc.rationale).toMatch(/composite=/);
  });

  it('deprioritizes an agent that is already at capacity', async () => {
    const { agentPerformanceTracker } = await import('../../src/services/agent-performance-tracker.js');
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');

    // Make saturated agent look perfect on paper but pin its concurrency at the soft cap.
    for (let i = 0; i < 30; i++) {
      agentPerformanceTracker.record({
        agentKey: 'agent-saturated',
        success: true,
        latencyMs: 100,
        qualityScore: 0.99,
        timestamp: new Date(),
      });
    }
    for (let i = 0; i < 8; i++) agentPerformanceTracker.beginExecution('agent-saturated');

    // A fresh, not-yet-tracked agent should get picked over the saturated one.
    const alloc = await hierarchicalTaskAllocator.allocate('t2', {
      capability: 'legal-research',
      jurisdiction: 'IN',
    });

    expect(alloc.assignedAgent).not.toBe('agent-saturated');
  });

  it('always picks a jurisdiction-matching agent over a wrong-jurisdiction one, even with no live signal', async () => {
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');
    const alloc = await hierarchicalTaskAllocator.allocate('t3', {
      capability: 'legal-research',
      jurisdiction: 'IN',
    });
    expect(alloc.assignedAgent).not.toBe('agent-wrong-jurisdiction');
  });

  it('exposes a routing-weight breakdown for the dashboard endpoint', async () => {
    const { agentPerformanceTracker } = await import('../../src/services/agent-performance-tracker.js');
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');

    agentPerformanceTracker.record({
      agentKey: 'agent-fast-and-good',
      success: true,
      latencyMs: 250,
      qualityScore: 0.9,
      timestamp: new Date(),
    });

    const weights = hierarchicalTaskAllocator.getRoutingWeights({
      capability: 'legal-research',
      jurisdiction: 'IN',
    });

    expect(weights.length).toBeGreaterThan(0);
    const fast = weights.find((w) => w.agentId === 'agent-fast-and-good');
    expect(fast).toBeTruthy();
    expect(fast!.composite).toBeGreaterThan(0);
    expect(fast!.jurisdictionMatch).toBe(1);
    expect(typeof fast!.successRate).toBe('number');
    expect(typeof fast!.latencyFactor).toBe('number');
    expect(typeof fast!.concurrencyPenalty).toBe('number');
    expect(typeof fast!.jurisdictionOutcome).toBe('number');

    // Sorted descending by composite.
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i - 1].composite).toBeGreaterThanOrEqual(weights[i].composite);
    }
  });

  it('formCoalition favors agents with proven jurisdiction outcomes', async () => {
    const { agentPerformanceTracker } = await import('../../src/services/agent-performance-tracker.js');
    const { hierarchicalTaskAllocator } = await import('../../src/services/hierarchical-task-allocator.js');

    // slow-and-bad has 5 wins in IN (proven track record) and a clean perf history;
    // fast-and-good has 5 losses in IN.
    for (let i = 0; i < 5; i++) {
      agentPerformanceTracker.recordJurisdictionOutcome('agent-slow-and-bad', 'IN', true);
      agentPerformanceTracker.recordJurisdictionOutcome('agent-fast-and-good', 'IN', false);
    }
    // Wipe the rolling perf history so the jurisdiction-outcome dimension dominates.
    agentPerformanceTracker.__resetForTests();
    // Re-seed only the jurisdiction outcomes (reset cleared everything).
    for (let i = 0; i < 5; i++) {
      agentPerformanceTracker.recordJurisdictionOutcome('agent-slow-and-bad', 'IN', true);
      agentPerformanceTracker.recordJurisdictionOutcome('agent-fast-and-good', 'IN', false);
    }

    const coalition = await hierarchicalTaskAllocator.formCoalition(
      't4', ['legal-research'], 'parallel', { jurisdiction: 'IN' },
    );
    const lead = coalition.members.find((m) => m.role === 'lead');
    expect(lead?.agentId).toBe('agent-slow-and-bad');
  });
});
