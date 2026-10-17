/**
 * Task #156 — Mem0 hooks for the SME Legal Chat send path.
 *
 * Wires `Mem0PersistenceService` as the **6th preference-only memory tier**
 * for SME runs. This DOES NOT replace the platform's existing 5-tier
 * memory architecture (working / episodic / semantic / procedural /
 * GraphRAG) — it sits ALONGSIDE it as a long-running per-SME preference
 * store keyed by SME user id.
 *
 * Two phases:
 *   - PRE-SEND  (`recallSmePreferences`): fetch top relevant prior
 *     SME-rated outputs and inject as a `metadata.smePreferenceContext`
 *     that the queen orchestrator surfaces in the synthesis system prompt.
 *   - POST-SEND (`storeSmeInteraction`): persist (prompt, response,
 *     citations, model, rubric outcome if available) so future runs can
 *     recall what *this* SME prefers.
 *
 * The Mem0 store keeps a per-process hot cache (matches the existing service).
 * Durable, embedding-backed Postgres backing (nv_schema.mem0_memories) is now
 * available behind JRX_F_MEM0_DURABLE (default OFF): when enabled, store()/
 * recall() survive a restart and span replicas via the SAME API used here, so
 * these hooks need no change. (NYV-SVC-MEM0-DURABLE-001 — supersedes the
 * "out of scope for Task #156" note.)
 */

import { Mem0PersistenceService } from '../mem0-persistence-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('sme-mem0-hooks');

// Singleton so the SME chat tool shares one preference store across the
// gateway lifetime. Distinct from the platform's main memory tiers.
let _instance: Mem0PersistenceService | null = null;

function getStore(): Mem0PersistenceService {
  if (!_instance) {
    _instance = new Mem0PersistenceService({
      maxMemoriesPerAgent: 5000,
      consolidationThreshold: 0.85,
      enableConsolidation: true,
      enableForgetting: true,
    });
  }
  return _instance;
}

/** Stable per-SME namespace string. */
function nsFor(smeUserId: number | string, jurisdiction: string): string {
  return `sme:${smeUserId}:${(jurisdiction || 'GLOBAL').toUpperCase()}`;
}

export interface SmePreferenceContext {
  hits: number;
  facts: string[];
  recent: Array<{ content: string; score: number; ts: string }>;
}

/**
 * Pre-send: pull the top-k preference memories for this SME and prompt.
 * NEVER throws — returns an empty context on any failure.
 */
export async function recallSmePreferences(opts: {
  smeUserId: number | string;
  jurisdiction: string;
  prompt: string;
  topK?: number;
}): Promise<SmePreferenceContext> {
  try {
    const ns = nsFor(opts.smeUserId, opts.jurisdiction);
    const agentId = `sme-${opts.smeUserId}`;
    const limit = opts.topK ?? 5;
    const results = await getStore().recall(agentId, opts.prompt, {
      namespace: ns,
      limit,
      minStrength: 0.1,
    });
    const ctx = await getStore().getAgentContext(agentId, ns);
    return {
      hits: results.length,
      facts: (ctx.keyFacts ?? []).slice(0, 8),
      recent: results.map((r) => ({
        content: r.memory.content.slice(0, 600),
        score: r.relevanceScore,
        ts: r.memory.lastAccessedAt,
      })),
    };
  } catch (e) {
    logger.warn('[sme-mem0] recall failed (non-fatal): ' + (e as Error).message);
    return { hits: 0, facts: [], recent: [] };
  }
}

/**
 * Post-send: persist the (prompt, response, model, jurisdiction, rubric?)
 * tuple so future recalls can surface what this SME found useful. NEVER
 * throws — fire-and-forget from the route handler.
 */
export async function storeSmeInteraction(opts: {
  smeUserId: number | string;
  jurisdiction: string;
  taskKind: string;
  model: string;
  prompt: string;
  response: string;
  orchestrationId: string;
  rubricAvgScore?: number;
  preferredOver?: string;
  citations?: unknown[];
}): Promise<void> {
  try {
    const ns = nsFor(opts.smeUserId, opts.jurisdiction);
    const agentId = `sme-${opts.smeUserId}`;
    const importance = typeof opts.rubricAvgScore === 'number'
      ? Math.max(0.3, Math.min(1, opts.rubricAvgScore))
      : 0.5;
    const summary = `[${opts.taskKind}|${opts.model}] ${opts.prompt.slice(0, 120)}`;
    const content =
      `Q: ${opts.prompt.slice(0, 1500)}\n` +
      `A: ${opts.response.slice(0, 3000)}\n` +
      `model=${opts.model} jurisdiction=${opts.jurisdiction} taskKind=${opts.taskKind}` +
      (typeof opts.rubricAvgScore === 'number' ? ` rubricAvg=${opts.rubricAvgScore.toFixed(2)}` : '');
    await getStore().store(agentId, content, {
      type: 'episodic',
      namespace: ns,
      importance,
      tags: ['sme-run', `j:${opts.jurisdiction}`, `t:${opts.taskKind}`, `m:${opts.model}`],
      metadata: {
        orchestrationId: opts.orchestrationId,
        model: opts.model,
        jurisdiction: opts.jurisdiction,
        taskKind: opts.taskKind,
        rubricAvgScore: opts.rubricAvgScore ?? null,
        preferredOver: opts.preferredOver ?? null,
        citationCount: Array.isArray(opts.citations) ? opts.citations.length : 0,
        summary,
      },
    });
  } catch (e) {
    logger.warn('[sme-mem0] store failed (non-fatal): ' + (e as Error).message);
  }
}

/**
 * Reinforce / penalize a prior interaction's strength based on a rubric
 * verdict. Strengthens or fades the corresponding mem0 entries that
 * carry this orchestrationId. Best-effort.
 */
export async function applyRubricToMem0(opts: {
  smeUserId: number | string;
  jurisdiction: string;
  orchestrationId: string;
  avgScore: number;
}): Promise<void> {
  try {
    const ns = nsFor(opts.smeUserId, opts.jurisdiction);
    const agentId = `sme-${opts.smeUserId}`;
    const ctx = await getStore().getAgentContext(agentId, ns);
    for (const m of ctx.recentMemories) {
      const md = (m.metadata && typeof m.metadata === 'object') ? m.metadata as { orchestrationId?: string } : {};
      if (md.orchestrationId === opts.orchestrationId) {
        if (opts.avgScore >= 0.7) {
          await getStore().reinforce(m.id);
        } else if (opts.avgScore < 0.4) {
          await getStore().forget(m.id);
        }
      }
    }
  } catch (e) {
    logger.warn('[sme-mem0] applyRubric failed (non-fatal): ' + (e as Error).message);
  }
}
