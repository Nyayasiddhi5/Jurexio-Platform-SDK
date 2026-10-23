/**
 * Cost-Aware LLM Router — Algorithm P1
 * @version 6.0.0
 *
 * Classifies query complexity, then delegates model selection to the platform's
 * single evidence-based scorer (`intelligent-router/pickSequence`).
 *
 * ── NV-COST-ROUTER-SSOT-001 (2026-08-16) ────────────────────────────────────
 * This module used to carry its OWN hardcoded eight-model catalog
 * (`claude-3-haiku`, `gpt-4o`, `gpt-4o-mini`, `gemini-flash-1.5`,
 * `mistral-7b`, `gemma-2-27b`, `llama-3.1-70b`, `claude-3.7-sonnet` — all via
 * OpenRouter, all 2024-era) with hand-written `costPerMTok` and `qualityScore`
 * numbers. It was completely disconnected from `intelligent-router/model-catalog.ts`,
 * which is the real registry: 60+ entries carrying measured cost, `legalQuality`,
 * `speedScore`, `preferredFor`, `jurisdictionFit`, live provider availability
 * (`isProviderAvailable`) and circuit-breaker health (`getHealthScore`).
 *
 * That mattered because `jrx-queen-orchestrator.resolveAgentModelRouting()` calls
 * `selectModel()` for every Queen leaf. The stale catalog meant leaf routing
 * ignored availability, health, jurisdiction, task fit and real prices — the
 * "picked by whim, not by evidence" problem. Worse, it could name models this
 * account cannot call at all.
 *
 * The complexity classifier below is kept (it is this module's actual value —
 * a cheap, deterministic, zero-LLM read of how hard the prompt is) and is mapped
 * onto the scorer's inputs. `NV_TASK_MODEL_POLICY` in
 * `jrx-llm-model-policy.ts` owns the ranking itself.
 *
 * Tiers (cheapest → most expensive) now describe INTENT, and the scorer resolves
 * them against models that are actually live:
 *   nano   → simple FAQ / lookup            (cheapest live model that can answer)
 *   micro  → moderate analysis
 *   macro  → drafting, reasoning
 *   expert → complex legal, expert opinion  (frontier)
 */

import { createLogger } from '../utils/logger.js';
import { pickSequence } from './intelligent-router/intelligent-router.js';
import type { RouterRequest, TaskKind, TierLevel } from './intelligent-router/router-types.js';

const logger = createLogger('cost-aware-router');

/* ── Types ─────────────────────────────────────────────────── */

export type ComplexityTier = 'nano' | 'micro' | 'macro' | 'expert';

export interface RoutingDecision {
  tier: ComplexityTier;
  provider: string;
  model: string;
  estimatedCostUSD: number;
  reason: string;
  /**
   * Ordered fallback ladder behind `model`, straight from the scorer — same
   * availability, health and task filters as the primary. Callers that used to
   * invent their own fallback list should consume this instead.
   */
  fallbacks: Array<{ provider: string; model: string }>;
}

export interface RouterConfig {
  maxBudgetUSD?: number;
  preferredProvider?: string;
  domain?: string;
  forceExpert?: boolean;
  /** Jurisdiction hint so jurisdictionFit participates (defaults to IN). */
  jurisdiction?: string;
  /** Billing/capability tier hint; defaults per complexity tier. */
  tier?: string;
  /** Task hint; when omitted it is derived from the complexity tier + domain. */
  taskKind?: TaskKind;
  /** Expected output size, so context fit and cost are scored honestly. */
  expectedOutputTokens?: number;
}

/* ── Complexity classifier (deterministic, zero LLM) ───────── */

const EXPERT_SIGNALS = [
  /constitutional\s+validity/i,
  /supreme\s+court\s+judgment/i,
  /multi.?jurisdiction/i,
  /cross.?border\s+(dispute|arbitration)/i,
  /draft\s+(agreement|contract|deed|petition|plaint)/i,
  /compliance\s+audit/i,
  /due\s+diligence/i,
  /regulatory\s+framework/i,
];

const MACRO_SIGNALS = [
  /section\s+\d+/i,
  /legal\s+opinion/i,
  /precedent/i,
  /arbitration/i,
  /intellectual\s+property/i,
  /patent|copyright|trademark/i,
  /contract\s+review/i,
  /liability/i,
];

const NANO_SIGNALS = [
  /^what\s+is/i,
  /^define\s+/i,
  /^how\s+to\s+file/i,
  /^list\s+/i,
  /summary\s+of/i,
];

