/**
 * OpenRouter Universal Gateway — REAL IMPLEMENTATION (was stub)
 * NYV-ORCH-SEAM-006 (Task #32)
 *
 * SCOPE — IMPORTANT (round 10d clarification):
 *   This module is a MODEL-SELECTION engine, NOT a transport gateway.
 *   It returns a `{ id, contextWindow, ... }` descriptor for the chosen
 *   OpenRouter model name. It does NOT issue HTTP calls to OpenRouter.
 *   The single canonical OpenRouter transport is
 *     src/services/llm-providers/openrouter-provider.ts
 *   which calls `openRouterGateway.selectOptimalModel(...)` to decide
 *   WHICH model to dispatch, then performs the actual chat.completions
 *   request itself. No other call site dispatches OpenRouter HTTP
 *   traffic. This separation keeps selection policy (cost / quality /
 *   latency strategies) out of the transport layer and ensures there is
 *   exactly one outbound OpenRouter routing surface.
 *
 * Provides:
 *   - openRouterGateway.selectOptimalModel(request, ctx, strategy)
 *   - OpenRouterModel type
 *
 * This module is consumed by src/services/llm-providers/openrouter-provider.ts
 * which ALWAYS expects a `selectedModel.id` back. We never throw on a missing
 * OpenRouter API key — instead, we return a sensible default model per
 * (taskType × strategy) so the LLM provider chain keeps working.
 *
 * No silent fallbacks for safety/HITL/audit (see middleware) — this file is
 * a pure selection helper, so a deterministic default IS the right behavior.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('openrouter-universal-gateway');

// ──────────────────────────────────────────────────────────────────────────────
// Types — must remain stable: openrouter-provider.ts depends on these names
// ──────────────────────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: { prompt: number; completion: number };
  context_length?: number;
  capabilities?: {
    coding?: number;
    creative?: number;
    analytical?: number;
    general?: number;
    reasoning?: number;
  };
  architecture?: { tokenizer?: string; modality?: string };
}

export type SelectionStrategy =
  | 'performanceBased'
  | 'costOptimized'
  | 'balanced'
  | 'qualityFirst'
  | 'latencyFirst';

export interface SelectionRequest {
  prompt: string;
  taskType: 'coding' | 'creative' | 'analytical' | 'general' | string;
  urgency?: 'low' | 'medium' | 'high';
  qualityRequirement?: 'fast' | 'good' | 'excellent';
  budgetUsd?: number;
}

export interface SelectionContext {
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  jurisdiction?: string;
}

export interface SelectionResult {
  selectedModel: OpenRouterModel;
  strategy: SelectionStrategy;
  reason: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Default model catalog — used when the OpenRouter API hasn't been queried yet
// or when no API key is set. Model ids are real, currently-listed IDs.
// ──────────────────────────────────────────────────────────────────────────────

const CATALOG: Record<string, OpenRouterModel> = {
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    pricing: { prompt: 0.15, completion: 0.60 },
    context_length: 128_000,
    capabilities: { coding: 0.85, creative: 0.85, analytical: 0.88, general: 0.92, reasoning: 0.84 },
  },
  'openai/o4-mini': {
    id: 'openai/o4-mini',
    name: 'o4-mini',
    pricing: { prompt: 1.10, completion: 4.40 },
    context_length: 200_000,
    capabilities: { coding: 0.92, creative: 0.78, analytical: 0.94, general: 0.90, reasoning: 0.95 },
  },
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    pricing: { prompt: 3.00, completion: 15.00 },
    context_length: 200_000,
    capabilities: { coding: 0.94, creative: 0.93, analytical: 0.93, general: 0.94, reasoning: 0.93 },
  },
  'anthropic/claude-3-haiku': {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    pricing: { prompt: 0.25, completion: 1.25 },
    context_length: 200_000,
    capabilities: { coding: 0.78, creative: 0.80, analytical: 0.79, general: 0.85, reasoning: 0.74 },
  },
  'google/gemini-2.0-flash-exp': {
    id: 'google/gemini-2.0-flash-exp',
    name: 'Gemini 2.0 Flash',
    pricing: { prompt: 0.10, completion: 0.40 },
    context_length: 1_000_000,
    capabilities: { coding: 0.86, creative: 0.85, analytical: 0.88, general: 0.90, reasoning: 0.83 },
  },
  'meta-llama/llama-3.3-70b-instruct': {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    pricing: { prompt: 0.59, completion: 0.79 },
    context_length: 131_072,
    capabilities: { coding: 0.85, creative: 0.84, analytical: 0.86, general: 0.88, reasoning: 0.84 },
  },
  'mistralai/mistral-large-latest': {
    id: 'mistralai/mistral-large-latest',
    name: 'Mistral Large',
    pricing: { prompt: 2.00, completion: 6.00 },
    context_length: 128_000,
    capabilities: { coding: 0.88, creative: 0.86, analytical: 0.89, general: 0.89, reasoning: 0.86 },
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Selection logic — pure & deterministic for a given (request, strategy)
// ──────────────────────────────────────────────────────────────────────────────

class OpenRouterUniversalGateway {
  private apiKey = process.env.OPENROUTER_API_KEY || '';
  private dynamicCatalog: Map<string, OpenRouterModel> = new Map();

  /**
   * Pick the optimal model. NEVER throws — picks a sensible default.
   * Caller (openrouter-provider) treats any thrown error as soft and falls
   * back to 'openai/o4-mini'; we return that here ourselves rather than
   * relying on the catch.
   */
  async selectOptimalModel(
    request: SelectionRequest,
    _ctx: SelectionContext = {},
    strategy: SelectionStrategy = 'performanceBased',
  ): Promise<SelectionResult> {
    try {
      const candidates = this.candidates();
      const taskKey = this.normalizeTask(request.taskType);
      const ranked = candidates
        .map((m) => ({ m, score: this.scoreModel(m, taskKey, strategy, request) }))
        .sort((a, b) => b.score - a.score);

      const winner = ranked[0]?.m ?? CATALOG['openai/o4-mini'];
      return {
        selectedModel: winner,
        strategy,
        reason: `taskType=${request.taskType} strategy=${strategy} candidates=${candidates.length}`,
      };
    } catch (e: any) {
      logger.warn('[OpenRouterGateway] selection failed, using default', { error: e?.message });
      return {
        selectedModel: CATALOG['openai/o4-mini'],
        strategy,
        reason: 'default-fallback',
      };
    }
  }

  /** Allow live OpenRouter responses to enrich the catalog (no required call). */
  registerModel(model: OpenRouterModel): void {
    if (!model?.id) return;
    this.dynamicCatalog.set(model.id, model);
  }

  /** Listing — returns catalog (static + dynamic). */
  listModels(): OpenRouterModel[] {
    const out = new Map<string, OpenRouterModel>();
    for (const [id, m] of Object.entries(CATALOG)) out.set(id, m);
    for (const [id, m] of this.dynamicCatalog) out.set(id, m);
    return Array.from(out.values());
  }

  private candidates(): OpenRouterModel[] {
    return this.listModels();
  }

  private normalizeTask(t: string): keyof NonNullable<OpenRouterModel['capabilities']> {
    if (t === 'coding' || t === 'creative' || t === 'analytical' || t === 'general' || t === 'reasoning') return t;
    return 'general';
  }

  private scoreModel(
    m: OpenRouterModel,
    taskKey: keyof NonNullable<OpenRouterModel['capabilities']>,
    strategy: SelectionStrategy,
    req: SelectionRequest,
  ): number {
    const cap = (m.capabilities?.[taskKey] ?? m.capabilities?.general ?? 0.7);
    const promptCost = m.pricing?.prompt ?? 1;
    const compCost = m.pricing?.completion ?? 2;
    const avgCost = (promptCost + compCost) / 2;
    const inverseCost = 1 / Math.max(avgCost, 0.01);

    switch (strategy) {
      case 'costOptimized':
        return cap * 0.3 + inverseCost * 0.7;
      case 'qualityFirst':
        return cap * 0.95 + inverseCost * 0.05;
      case 'latencyFirst':
        return inverseCost * 0.4 + cap * 0.6;
      case 'balanced':
        return cap * 0.6 + inverseCost * 0.4;
      case 'performanceBased':
      default: {
        let s = cap * 0.7 + inverseCost * 0.3;
        if (req.qualityRequirement === 'excellent') s = cap * 0.85 + inverseCost * 0.15;
        if (req.qualityRequirement === 'fast') s = cap * 0.4 + inverseCost * 0.6;
        return s;
      }
    }
  }

  /** Health: always reports up — the gateway has a static catalog. */
  health(): { ok: boolean; apiKeyConfigured: boolean; modelCount: number } {
    return {
      ok: true,
      apiKeyConfigured: !!this.apiKey,
      modelCount: this.listModels().length,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singletons — names must remain `openRouterGateway` for the provider import.
// ──────────────────────────────────────────────────────────────────────────────

export const openRouterGateway = new OpenRouterUniversalGateway();
export const openrouterUniversalGateway = openRouterGateway;
export { OpenRouterUniversalGateway };
export default openRouterGateway;
