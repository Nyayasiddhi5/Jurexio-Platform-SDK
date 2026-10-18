/**
 * NV-TIMEOUT-POLICY-001 — single source of truth for wall-clock budgets.
 *
 * Aligns Queen per-node, LLM provider, RAG, NYS knowledge, Postgres, and
 * partner SDK / edge (ALB 600s) so hierarchical multi-agent work does not
 * blow the edge while still allowing quality-first long research.
 *
 * Env overrides (names only — never log values):
 *   JRX_LLM_PROVIDER_TIMEOUT_MS, JRX_LLM_PROVIDER_STREAM_TIMEOUT_MS
 *   JRX_LLM_TIMEOUT_MS, JRX_LLM_STREAMING_TIMEOUT_MS
 *   JRX_ECOSYSTEM_KNOWLEDGE_TIMEOUT_MS, JRX_CASELAW_HYBRID_BUDGET_MS, JRX_CASELAW_FTS_FALLBACK_BUDGET_MS
 *   JRX_ATHENA_QUERY_BUDGET_MS, JRX_ADAPTIVE_RAG_TIMEOUT_MS
 *   JRX_PG_STATEMENT_TIMEOUT_MS, JRX_ORCH_WALL_CLOCK_MS
 *   JRX_HTTP_LONG_AI_TIMEOUT_MS, JRX_HTTP_SERVER_TIMEOUT_MS
 *   JRX_QUEEN_MAX_HIERARCHY_DEPTH
 *
 * Edge truth (live jrx-staging): ALB/nginx `/api/` = 600s; client SDK orchestrate = 600s.
 */

function envMs(name: string, fallback: number, min = 1_000, max = 600_000): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function envInt(name: string, fallback: number, min = 1, max = 32): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Recommended production defaults (quality-first, 10K users / ~20–50 concurrent orch). */
export const NV_TIMEOUT_RECOMMENDED = {
  edgeHttpMs: 600_000,
  clientOrchestrateMs: 600_000,
  clientDefaultMs: 120_000,
  llmProviderMs: 90_000,
  llmProviderStreamMs: 240_000,
  llmMasterMs: 120_000,
  llmMasterStreamMs: 240_000,
  nysKnowledgeMs: 90_000,
  /** Hybrid caselaw search budget before JRX proxy falls back to FTS (Phase 0). */
  caselawHybridBudgetMs: 12_000,
  /** Tight FTS retry after hybrid budget exceed — must not re-use slow hybrid upstream. */
  caselawFtsFallbackBudgetMs: 3_000,
  /** Athena archive metadata search budget (Phase 2). */
  athenaQueryBudgetMs: 15_000,
  adaptiveRagMs: 45_000,
  pgStatementMs: 120_000,
  orchWallClockMs: 590_000,
  queenMaxHierarchyDepth: 3,
  nightlyOrchProbeMs: 590_000,
  perNode: {
    lite: 30_000,
    mitra: 60_000,
    enterprise: 120_000,
    sovereign: 180_000,
    'white-label': 120_000,
  },
} as const;

