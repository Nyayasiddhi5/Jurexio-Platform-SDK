/**
 * Orchestration Execution Policy
 * JRX-ORCH-POLICY-001 (Task #32)
 *
 * Centralizes the parallelism, partial-failure, context-budget, and fan-in
 * synthesis rules that DAG/parallel/swarm executions must obey. Queen and the
 * DAG service must consult this — never invent their own ad-hoc limits.
 */

import type { CapabilityTier } from './capability-manifest.js';
import { NV_TIMEOUTS } from '../config/jrx-timeout-policy.js';

export type FailurePolicy =
  /** Abort the rest of the plan as soon as any node fails */
  | 'fail-fast'
  /** Allow up to N failures, surface them in the result, continue */
  | 'partial-tolerate'
  /** Best effort — execute everything regardless of failures */
  | 'best-effort';

export interface ExecutionPolicy {
  /** Hard cap on concurrently-running nodes within one execution level */
  maxConcurrentNodes: number;

  /** Total context-window budget (tokens) per plan */
  contextBudgetTokens: number;

  /** Per-node max input tokens (cap, not target) */
  perNodeMaxInputTokens: number;

  /** Per-node max output tokens (cap, not target) */
  perNodeMaxOutputTokens: number;

  /** What to do when a single node fails */
  failurePolicy: FailurePolicy;

  /** Maximum tolerated failures when policy=partial-tolerate */
  maxFailedNodes: number;

  /** Total wall-clock cap per node, in ms */
  perNodeTimeoutMs: number;

  /** Whether to run a fan-in synthesis pass over completed-node outputs */
  enableSynthesis: boolean;

  /** Hard wall for entire Queen run (under ALB 600s). */
  wallClockMs: number;

  /** Cap hierarchical recursion so levels × perNode cannot exceed wall. */
  maxHierarchyDepth: number;
}

const TIER_POLICIES: Record<CapabilityTier, ExecutionPolicy> = {
  lite: {
    maxConcurrentNodes: 2,
    contextBudgetTokens: 32_000,
    perNodeMaxInputTokens: 4_096,
    perNodeMaxOutputTokens: 1_024,
    failurePolicy: 'fail-fast',
    maxFailedNodes: 0,
    perNodeTimeoutMs: NV_TIMEOUTS.perNodeLiteMs,
    enableSynthesis: true,
    wallClockMs: NV_TIMEOUTS.orchWallClockMs,
    maxHierarchyDepth: Math.min(2, NV_TIMEOUTS.queenMaxHierarchyDepth),
  },
  mitra: {
    maxConcurrentNodes: 4,
    contextBudgetTokens: 128_000,
    perNodeMaxInputTokens: 8_192,
    perNodeMaxOutputTokens: 2_048,
    failurePolicy: 'partial-tolerate',
    maxFailedNodes: 1,
    perNodeTimeoutMs: NV_TIMEOUTS.perNodeMitraMs,
    enableSynthesis: true,
    wallClockMs: NV_TIMEOUTS.orchWallClockMs,
    maxHierarchyDepth: Math.min(3, NV_TIMEOUTS.queenMaxHierarchyDepth),
  },
  enterprise: {
    maxConcurrentNodes: 8,
    contextBudgetTokens: 500_000,
    perNodeMaxInputTokens: 32_000,
    perNodeMaxOutputTokens: 8_192,
    failurePolicy: 'partial-tolerate',
    maxFailedNodes: 3,
    perNodeTimeoutMs: NV_TIMEOUTS.perNodeEnterpriseMs,
    enableSynthesis: true,
    wallClockMs: NV_TIMEOUTS.orchWallClockMs,
    maxHierarchyDepth: NV_TIMEOUTS.queenMaxHierarchyDepth,
  },
  sovereign: {
    maxConcurrentNodes: 16,
    contextBudgetTokens: 1_500_000,
    perNodeMaxInputTokens: 64_000,
    perNodeMaxOutputTokens: 16_384,
    failurePolicy: 'best-effort',
    maxFailedNodes: 8,
    perNodeTimeoutMs: NV_TIMEOUTS.perNodeSovereignMs,
    enableSynthesis: true,
    wallClockMs: NV_TIMEOUTS.orchWallClockMs,
    maxHierarchyDepth: NV_TIMEOUTS.queenMaxHierarchyDepth,
  },
  'white-label': {
    maxConcurrentNodes: 8,
    contextBudgetTokens: 500_000,
    perNodeMaxInputTokens: 32_000,
    perNodeMaxOutputTokens: 8_192,
    failurePolicy: 'partial-tolerate',
    maxFailedNodes: 3,
    perNodeTimeoutMs: NV_TIMEOUTS.perNodeEnterpriseMs,
    enableSynthesis: true,
    wallClockMs: NV_TIMEOUTS.orchWallClockMs,
    maxHierarchyDepth: NV_TIMEOUTS.queenMaxHierarchyDepth,
  },
};

