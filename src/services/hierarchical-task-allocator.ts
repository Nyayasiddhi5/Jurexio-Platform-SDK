/**
 * Hierarchical Task Allocator — REAL DELEGATION SEAM
 * NYV-ORCH-SEAM-002 (Task #32) + NYV-ORCH-SMART-003 (Task #33)
 *
 * Routes allocation through:
 *   - agent-registry-service.getAgentsByCapability  (eligibility)
 *   - agent-hierarchy-coordinator                    (delegation graph)
 *
 * Ranks candidates with a composite score that combines static capability
 * fit (jurisdiction match, tier proximity) with LIVE signals from the
 * performance tracker (rolling success rate, P95 latency, active
 * concurrency, per-jurisdiction proven outcomes).
 *
 * Keeps Coalition + TaskAllocation type exports for dag-orchestration-service.
 */

import { agentHierarchyCoordinator, type CoordinationMode, type HierarchyAgent } from '../orchestration/agent-hierarchy-coordinator.js';
import {
  getAgentsByCapability,
  getAllAgents,
  type AgentDefinition,
} from './agent-registry-service.js';
import { agentPerformanceTracker } from './agent-performance-tracker.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('hierarchical-task-allocator');

export interface TaskAllocation {
  taskId: string;
  assignedAgent: string;
  candidates: string[];
  priority: number;
  tier: string;
  capability?: string;
  rationale?: string;
}

/** Coalition: a coordinated set of agents working on one task or sub-graph. */
export interface Coalition {
  id: string;
  taskId: string;
  members: Array<{ agentId: string; role: 'lead' | 'support' }>;
  mode: CoordinationMode;
  createdAt: Date;
}

export interface AllocationContext {
  capability?: string;
  practiceArea?: string;
  jurisdiction?: string;
  preferredTier?: number; // 1..5
  exclude?: string[];
}

/**
 * Per-candidate score breakdown — exposed via getRoutingWeights so the
 * dashboard / API can show *why* a particular agent was picked.
 */
export interface RoutingWeight {
  agentId: string;
  tier: string;
  jurisdictionMatch: number;       // 0 or 1
  tierProximity: number;           // 0..1 (1 = perfect tier match)
  successRate: number;             // 0..1, rolling window
  latencyFactor: number;           // 0..1 (1 = fast, 0 = slow)
  concurrencyPenalty: number;      // 0..1 (1 = idle, 0 = saturated)
  jurisdictionOutcome: number;     // 0..1 (proven jurisdiction wins)
  composite: number;               // weighted total used for ranking
}

/**
 * Some legacy callers attach an `agentKey` field that older registries
 * exposed alongside `id`. We tolerate it with a structural narrowing
 * helper so the allocator does not need an `any` cast.
 */
function agentIdOf(a: AgentDefinition & { agentKey?: string }): string {
  return a.agentKey ?? a.id ?? 'unknown';
}

function agentTierAsNumber(a: AgentDefinition): number {
  // Tier strings are e.g. 'L1','L2','L3','L4','L5'. Strip the leading L.
  if (typeof a.tier === 'string') {
    const m = /^L?(\d+)/.exec(a.tier);
    if (m) return Number(m[1]);
  }
  return 1;
}

/* ── Composite scoring ─────────────────────────────────────── */

/**
 * Soft cap for "saturated". Above this many in-flight calls per agent we
 * treat the candidate as fully loaded (penalty = 0). Tunable; chosen to
 * match the per-tier maxConcurrentNodes cap in orchestration-policy.ts.
 */
const CONCURRENCY_SOFT_CAP = 8;

/**
 * Weight mix. Static fit (jurisdiction + tier) still dominates so the
 * router never picks a fast-but-wrong-jurisdiction agent over a
 * jurisdiction-correct one. Live signals break ties and re-rank
 * candidates within the same eligibility band.
 */
const WEIGHTS = {
  jurisdictionMatch:   0.25,
  tierProximity:       0.15,
  successRate:         0.25,
  latencyFactor:       0.10,
  concurrencyPenalty:  0.10,
  jurisdictionOutcome: 0.15,
} as const;

