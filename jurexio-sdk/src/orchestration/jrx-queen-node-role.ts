/**
 * NV-QUEEN-LEAF-TIER-001 — Queen node role classification (leaf vs synthesis).
 *
 * Measured defect (`scripts/_ec2-swarm-fail-rca.sh`, SSM `d9d3ffc5` on jrx-staging):
 * every Queen leaf declared `complexity:'complex'`, `qualityLevel:'professional'`
 * and asked for 16,384 output tokens, so three *throwaway* swarm-exploration
 * leaves each ran `gemini-3-1-pro-preview` for 24–58 s and then blew the 120 s
 * per-node budget. One request summed **249 s across 6 completions**, with all
 * three exploration nodes dying on `policy: per-node timeout after 120000ms` —
 * we paid for every one of those generations and shipped a degraded answer.
 *
 * Exploration leaves produce intermediate notes that a synthesis node rewrites;
 * their text never reaches the user verbatim. They do not need a frontier model,
 * a professional quality level, or a 16 k output window. Synthesis and
 * aggregation nodes do — they author what the user reads.
 *
 * Kept in its own module (rather than inside the 5.4 k-line orchestrator) so the
 * routing decision is unit-testable without booting the whole agent graph.
 *
 * See `documents/working/JRX-ORCHESTRATION-OPTIMIZATION-PLAN-2026-08.md` §8.5.
 */

export type QueenNodeRole = 'exploration' | 'synthesis';

/**
 * Subtask types whose output is user-visible and therefore keeps the premium
 * model, quality level and token window.
 */
const SYNTHESIS_SUBTASK_TYPES = new Set<string>([
  'swarm_aggregation',
  'synthesis',
  'aggregation',
  'final_synthesis',
  'consensus',
  'review',
]);

const SYNTHESIS_TYPE_RE = /synthes|aggregat|consensus|final|review|verdict|draft/;
const SYNTHESIS_CAPABILITY_RE = /synthes|aggregat|draft/;

export interface QueenNodeRoleInput {
  type?: string;
  requiredCapabilities?: string[];
}

/**
 * Classify a Queen subtask as an intermediate exploration leaf or a
 * user-visible synthesis node.
 *
 * Unknown / missing types deliberately resolve to `'synthesis'`: an
 * unclassified node keeps the pre-existing premium behaviour, so this change
 * can only ever *downgrade* nodes we positively recognise as intermediate.
 */
export function classifyQueenNodeRole(subtask?: QueenNodeRoleInput): QueenNodeRole {
  const type = String(subtask?.type || '').trim().toLowerCase();
  if (!type) return 'synthesis';
  if (SYNTHESIS_SUBTASK_TYPES.has(type)) return 'synthesis';
  if (SYNTHESIS_TYPE_RE.test(type)) return 'synthesis';

  const caps = (subtask?.requiredCapabilities || []).map((c) => String(c).toLowerCase());
  if (caps.some((c) => SYNTHESIS_CAPABILITY_RE.test(c))) return 'synthesis';

  return 'exploration';
}

/**
 * Output-token ceiling for an exploration leaf. Env-tunable via
 * `JRX_QUEEN_EXPLORATION_MAX_TOKENS`; clamped to 512–4,096 so a misconfigured
 * value can neither truncate notes into uselessness nor restore the 16 k
 * generation that caused the measured per-node timeouts.
 */
export function resolveExplorationMaxTokens(
  raw: string | number | undefined = process.env.JRX_QUEEN_EXPLORATION_MAX_TOKENS,
): number {
  const n = Number(raw ?? 2_048);
  if (!Number.isFinite(n) || n <= 0) return 2_048;
  return Math.min(4_096, Math.max(512, Math.trunc(n)));
}