export function getPolicyForTier(tier?: CapabilityTier): ExecutionPolicy {
  return TIER_POLICIES[tier ?? 'lite'];
}

/**
 * Bounded parallel runner — respects `maxConcurrentNodes` and a total wall
 * timeout per task. Failures are captured; aggregation is the caller's job.
 *
 * Returns `{ value, error }` per input, in the same order.
 */
export async function runWithConcurrency<TIn, TOut>(
  items: TIn[],
  worker: (item: TIn, idx: number) => Promise<TOut>,
  opts: { concurrency: number; timeoutMs?: number },
): Promise<Array<{ value?: TOut; error?: Error }>> {
  const concurrency = Math.max(1, opts.concurrency | 0);
  const results: Array<{ value?: TOut; error?: Error }> = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    try {
      const p = worker(items[i], i);
      const value = opts.timeoutMs && opts.timeoutMs > 0
        ? await raceTimeout(p, opts.timeoutMs)
        : await p;
      results[i] = { value };
    } catch (err: any) {
      results[i] = { error: err instanceof Error ? err : new Error(String(err)) };
    }
    return next();
  }

  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(lanes);
  return results;
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`policy: per-node timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Decide if we should keep going given the current failure tally + policy.
 * Returns { halt: boolean, reason?: string }.
 */
export function evaluateFailures(
  policy: ExecutionPolicy,
  failed: number,
  totalAttempted: number,
): { halt: boolean; reason?: string } {
  if (policy.failurePolicy === 'fail-fast' && failed > 0) {
    return { halt: true, reason: 'fail-fast: a node failed' };
  }
  if (policy.failurePolicy === 'partial-tolerate' && failed > policy.maxFailedNodes) {
    return { halt: true, reason: `partial-tolerate: exceeded maxFailedNodes=${policy.maxFailedNodes}` };
  }
  if (totalAttempted === 0) return { halt: false };
  return { halt: false };
}

/**
 * Distribute a context budget across nodes, weighted optionally.
 * Returns Map<nodeId, tokens>. Never allocates more than perNodeMaxInputTokens.
 */
export function distributeContextBudget(
  policy: ExecutionPolicy,
  nodeIds: string[],
  weights?: Record<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const totalWeight = nodeIds.reduce((s, id) => s + (weights?.[id] ?? 1), 0) || nodeIds.length;
  for (const id of nodeIds) {
    const w = weights?.[id] ?? 1;
    const share = Math.floor((policy.contextBudgetTokens * w) / totalWeight);
    out.set(id, Math.min(share, policy.perNodeMaxInputTokens));
  }
  return out;
}

/**
 * Default fan-in synthesis: lightweight, deterministic, no LLM call.
 * Callers (Queen, DAG) should call this when policy.enableSynthesis is true
 * and they want a baseline summary; richer synthesis is also fine.
 */
export function defaultSynthesize(parts: Array<{ key: string; output: string }>): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].output;
  const lines: string[] = [];
  lines.push(`# Fan-in Synthesis (${parts.length} contributions)`);
  for (const p of parts) {
    lines.push('');
    lines.push(`## ${p.key}`);
    lines.push(p.output);
  }
  return lines.join('\n');
}
