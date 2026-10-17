/**
 * Agent Orchestration — REAL DELEGATION SEAM
 * JRX-ORCH-SEAM-001 (Task #32)
 *
 * Replaces previous stub. All work routes to the Queen Orchestrator and the
 * Capability Manifest. Keeps the legacy class shape so existing imports
 * (`import { AgentOrchestrationService } from './agent-orchestration.js'`)
 * continue to compile, but every method is now a real bound delegation.
 *
 * IMPORTANT: This module never sets `agent.jurisdiction`. Jurisdiction is
 * resolved by precedence in Queen: explicit → user → tenant → DEFAULT.
 */

import { capabilityManifest, mapBillingTierToCapabilityTier, type CapabilityTier } from '../orchestration/capability-manifest.js';
import { withMiddleware } from '../orchestration/orchestration-middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-orchestration');

export interface AgentExecutionContext {
  userId?: string;
  tenantId?: string;
  jurisdiction?: string;        // explicit override (highest precedence in Queen)
  tier?: CapabilityTier | string;
  requestId?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * The opaque task envelope. Callers may pass a free-form string OR a
 * structured task object — we narrow with `extractPrompt` below.
 */
export type AgentTask =
  | string
  | { prompt?: string; task?: string;[k: string]: unknown };

export interface AgentExecutionResult {
  agentId: string;
  task: AgentTask;
  status: 'completed' | 'failed';
  result: unknown;
  metadata: Record<string, unknown>;
}

export interface OrchestrationResult {
  orchestrationId: string;
  agents: string[];
  task: AgentTask;
  status: 'completed' | 'failed';
  results: Record<string, unknown>;
  errors?: Record<string, string>;
}

/**
 * Structural shape of the queen orchestrator we delegate to. We type only
 * the surface we actually call, so the import-fallback below does not need
 * an `any` cast.
 */
interface QueenOrchestrateInput {
  prompt: string;
  type: string;
  userId?: string;
  jurisdiction?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  preferences?: { maxAgents?: number };
}
interface QueenOrchestrateOutput {
  success?: boolean;
  metadata?: { orchestrationPattern?: string };
  [k: string]: unknown;
}
interface QueenOrchestratorLike {
  orchestrate: (input: QueenOrchestrateInput) => Promise<QueenOrchestrateOutput>;
}

function extractPrompt(task: AgentTask): string {
  if (typeof task === 'string') return task;
  return task.prompt ?? task.task ?? JSON.stringify(task);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

async function loadQueenOrchestrator(): Promise<QueenOrchestratorLike | null> {
  try {
    const mod = await import('../orchestration/jrx-queen-orchestrator.js');
    const candidate =
      (mod as { queenOrchestrator?: unknown }).queenOrchestrator ??
      (mod as { default?: unknown }).default;
    if (
      candidate &&
      typeof (candidate as { orchestrate?: unknown }).orchestrate === 'function'
    ) {
      return candidate as QueenOrchestratorLike;
    }
  } catch (e: unknown) {
    logger.debug('[AgentOrchestration] queen orchestrator not loadable', {
      error: errorMessage(e),
    });
  }
  return null;
}

export class AgentOrchestrationService {
  /**
   * Execute a single agent through the Queen Orchestrator path.
   * Falls back to direct LLM call wrapped in middleware if Queen is
   * unavailable in the running tenant.
   */
  async executeAgent(
    agentId: string,
    task: AgentTask,
    context: AgentExecutionContext = {},
  ): Promise<AgentExecutionResult> {
    const tier = this.resolveTier(context.tier);
    const prompt = extractPrompt(task);
    const isProd = process.env.NODE_ENV === 'production';

    // Resolve Queen out-of-band so we can distinguish "Queen ABSENT"
    // (loader returned null) from "Queen ERRORED" (loader threw) from
    // "Queen.orchestrate failed" — each gets its own fail-loud path in
    // PROD with an unambiguous message. (Round 10e hardening — closes
    // the silent-degradation gap where loadQueenOrchestrator() returning
    // null would silently fall through to the dev-only echo fallback.)
    let queen: QueenOrchestratorLike | null = null;
    try {
      queen = await loadQueenOrchestrator();
    } catch (loaderErr: unknown) {
      if (isProd) {
        logger.error('[AgentOrchestration] Queen LOADER threw in PRODUCTION — refusing manifest-fallback echo', {
          agentId,
          tier,
          error: errorMessage(loaderErr),
          stack: errorStack(loaderErr),
        });
        throw new Error(
          `[AgentOrchestration] FAIL-LOUD: Queen orchestrator loader threw for agent=${agentId} ` +
            `tier=${tier}. Underlying: ${errorMessage(loaderErr)}. ` +
            `Refusing to synthesize a manifest-fallback echo in PRODUCTION.`,
        );
      }
      logger.warn('[AgentOrchestration] Queen loader threw, falling through to manifest (dev/test only)', {
        error: errorMessage(loaderErr),
        env: process.env.NODE_ENV,
      });
    }

    if (!queen && isProd) {
      logger.error('[AgentOrchestration] Queen orchestrator UNAVAILABLE in PRODUCTION — refusing manifest-fallback echo', {
        agentId,
        tier,
        env: process.env.NODE_ENV,
      });
      throw new Error(
        `[AgentOrchestration] FAIL-LOUD: Queen orchestrator unavailable (loader returned null) ` +
          `for agent=${agentId} tier=${tier} prompt-size=${prompt.length}. ` +
          `Refusing to synthesize a manifest-fallback echo in PRODUCTION.`,
      );
    }

    if (queen) {
      try {
        // Single-agent execution: prefix the prompt to give Queen a hint about
        // the desired agent. Queen still owns final agent selection — never
        // bypass `findOptimalAgent`. Jurisdiction precedence is preserved
        // because we pass `context.jurisdiction` only when explicitly given.
        const out = await queen.orchestrate({
          prompt: `[agent:${agentId}] ${prompt}`,
          type: 'general',
          userId: context.userId,
          jurisdiction: context.jurisdiction,
          priority: context.riskLevel === 'critical' ? 'critical'
                  : context.riskLevel === 'high' ? 'high'
                  : 'medium',
          preferences: { maxAgents: 1 },
        });
        return {
          agentId,
          task,
          status: out?.success ? 'completed' : 'failed',
          result: out,
          metadata: { via: 'queen', tier, pattern: out?.metadata?.orchestrationPattern },
        };
      } catch (err: unknown) {
        // Queen orchestrate() failure: in production this MUST surface —
        // synthesizing a bare-prompt echo as a fake completion would
        // silently degrade the platform and violate the original task's
        // "fail-loud" contract for safety/HITL/audit/orchestration paths.
        if (isProd) {
          logger.error('[AgentOrchestration] Queen path failed in PRODUCTION — refusing manifest-fallback echo', {
            agentId,
            error: errorMessage(err),
            stack: errorStack(err),
          });
          throw new Error(
            `[AgentOrchestration] FAIL-LOUD: Queen orchestrator failed for agent=${agentId} ` +
              `tier=${tier} prompt-size=${prompt.length}. Underlying error: ${errorMessage(err)}.`,
          );
        }
        logger.warn('[AgentOrchestration] Queen path failed, falling through to manifest (dev/test only)', {
          error: errorMessage(err),
          env: process.env.NODE_ENV,
        });
      }
    }

    // Manifest-only fallback path (dev/test only — gated by the PROD
    // throws above): use middleware + skills. Produces a clearly-marked
    // echo result so unit tests that run without a fully-bootstrapped
    // Queen still exercise the middleware ring. Reachable ONLY when
    // NODE_ENV !== 'production'.
    const wrapped = await withMiddleware(
      {
        prompt,
        agentKey: agentId,
        tier,
        jurisdiction: context.jurisdiction,
        userId: context.userId,
        tenantId: context.tenantId,
        requestId: context.requestId,
        riskLevel: context.riskLevel,
      },
      async (pre) => {
        // Activate skills (best effort)
        try {
          await capabilityManifest.invoke(
            'skills.activate',
            { practiceArea: 'all', taskType: 'general' },
            pre.ctx,
          );
        } catch { /* non-fatal */ }
        return {
          output: `[dev-fallback:${agentId}] received: ${prompt.slice(0, 200)}`,
          tokens: { input: Math.ceil(pre.enrichedPrompt.length / 4), output: 0 },
          devFallback: true,
        };
      },
    );

    return {
      agentId,
      task,
      status: 'completed',
      result: wrapped,
      metadata: { via: 'manifest-fallback', tier, devFallback: true },
    };
  }

  /**
   * Orchestrate multiple agents in parallel via the Capability Manifest.
   * Honors per-tier concurrency caps from orchestration-policy.
   */
  async orchestrate(
    agents: string[],
    task: AgentTask,
    strategy: 'parallel' | 'sequential' = 'parallel',
    context: AgentExecutionContext = {},
  ): Promise<OrchestrationResult> {
    const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tier = this.resolveTier(context.tier);
    const policyMod = await import('../orchestration/orchestration-policy.js');
    const policy = policyMod.getPolicyForTier(tier);

    const results: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    if (strategy === 'sequential') {
      for (const id of agents) {
        try {
          const r = await this.executeAgent(id, task, context);
          results[id] = r.result;
        } catch (e: unknown) {
          errors[id] = errorMessage(e);
        }
      }
    } else {
      const out = await policyMod.runWithConcurrency(
        agents,
        async (id) => this.executeAgent(id, task, context),
        { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
      );
      out.forEach((r, i) => {
        const id = agents[i];
        if (r.error) errors[id] = r.error.message;
        else results[id] = r.value?.result;
      });
    }

    const failed = Object.keys(errors).length;
    return {
      orchestrationId,
      agents,
      task,
      status: failed === 0 ? 'completed' : (failed === agents.length ? 'failed' : 'completed'),
      results,
      errors: failed ? errors : undefined,
    };
  }

  private resolveTier(tier?: CapabilityTier | string): CapabilityTier {
    if (!tier) return 'lite';
    if (typeof tier === 'string' && ['lite','mitra','enterprise','sovereign','white-label'].includes(tier)) {
      return tier as CapabilityTier;
    }
    return mapBillingTierToCapabilityTier(String(tier));
  }
}

export const agentOrchestrationService = new AgentOrchestrationService();
export default agentOrchestrationService;