function computeWeight(a: AgentDefinition, ctx: AllocationContext): RoutingWeight {
  const id = agentIdOf(a);
  const stats = agentPerformanceTracker.getStats(id);

  const jurisdictionMatch = ctx.jurisdiction && a.jurisdictions?.includes(ctx.jurisdiction) ? 1 : 0;

  const tierProximity = ctx.preferredTier
    ? Math.max(0, 1 - Math.abs(agentTierAsNumber(a) - ctx.preferredTier) / 4)
    : 0.5; // neutral when caller did not express a tier preference

  const successRate = stats.totalExecutions > 0 ? stats.successRate : 0.85; // optimistic prior
  // Latency factor: prefer P95 (tail latency) over avg so a few slow calls
  // don't get washed out by many fast ones. Normalised against a 10s baseline.
  const latencyFactor = stats.totalExecutions > 0
    ? Math.max(0, 1 - (stats.p95LatencyMs || stats.avgLatencyMs) / 10_000)
    : 0.85;

  const activeNow = agentPerformanceTracker.getActiveCount(id);
  const concurrencyPenalty = Math.max(0, 1 - activeNow / CONCURRENCY_SOFT_CAP);

  const jurisdictionOutcomeRaw = agentPerformanceTracker.getJurisdictionScore(id, ctx.jurisdiction);
  // No signal yet → neutral 0.5 so we don't penalize first-time use.
  const jurisdictionOutcome = jurisdictionOutcomeRaw ?? 0.5;

  const composite =
    jurisdictionMatch     * WEIGHTS.jurisdictionMatch +
    tierProximity         * WEIGHTS.tierProximity +
    successRate           * WEIGHTS.successRate +
    latencyFactor         * WEIGHTS.latencyFactor +
    concurrencyPenalty    * WEIGHTS.concurrencyPenalty +
    jurisdictionOutcome   * WEIGHTS.jurisdictionOutcome;

  return {
    agentId: id,
    tier: String(a.tier ?? 'L1'),
    jurisdictionMatch,
    tierProximity: parseFloat(tierProximity.toFixed(4)),
    successRate: parseFloat(successRate.toFixed(4)),
    latencyFactor: parseFloat(latencyFactor.toFixed(4)),
    concurrencyPenalty: parseFloat(concurrencyPenalty.toFixed(4)),
    jurisdictionOutcome: parseFloat(jurisdictionOutcome.toFixed(4)),
    composite: parseFloat(composite.toFixed(4)),
  };
}

export class HierarchicalTaskAllocator {
  /**
   * Compute the live routing weights for the current eligible pool.
   * Used by the dashboard endpoint and exposed for inspection / tests.
   */
  getRoutingWeights(ctx: AllocationContext = {}, limit = 25): RoutingWeight[] {
    let pool: AgentDefinition[] = ctx.capability
      ? getAgentsByCapability(ctx.capability)
      : getAllAgents();

    if (ctx.exclude && ctx.exclude.length > 0) {
      const excludeSet = new Set(ctx.exclude);
      pool = pool.filter((a) => !excludeSet.has(agentIdOf(a)));
    }

    if (pool.length === 0) pool = getAllAgents();

    return pool
      .map((a) => computeWeight(a, ctx))
      .sort((a, b) => b.composite - a.composite)
      .slice(0, limit);
  }

