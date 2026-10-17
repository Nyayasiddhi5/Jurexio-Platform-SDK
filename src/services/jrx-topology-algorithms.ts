/**
 * NV-TOPOLOGY-ALGORITHMS-001 — Per-category swarm algorithm refinements.
 * Applied before/after Queen execution for the 11 topology categories.
 * Honest increment: shapes real aggregation/scoring; Queen still runs core LLM work.
 */
import type { TopologyCategory } from './jrx-swarm-topology-service.js';

export interface TopologyAgentResult {
  agentId: string;
  result: string;
  score: number;
  latencyMs: number;
}

export interface TopologyAlgorithmPlan {
  category: TopologyCategory;
  algorithm: string;
  promptPrefix: string;
  agentSelection: 'sequential' | 'parallel_pool' | 'tournament' | 'vote' | 'round_robin' | 'manager_workers';
  maxRounds?: number;
}

export interface TopologyAggregation {
  aggregatedResult: string;
  consensusScore: number;
  algorithm: string;
  metadata: Record<string, unknown>;
}

const CATEGORY_PLANS: Record<TopologyCategory, TopologyAlgorithmPlan> = {
  linear: { category: 'linear', algorithm: 'sequential_pipeline', promptPrefix: 'Execute as strict A→B→C pipeline; pass prior output forward.', agentSelection: 'sequential' },
  fan_out: { category: 'fan_out', algorithm: 'parallel_merge', promptPrefix: 'Branch in parallel then merge non-redundant findings.', agentSelection: 'parallel_pool' },
  hierarchical: { category: 'hierarchical', algorithm: 'manager_worker_decompose', promptPrefix: 'Manager decomposes; workers execute subtasks; manager synthesizes.', agentSelection: 'manager_workers' },
  round_robin: { category: 'round_robin', algorithm: 'round_robin_pool', promptPrefix: 'Rotate specialist agents; balance load across pool.', agentSelection: 'round_robin', maxRounds: 3 },
  competitive: { category: 'competitive', algorithm: 'tournament_best_of_n', promptPrefix: 'Compete for best answer; score on legal accuracy and citations.', agentSelection: 'tournament', maxRounds: 2 },
  consensus: { category: 'consensus', algorithm: 'weighted_vote', promptPrefix: 'Independent opinions then weighted consensus vote.', agentSelection: 'vote' },
  iterative: { category: 'iterative', algorithm: 'critique_revise_loop', promptPrefix: 'Critique → revise loop until confidence threshold.', agentSelection: 'sequential', maxRounds: 3 },
  specialized: { category: 'specialized', algorithm: 'domain_fan_out', promptPrefix: 'Route to domain specialists (tax, litigation, regulatory).', agentSelection: 'parallel_pool' },
  hybrid: { category: 'hybrid', algorithm: 'dag_mixed_strategy', promptPrefix: 'Mixed DAG — parallel research, sequential synthesis.', agentSelection: 'parallel_pool' },
  quantum_ready: { category: 'quantum_ready', algorithm: 'grpo_enhanced_parallel', promptPrefix: 'GRPO-scored parallel ensemble with confidence calibration.', agentSelection: 'parallel_pool' },
  roma_l5: { category: 'roma_l5', algorithm: 'roma_l5_hierarchical', promptPrefix: 'ROMA L5 orchestrator delegates to L2–L4 specialists.', agentSelection: 'manager_workers' },
};

export function getTopologyAlgorithmPlan(category: TopologyCategory): TopologyAlgorithmPlan {
  return CATEGORY_PLANS[category];
}

/** Score agent output heuristically for tournament/consensus modes. */
function scoreResult(text: string): number {
  const len = text.trim().length;
  const hasCitation = /\b(Section|Article|Act|SCC|AIR|\[\d{4}\])\b/i.test(text);
  const hasStructure = /\b(therefore|conclusion|recommend|risk)\b/i.test(text);
  let score = Math.min(0.95, 0.4 + len / 4000);
  if (hasCitation) score += 0.08;
  if (hasStructure) score += 0.05;
  return Math.round(score * 1000) / 1000;
}

export function refineAgentResults(category: TopologyCategory, results: TopologyAgentResult[]): TopologyAgentResult[] {
  const plan = CATEGORY_PLANS[category];
  const scored = results.map(r => ({ ...r, score: r.score || scoreResult(r.result) }));

  switch (plan.algorithm) {
    case 'tournament_best_of_n':
      return [...scored].sort((a, b) => b.score - a.score);
    case 'weighted_vote':
    case 'round_robin_pool':
      return scored;
    case 'sequential_pipeline':
      return scored;
    default:
      return scored;
  }
}

export function aggregateTopologyResults(
  category: TopologyCategory,
  results: TopologyAgentResult[],
  queenSynthesis: string,
): TopologyAggregation {
  const plan = CATEGORY_PLANS[category];
  const refined = refineAgentResults(category, results);

  if (plan.algorithm === 'tournament_best_of_n' && refined.length > 0) {
    const winner = refined[0];
    return {
      aggregatedResult: queenSynthesis || winner.result,
      consensusScore: winner.score,
      algorithm: plan.algorithm,
      metadata: { winnerAgentId: winner.agentId, ranked: refined.slice(0, 3).map(r => ({ agentId: r.agentId, score: r.score })) },
    };
  }

  if (plan.algorithm === 'weighted_vote' && refined.length > 1) {
    const avg = refined.reduce((s, r) => s + r.score, 0) / refined.length;
    const dissent = refined.filter(r => r.score < avg - 0.15).length;
    return {
      aggregatedResult: queenSynthesis || refined.map(r => r.result).join('\n\n---\n\n'),
      consensusScore: Math.round(avg * 1000) / 1000,
      algorithm: plan.algorithm,
      metadata: { votes: refined.length, dissenting: dissent },
    };
  }

  if (plan.algorithm === 'round_robin_pool') {
    const rotated = refined[refined.length - 1];
    return {
      aggregatedResult: queenSynthesis || rotated?.result || '',
      consensusScore: rotated?.score ?? 0.7,
      algorithm: plan.algorithm,
      metadata: { lastAgent: rotated?.agentId },
    };
  }

  const avgScore = refined.length
    ? refined.reduce((s, r) => s + r.score, 0) / refined.length
    : 0.75;

  return {
    aggregatedResult: queenSynthesis || refined.map(r => r.result).join('\n\n'),
    consensusScore: Math.round(avgScore * 1000) / 1000,
    algorithm: plan.algorithm,
    metadata: { agentCount: refined.length },
  };
}

/** Top 10 commonly-used topology IDs for regression testing. */
export const TOP_10_TOPOLOGY_IDS = [
  'linear-001', 'linear-002', 'fanout-001', 'hier-001', 'rr-001',
  'comp-001', 'cons-001', 'iter-001', 'hyb-001', 'roma-001',
] as const;