/** Live runtime values (env-overridable). */
export const NV_TIMEOUTS = {
  edgeHttpMs: NV_TIMEOUT_RECOMMENDED.edgeHttpMs,
  clientOrchestrateMs: envMs('JRX_ORCHESTRATE_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.clientOrchestrateMs),
  clientDefaultMs: envMs('JRX_SDK_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.clientDefaultMs, 5_000, 600_000),

  llmProviderMs: envMs('JRX_LLM_PROVIDER_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.llmProviderMs, 10_000, 300_000),
  llmProviderStreamMs: envMs(
    'JRX_LLM_PROVIDER_STREAM_TIMEOUT_MS',
    NV_TIMEOUT_RECOMMENDED.llmProviderStreamMs,
    30_000,
    300_000,
  ),
  llmMasterMs: envMs('JRX_LLM_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.llmMasterMs, 15_000, 300_000),
  llmMasterStreamMs: envMs(
    'JRX_LLM_STREAMING_TIMEOUT_MS',
    NV_TIMEOUT_RECOMMENDED.llmMasterStreamMs,
    30_000,
    300_000,
  ),

  nysKnowledgeMs: envMs('JRX_ECOSYSTEM_KNOWLEDGE_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.nysKnowledgeMs, 5_000, 180_000),
  caselawHybridBudgetMs: envMs(
    'JRX_CASELAW_HYBRID_BUDGET_MS',
    NV_TIMEOUT_RECOMMENDED.caselawHybridBudgetMs,
    3_000,
    60_000,
  ),
  caselawFtsFallbackBudgetMs: envMs(
    'JRX_CASELAW_FTS_FALLBACK_BUDGET_MS',
    NV_TIMEOUT_RECOMMENDED.caselawFtsFallbackBudgetMs,
    1_000,
    15_000,
  ),
  athenaQueryBudgetMs: envMs(
    'JRX_ATHENA_QUERY_BUDGET_MS',
    NV_TIMEOUT_RECOMMENDED.athenaQueryBudgetMs,
    3_000,
    60_000,
  ),
  adaptiveRagMs: envMs('JRX_ADAPTIVE_RAG_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.adaptiveRagMs, 5_000, 120_000),
  pgStatementMs: envMs('JRX_PG_STATEMENT_TIMEOUT_MS', NV_TIMEOUT_RECOMMENDED.pgStatementMs, 10_000, 300_000),

  /** Hard wall for one Queen /orchestrate request (leave headroom under ALB 600s). */
  orchWallClockMs: envMs('JRX_ORCH_WALL_CLOCK_MS', NV_TIMEOUT_RECOMMENDED.orchWallClockMs, 60_000, 600_000),
  queenMaxHierarchyDepth: envInt('JRX_QUEEN_MAX_HIERARCHY_DEPTH', NV_TIMEOUT_RECOMMENDED.queenMaxHierarchyDepth, 1, 6),

  perNodeLiteMs: envMs('JRX_QUEEN_NODE_TIMEOUT_LITE_MS', NV_TIMEOUT_RECOMMENDED.perNode.lite, 10_000, 120_000),
  perNodeMitraMs: envMs('JRX_QUEEN_NODE_TIMEOUT_MITRA_MS', NV_TIMEOUT_RECOMMENDED.perNode.mitra, 15_000, 180_000),
  perNodeEnterpriseMs: envMs(
    'JRX_QUEEN_NODE_TIMEOUT_ENTERPRISE_MS',
    NV_TIMEOUT_RECOMMENDED.perNode.enterprise,
    30_000,
    240_000,
  ),
  perNodeSovereignMs: envMs(
    'JRX_QUEEN_NODE_TIMEOUT_SOVEREIGN_MS',
    NV_TIMEOUT_RECOMMENDED.perNode.sovereign,
    60_000,
    300_000,
  ),
} as const;

/** Snapshot for ops/docs/health — no secrets. */
export function getTimeoutPolicySnapshot(): Record<string, number | Record<string, number>> {
  return {
    recommended: { ...NV_TIMEOUT_RECOMMENDED.perNode, edgeHttpMs: NV_TIMEOUT_RECOMMENDED.edgeHttpMs },
    live: {
      llmProviderMs: NV_TIMEOUTS.llmProviderMs,
      llmProviderStreamMs: NV_TIMEOUTS.llmProviderStreamMs,
      llmMasterMs: NV_TIMEOUTS.llmMasterMs,
      nysKnowledgeMs: NV_TIMEOUTS.nysKnowledgeMs,
      caselawHybridBudgetMs: NV_TIMEOUTS.caselawHybridBudgetMs,
      caselawFtsFallbackBudgetMs: NV_TIMEOUTS.caselawFtsFallbackBudgetMs,
      athenaQueryBudgetMs: NV_TIMEOUTS.athenaQueryBudgetMs,
      adaptiveRagMs: NV_TIMEOUTS.adaptiveRagMs,
      pgStatementMs: NV_TIMEOUTS.pgStatementMs,
      orchWallClockMs: NV_TIMEOUTS.orchWallClockMs,
      queenMaxHierarchyDepth: NV_TIMEOUTS.queenMaxHierarchyDepth,
      perNodeLiteMs: NV_TIMEOUTS.perNodeLiteMs,
      perNodeMitraMs: NV_TIMEOUTS.perNodeMitraMs,
      perNodeEnterpriseMs: NV_TIMEOUTS.perNodeEnterpriseMs,
      perNodeSovereignMs: NV_TIMEOUTS.perNodeSovereignMs,
      taskTierMicroMs: NV_TASK_TIER_TIMEOUTS.micro,
      taskTierFastMs: NV_TASK_TIER_TIMEOUTS.fast,
      taskTierStandardMs: NV_TASK_TIER_TIMEOUTS.standard,
      taskTierDeepMs: NV_TASK_TIER_TIMEOUTS.deep,
    },
  };
}

/**
 * NV-LLM-DEADLINE-001 — task-tiered per-attempt provider budgets.
 *
 * Measured defect: every provider attempt used ONE flat budget (45s sync /
 * 120s stream) regardless of what was being asked. A one-line statute question
 * whose p50 is ~2s could therefore hold the connection for 45s before the
 * cascade advanced, and a five-rung ladder could spend 225s on a request the
 * caller expected in seconds. The tier caps below bound a single attempt; the
 * request deadline (below) bounds the whole cascade.
 */
export const NV_TASK_TIER_TIMEOUTS = {
  micro: envMs('JRX_LLM_ATTEMPT_MICRO_MS', 12_000, 3_000, 120_000),
  fast: envMs('JRX_LLM_ATTEMPT_FAST_MS', 25_000, 5_000, 180_000),
  standard: envMs('JRX_LLM_ATTEMPT_STANDARD_MS', NV_TIMEOUT_RECOMMENDED.llmProviderMs, 10_000, 300_000),
  deep: envMs('JRX_LLM_ATTEMPT_DEEP_MS', 180_000, 30_000, 360_000),
} as const;

export type LlmAttemptTier = keyof typeof NV_TASK_TIER_TIMEOUTS;

/**
 * Request-scoped deadline, following NV-QUEEN-DEADLINE-001 exactly: record the
 * deadline ONCE at the start of a request, then hand every subsequent attempt
 * `min(its own cap, time actually remaining)`. Deliberately the same shape as
 * the Queen helper (`startQueenDeadline` / `queenTimeRemainingMs`) rather than a
 * competing abstraction — the Queen keys its WeakMap on the orchestration
 * request object, which the LLM cascade does not have, so it passes an absolute
 * epoch-ms deadline down instead.
 */
export interface RequestDeadline {
  /** Absolute epoch ms after which no new provider attempt may be started. */
  deadlineAt: number;
}

export function startRequestDeadline(budgetMs: number, startedAt = Date.now()): RequestDeadline {
  return { deadlineAt: startedAt + Math.max(1_000, budgetMs) };
}

export function timeRemainingMs(deadline?: RequestDeadline | number): number | undefined {
  if (deadline == null) return undefined;
  const at = typeof deadline === 'number' ? deadline : deadline.deadlineAt;
  if (!Number.isFinite(at) || at <= 0) return undefined;
  return Math.max(0, at - Date.now());
}

/**
 * Per-attempt budget = min(tier cap, remaining). The 3s floor exists so a nearly
 * exhausted deadline fails fast and cleanly instead of opening a connection that
 * is certain to be cut mid-generation — a call we would still be billed for.
 */
/**
 * Phase 0 caselaw hybrid → FTS fallback trigger (timeout treated like 503).
 * Exported for route handler + unit tests.
 */
export function caselawHybridFtsFallbackReason(result: {
  ok: boolean;
  status: number;
  error?: string;
}): string | null {
  if (result.ok) return null;
  if (/abort|timeout|timed out|time.?out|ETIMEDOUT|ECONNRESET/i.test(String(result.error ?? ''))) {
    return 'timeout';
  }
  if (result.status === 503 || result.status === 502) {
    return result.status === 503 ? 'upstream_503' : 'upstream_502';
  }
  return null;
}

/**
 * NV-CASELAW-HYBRID-FALLBACK-001 — hybrid can return HTTP 200 with total=0 when the
 * NYS corpus is under embed load (statement_timeout → emptyDegraded). FTS-only is
 * faster and often succeeds for the same query; retry when hybrid is empty within budget.
 */
export function caselawHybridEmptyFtsFallbackReason(result: {
  ok: boolean;
  data?: unknown;
}): string | null {
  if (result.ok === false) return null;
  if (!result.data || typeof result.data !== 'object') return 'empty_hybrid';
  const payload = result.data as Record<string, unknown>;
  const total = Number(payload.total ?? 0);
  const results = payload.results;
  const resultCount = Array.isArray(results) ? results.length : 0;
  if (total === 0 && resultCount === 0) return 'empty_hybrid';
  return null;
}

/** First matching hybrid→FTS fallback reason (error, timeout, or empty success). */
export function resolveCaselawHybridFtsFallbackReason(result: {
  ok: boolean;
  status: number;
  error?: string;
  data?: unknown;
}): string | null {
  return (
    caselawHybridFtsFallbackReason(result) ?? caselawHybridEmptyFtsFallbackReason(result)
  );
}

export function attemptBudgetMs(
  tier: LlmAttemptTier,
  remainingMs?: number,
  streaming = false,
): number {
  const cap = streaming
    ? Math.max(NV_TASK_TIER_TIMEOUTS[tier], NV_TIMEOUTS.llmProviderStreamMs / 2)
    : NV_TASK_TIER_TIMEOUTS[tier];
  if (remainingMs == null) return Math.floor(cap);
  return Math.max(3_000, Math.floor(Math.min(cap, remainingMs)));
}