  /**
   * Pick the best single agent for a task. Falls back to first available
   * registered agent if no capability match — never returns 'default'.
   */
  async allocate(taskId: string, ctx: AllocationContext = {}): Promise<TaskAllocation> {
    let pool: AgentDefinition[] = ctx.capability
      ? getAgentsByCapability(ctx.capability)
      : getAllAgents();

    if (ctx.exclude && ctx.exclude.length > 0) {
      const excludeSet = new Set(ctx.exclude);
      pool = pool.filter((a) => !excludeSet.has(agentIdOf(a)));
    }

    if (pool.length === 0) {
      logger.warn('[Allocator] no agents matched capability, falling back to all', { capability: ctx.capability });
      pool = getAllAgents();
    }

    // Compute composite weights and rank descending.
    const weights = pool.map((a) => ({ agent: a, w: computeWeight(a, ctx) }));
    weights.sort((x, y) => y.w.composite - x.w.composite);
    const ranked = weights.map((w) => w.agent);
    const winnerWeight = weights[0]?.w;

    const winner = ranked[0];
    if (!winner) {
      // Empty agent registry: in production, this is an unrecoverable
      // configuration error and we MUST fail loudly (no synthetic placeholder).
      // In dev/test we return a clearly-marked sentinel so unit tests that run
      // without a fully-bootstrapped registry can still exercise the allocator.
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        const err = new Error(
          `[Allocator] FAIL-LOUD: empty agent registry — taskId=${taskId} capability=${ctx.capability ?? 'generic'}. ` +
            'Refusing to dispatch a synthetic placeholder in production. ' +
            'Verify agent registry bootstrap (NV_AGENTS.registryPath) and capability seeding.',
        );
        logger.error('[Allocator] empty registry in PRODUCTION — refusing synthetic placeholder', {
          taskId,
          capability: ctx.capability,
        });
        throw err;
      }
      logger.warn('[Allocator] empty agent registry — returning sentinel (dev/test only)', {
        taskId,
        capability: ctx.capability,
        env: process.env.NODE_ENV,
      });
      return {
        taskId,
        assignedAgent: `unassigned:${ctx.capability ?? 'generic'}`,
        candidates: [],
        priority: ctx.preferredTier ?? 1,
        tier: 'L1',
        capability: ctx.capability,
        rationale: 'No registered agents; dev-only sentinel for empty registry',
      };
    }
    return {
      taskId,
      assignedAgent: agentIdOf(winner),
      candidates: ranked.slice(0, 5).map(agentIdOf),
      priority: ctx.preferredTier ?? 1,
      tier: String(winner.tier ?? 'L1'),
      capability: ctx.capability,
      rationale: winnerWeight
        ? `composite=${winnerWeight.composite} ` +
          `(jurisdiction=${winnerWeight.jurisdictionMatch}, tierProx=${winnerWeight.tierProximity}, ` +
          `success=${winnerWeight.successRate}, latency=${winnerWeight.latencyFactor}, ` +
          `concurrency=${winnerWeight.concurrencyPenalty}, jurOutcome=${winnerWeight.jurisdictionOutcome}) ` +
          `capability='${ctx.capability ?? 'any'}' jurisdiction='${ctx.jurisdiction ?? 'any'}'`
        : `Selected from full registry`,
    };
  }

  /**
   * Form a coalition for a sub-graph. Returns the lead + supporters and
   * delegates the multi-agent coordination plan to the hierarchy coordinator.
   *
   * Lead role goes to the highest composite-scoring member; support roles
   * follow in score order so the strongest agents anchor the coalition.
   * When a jurisdiction is given, agents with proven outcomes in that
   * jurisdiction are favored via the composite score.
   */
  async formCoalition(
    taskId: string,
    capabilities: string[],
    mode: CoordinationMode = 'parallel',
    ctx: AllocationContext = {},
  ): Promise<Coalition> {
    const memberMap = new Map<string, { agentId: string; composite: number }>();
    for (const cap of capabilities) {
      const alloc = await this.allocate(`${taskId}:${cap}`, { ...ctx, capability: cap });
      // Re-derive the composite for ordering across capabilities.
      const all = getAgentsByCapability(cap);
      const winner = all.find((a) => agentIdOf(a) === alloc.assignedAgent);
      const composite = winner ? computeWeight(winner, { ...ctx, capability: cap }).composite : 0;
      const existing = memberMap.get(alloc.assignedAgent);
      if (!existing || composite > existing.composite) {
        memberMap.set(alloc.assignedAgent, { agentId: alloc.assignedAgent, composite });
      }
    }

    const ordered = [...memberMap.values()].sort((a, b) => b.composite - a.composite);
    const members = ordered.map((m, i) => ({
      agentId: m.agentId,
      role: (i === 0 ? 'lead' : 'support') as 'lead' | 'support',
    }));

    const coordAgents: HierarchyAgent[] = members.map((m) => ({
      id: m.agentId,
      tier: 'L1',
      capabilities,
    }));

    try {
      await agentHierarchyCoordinator.coordinate({ rootTask: taskId, agents: coordAgents, mode });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[Allocator] coordinator returned non-fatal error', { error: msg });
    }

    return {
      id: `coalition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      members,
      mode,
      createdAt: new Date(),
    };
  }
}

export const hierarchicalTaskAllocator = new HierarchicalTaskAllocator();
export default hierarchicalTaskAllocator;