export function classifyComplexity(prompt: string, domain?: string): ComplexityTier {
  if (EXPERT_SIGNALS.some(r => r.test(prompt))) return 'expert';
  if (domain === 'legal' || domain === 'compliance') {
    if (MACRO_SIGNALS.some(r => r.test(prompt))) return 'macro';
  }
  if (MACRO_SIGNALS.some(r => r.test(prompt))) return 'macro';
  if (NANO_SIGNALS.some(r => r.test(prompt))) return 'nano';
  if (prompt.length < 200) return 'nano';
  if (prompt.length < 800) return 'micro';
  return 'macro';
}

/* ── Complexity tier → scorer inputs ───────────────────────── */

/**
 * Map a complexity tier onto the capability tier the scorer understands. The
 * scorer's `tierFitScore` uses this to decide how much premium spend is
 * justified, and `preferCheaper` is derived from it for free/solo.
 */
function tierForComplexity(t: ComplexityTier): TierLevel {
  switch (t) {
    case 'nano':   return 'solo';
    case 'micro':  return 'plus';
    case 'macro':  return 'pro';
    case 'expert': return 'enterprise';
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

/**
 * Map a complexity tier + domain onto a task kind, so `preferredFor` and
 * `legalAffinityScore` engage. Legal domains keep legal task kinds; everything
 * else degrades to general work.
 */
function taskKindForComplexity(t: ComplexityTier, domain?: string): TaskKind {
  const legalish = !domain
    || /legal|compliance|litigation|contract|drafting|research|regulatory/i.test(domain);
  switch (t) {
    case 'nano':   return legalish ? 'classification' : 'generic_chat';
    case 'micro':  return legalish ? 'summarization' : 'generic_chat';
    case 'macro':  return legalish ? 'legal_research' : 'generic_chat';
    case 'expert': return legalish ? 'litigation_strategy' : 'chain_of_thought';
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

/* ── Main routing function ─────────────────────────────────── */

export function selectModel(
  prompt: string,
  config: RouterConfig = {}
): RoutingDecision {
  const tier = config.forceExpert
    ? 'expert'
    : classifyComplexity(prompt, config.domain);

  // ~3 chars/token is the platform-wide estimate used elsewhere in this module's
  // history; keep it so cost figures stay comparable across releases.
  const promptTokens = Math.ceil(prompt.length / 3) + 500;
  const expectedOutputTokens = config.expectedOutputTokens ?? 500;

  const req: RouterRequest = {
    tier: config.tier ?? tierForComplexity(tier),
    jurisdiction: config.jurisdiction ?? 'IN',
    taskKind: config.taskKind ?? taskKindForComplexity(tier, config.domain),
    promptTokens,
    expectedOutputTokens,
    // A budget cap is a HARD filter in the scorer (`costFitScore` returns -1000),
    // so an over-budget model cannot win — the same contract this module had.
    maxCostUsd: config.maxBudgetUSD,
    preferCheaper: tier === 'nano' || tier === 'micro',
  };

  const decision = pickSequence(req);
  const chosen = decision.primary;

  const estimatedCost =
    ((promptTokens * chosen.costInPer1M) + (expectedOutputTokens * chosen.costOutPer1M)) / 1_000_000;

  // Honour a provider preference only if the scorer already ranked that provider
  // as viable — never by overriding availability or health.
  let provider = chosen.provider as string;
  let model = chosen.id;
  let reason = `Complexity: ${tier}; task: ${req.taskKind}; scored by intelligent-router`;
  if (config.preferredProvider) {
    const match = decision.sequence.find((m) => m.provider === config.preferredProvider);
    if (match) {
      provider = match.provider;
      model = match.id;
      reason += `; honoured preferredProvider=${config.preferredProvider}`;
    } else {
      reason += `; preferredProvider=${config.preferredProvider} unavailable, kept scored lead`;
    }
  }

  const out: RoutingDecision = {
    tier,
    provider,
    model,
    estimatedCostUSD: parseFloat(estimatedCost.toFixed(6)),
    reason,
    fallbacks: decision.sequence
      .filter((m) => m.id !== model)
      .slice(0, 5)
      .map((m) => ({ provider: m.provider as string, model: m.id })),
  };

  logger.info('routing_decision', {
    ...out,
    fallbackCount: out.fallbacks.length,
    scoredReasons: decision.reasonsByModel[model]?.join(' ') ?? '',
  });
  return out;
}
