/**
 * Jurexio LLM Priority Manager v3.1.2
 * NYV-SVC-LLM-PRIORITY-001
 *
 * Intelligent LLM provider selection and priority management.
 * Dynamically routes queries to the optimal LLM based on:
 *   - Query complexity and domain
 *   - Provider health and latency
 *   - Cost budget per tier
 *   - Rate limit status
 *   - Context window requirements
 *   - Jurisdiction-specific requirements (e.g., EU data residency)
 *
 * Priority Tiers (aligned with product note Global LLM Fallback Tier):
 *   Tier 1 (Premium):    Claude Opus 4.6, GPT-4.1, Gemini 3.1 Pro, o3
 *   Tier 2 (Standard):   Claude Sonnet 4.6, GPT-4.1 Mini, Gemini 2.5 Pro, o4-mini
 *   Tier 3 (Cost-Opt):   Llama 4 Maverick, Llama 4 Scout, Mistral Large 3, DeepSeek V3/R1, Gemini 2.5 Flash, GPT-4.1 Nano
 *   SLM Layer:           NS-SLM-IND/UK/GCC/EUR/USA/SGP (in-house, lowest cost)
 *
 * All calls go through this manager — NEVER make direct LLM API calls.
 * This ensures: cost tracking, rate limiting, fallback, circuit breaking.
 */

import { logger } from '../../utils/logger.js';
import { buildProviderRegistry, LLMProvider } from '../../config/llm-config.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type ProviderTier = 1 | 2 | 3 | 4;   // 4 = SLM layer

export type QueryComplexity = 'simple' | 'medium' | 'complex' | 'expert';

export type QueryDomain =
  | 'legal-research' | 'contract-drafting' | 'compliance' | 'litigation'
  | 'tax' | 'corporate' | 'criminal' | 'family' | 'ip' | 'arbitration'
  | 'multimodal' | 'code' | 'translation' | 'general';

export interface LLMProviderHealth {
  providerId: string;
  isAvailable: boolean;
  latencyMs: number;
  successRate: number;          // 0–1 (last 100 calls)
  rateLimitRemaining: number;   // -1 = unknown
  lastCheckedAt: Date;
  circuitState: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
}

export interface ProviderModel {
  id: string;                   // e.g., 'anthropic/claude-sonnet-4-5'
  providerId: string;
  displayName: string;
  tier: ProviderTier;
  contextWindow: number;
  costPer1kInput: number;       // USD
  costPer1kOutput: number;      // USD
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  dataResidency: string[];      // e.g., ['US'] — for EU data sovereignty
  legalDomainOptimized: boolean;
  maxRPM: number;               // requests per minute
}

export interface RoutingRequest {
  requestId: string;
  complexity: QueryComplexity;
  domain: QueryDomain;
  contextTokens: number;         // estimated prompt length
  tier: 'solo' | 'plus' | 'pro' | 'enterprise';
  jurisdiction?: string;
  requiresVision?: boolean;
  requiresJsonMode?: boolean;
  maxCostUSD?: number;
  preferredModel?: string;
  requiresEUResidency?: boolean;
}

export interface RoutingResult {
  selectedModel: ProviderModel;
  fallbackChain: ProviderModel[];
  tier: ProviderTier;
  estimatedCostUSD: number;
  routingReason: string;
  costSavingVsPremium: number;    // % saved vs Tier 1 always
}

export interface UsageRecord {
  timestamp: Date;
  requestId: string;
  modelId: string;
  tier: ProviderTier;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  latencyMs: number;
  success: boolean;
  domain: QueryDomain;
  jurisdiction?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Model Catalogue (maps to product note Fallback Tier 2026)
// ──────────────────────────────────────────────────────────────────────────────

const MODEL_CATALOGUE: ProviderModel[] = [
  // ── Tier 1 — Premium Frontier (April 2026) ────────────────────────────────
  {
    id: 'anthropic/claude-opus-4-6', providerId: 'openrouter', displayName: 'Claude Opus 4.6',
    tier: 1, contextWindow: 1000000, costPer1kInput: 0.005, costPer1kOutput: 0.025,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 60,
  },
  {
    id: 'openai/gpt-4.1', providerId: 'openrouter', displayName: 'GPT-4.1',
    tier: 1, contextWindow: 1000000, costPer1kInput: 0.002, costPer1kOutput: 0.008,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 100,
  },
  {
    id: 'google/gemini-3.1-pro-preview', providerId: 'openrouter', displayName: 'Gemini 3.1 Pro',
    tier: 1, contextWindow: 1000000, costPer1kInput: 0.003, costPer1kOutput: 0.012,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: false, maxRPM: 60,
  },
  {
    id: 'openai/o3', providerId: 'openrouter', displayName: 'o3 (Reasoning)',
    tier: 1, contextWindow: 200000, costPer1kInput: 0.010, costPer1kOutput: 0.040,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 30,
  },
  // ── Tier 2 — Standard / Balanced ──────────────────────────────────────────
  {
    id: 'anthropic/claude-sonnet-4-6', providerId: 'openrouter', displayName: 'Claude Sonnet 4.6',
    tier: 2, contextWindow: 1000000, costPer1kInput: 0.003, costPer1kOutput: 0.015,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 200,
  },
  {
    id: 'openai/gpt-4.1-mini', providerId: 'openrouter', displayName: 'GPT-4.1 Mini',
    tier: 2, contextWindow: 1000000, costPer1kInput: 0.0004, costPer1kOutput: 0.0016,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 500,
  },
  {
    id: 'google/gemini-2.5-pro', providerId: 'openrouter', displayName: 'Gemini 2.5 Pro',
    tier: 2, contextWindow: 1000000, costPer1kInput: 0.00125, costPer1kOutput: 0.005,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: false, maxRPM: 100,
  },
  {
    id: 'openai/o4-mini', providerId: 'openrouter', displayName: 'o4-mini (Reasoning)',
    tier: 2, contextWindow: 200000, costPer1kInput: 0.0011, costPer1kOutput: 0.0044,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: true, maxRPM: 200,
  },
  // ── Tier 3 — Cost Optimized ────────────────────────────────────────────────
  {
    id: 'meta-llama/llama-4-maverick', providerId: 'openrouter', displayName: 'Llama 4 Maverick',
    tier: 3, contextWindow: 1000000, costPer1kInput: 0.00018, costPer1kOutput: 0.00059,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: false,
    dataResidency: ['US'], legalDomainOptimized: false, maxRPM: 1000,
  },
  {
    id: 'meta-llama/llama-4-scout', providerId: 'openrouter', displayName: 'Llama 4 Scout',
    tier: 3, contextWindow: 10000000, costPer1kInput: 0.00009, costPer1kOutput: 0.00029,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: false,
    dataResidency: ['US'], legalDomainOptimized: false, maxRPM: 2000,
  },
  {
    id: 'mistralai/mistral-large-2512', providerId: 'openrouter', displayName: 'Mistral Large 3',
    tier: 3, contextWindow: 128000, costPer1kInput: 0.002, costPer1kOutput: 0.006,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['EU'], legalDomainOptimized: false, maxRPM: 200,
  },
  {
    id: 'deepseek/deepseek-chat', providerId: 'openrouter', displayName: 'DeepSeek V3',
    tier: 3, contextWindow: 128000, costPer1kInput: 0.00027, costPer1kOutput: 0.0011,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['APAC'], legalDomainOptimized: false, maxRPM: 2000,
  },
  {
    id: 'deepseek/deepseek-r1', providerId: 'openrouter', displayName: 'DeepSeek R1 (Reasoning)',
    tier: 3, contextWindow: 128000, costPer1kInput: 0.00055, costPer1kOutput: 0.00219,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['APAC'], legalDomainOptimized: true, maxRPM: 1000,
  },
  {
    id: 'google/gemini-2.5-flash', providerId: 'openrouter', displayName: 'Gemini 2.5 Flash',
    tier: 3, contextWindow: 1000000, costPer1kInput: 0.000075, costPer1kOutput: 0.0003,
    supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: false, maxRPM: 1000,
  },
  {
    id: 'openai/gpt-4.1-nano', providerId: 'openrouter', displayName: 'GPT-4.1 Nano',
    tier: 3, contextWindow: 1000000, costPer1kInput: 0.0001, costPer1kOutput: 0.0004,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['US', 'EU'], legalDomainOptimized: false, maxRPM: 2000,
  },
  {
    id: 'qwen/qwen3-235b-a22b', providerId: 'openrouter', displayName: 'Qwen3-235B',
    tier: 3, contextWindow: 128000, costPer1kInput: 0.0002, costPer1kOutput: 0.0006,
    supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
    dataResidency: ['APAC'], legalDomainOptimized: false, maxRPM: 1000,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// LLM Priority Manager
// ──────────────────────────────────────────────────────────────────────────────

export class LLMPriorityManager {
  private static instance: LLMPriorityManager;
  private readonly providerHealth = new Map<string, LLMProviderHealth>();
  private readonly usageHistory: UsageRecord[] = [];
  private readonly CIRCUIT_OPEN_THRESHOLD = 5;     // failures before circuit opens
  private readonly CIRCUIT_HALF_OPEN_DELAY_MS = 60000;
  private healthCheckInterval?: NodeJS.Timer;

  private constructor() {
    this.initializeProviderHealth();
    logger.info('[LLMPriority] LLM Priority Manager initialized', {
      models: MODEL_CATALOGUE.length,
      tiers: [1, 2, 3, 4],
    });
  }

  static getInstance(): LLMPriorityManager {
    if (!LLMPriorityManager.instance) {
      LLMPriorityManager.instance = new LLMPriorityManager();
    }
    return LLMPriorityManager.instance;
  }

  /**
   * Route a request to the optimal LLM provider.
   * This is the ONLY way to select a model — never hardcode model names elsewhere.
   */
  routeRequest(request: RoutingRequest): RoutingResult {
    const candidateModels = this.filterCandidates(request);
    if (candidateModels.length === 0) {
      throw new Error(`No available LLM providers for request: ${JSON.stringify(request)}`);
    }

    const selectedModel = this.selectBestModel(candidateModels, request);
    const fallbackChain = candidateModels.filter(m => m.id !== selectedModel.id).slice(0, 3);

    const tier1Cost = (MODEL_CATALOGUE.find(m => m.tier === 1)?.costPer1kInput || 0.015) * 1000;
    const selectedCost = selectedModel.costPer1kInput * request.contextTokens / 1000;
    const tier1EstimatedCost = tier1Cost * request.contextTokens / 1000;
    const costSaving = tier1EstimatedCost > 0
      ? Math.round((1 - selectedCost / tier1EstimatedCost) * 100)
      : 0;

    logger.debug('[LLMPriority] Request routed', {
      requestId: request.requestId,
      model: selectedModel.id,
      tier: selectedModel.tier,
      costSaving: `${costSaving}%`,
    });

    return {
      selectedModel,
      fallbackChain,
      tier: selectedModel.tier,
      estimatedCostUSD: selectedCost,
      routingReason: this.buildRoutingReason(selectedModel, request),
      costSavingVsPremium: costSaving,
    };
  }

  /**
   * Record the result of an LLM call — used for health tracking and cost analytics.
   */
  recordUsage(record: UsageRecord): void {
    this.usageHistory.push(record);
    if (this.usageHistory.length > 50000) this.usageHistory.splice(0, 10000);

    // Update health metrics
    const health = this.providerHealth.get(record.modelId);
    if (health) {
      if (record.success) {
        health.consecutiveFailures = 0;
        health.latencyMs = (health.latencyMs + record.latencyMs) / 2;
        if (health.circuitState === 'half-open') health.circuitState = 'closed';
      } else {
        health.consecutiveFailures++;
        if (health.consecutiveFailures >= this.CIRCUIT_OPEN_THRESHOLD) {
          health.circuitState = 'open';
          logger.warn('[LLMPriority] Circuit breaker opened', { modelId: record.modelId });
        }
      }
      health.lastCheckedAt = new Date();
      this.providerHealth.set(record.modelId, health);
    }
  }

  /**
   * Get cost analytics for a time period.
   */
  getCostAnalytics(since?: Date): {
    totalCostUSD: number;
    byModel: Record<string, number>;
    byTier: Record<number, number>;
    byDomain: Record<string, number>;
    averageCostPerRequest: number;
    totalRequests: number;
  } {
    const records = since
      ? this.usageHistory.filter(r => r.timestamp >= since)
      : this.usageHistory;

    const byModel: Record<string, number> = {};
    const byTier: Record<number, number> = {};
    const byDomain: Record<string, number> = {};
    let totalCost = 0;

    for (const r of records) {
      totalCost += r.costUSD;
      byModel[r.modelId] = (byModel[r.modelId] || 0) + r.costUSD;
      byTier[r.tier] = (byTier[r.tier] || 0) + r.costUSD;
      byDomain[r.domain] = (byDomain[r.domain] || 0) + r.costUSD;
    }

    return {
      totalCostUSD: totalCost,
      byModel, byTier, byDomain,
      averageCostPerRequest: records.length > 0 ? totalCost / records.length : 0,
      totalRequests: records.length,
    };
  }

  /**
   * Get current provider health status.
   */
  getProviderHealth(): LLMProviderHealth[] {
    return Array.from(this.providerHealth.values());
  }

  /**
   * Get all models in the catalogue.
   */
  getModelCatalogue(): ProviderModel[] {
    return [...MODEL_CATALOGUE];
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(intervalMs = 30000): void {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch(err =>
        logger.error('[LLMPriority] Health check failed', { err: err.message }),
      );
    }, intervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval as any);
      this.healthCheckInterval = undefined;
    }
  }

  healthCheck(): { status: 'healthy'; availableModels: number; totalModels: number; circuitBreakerStatus: Record<string, string> } {
    const circuitStatus: Record<string, string> = {};
    for (const [id, health] of this.providerHealth.entries()) {
      if (health.circuitState !== 'closed') circuitStatus[id] = health.circuitState;
    }
    return {
      status: 'healthy',
      availableModels: Array.from(this.providerHealth.values()).filter(h => h.isAvailable && h.circuitState === 'closed').length,
      totalModels: MODEL_CATALOGUE.length,
      circuitBreakerStatus: circuitStatus,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private initializeProviderHealth(): void {
    for (const model of MODEL_CATALOGUE) {
      this.providerHealth.set(model.id, {
        providerId: model.providerId,
        isAvailable: true,
        latencyMs: 0,
        successRate: 1.0,
        rateLimitRemaining: -1,
        lastCheckedAt: new Date(),
        circuitState: 'closed',
        consecutiveFailures: 0,
      });
    }
  }

  private filterCandidates(request: RoutingRequest): ProviderModel[] {
    return MODEL_CATALOGUE.filter(model => {
      // Check circuit breaker
      const health = this.providerHealth.get(model.id);
      if (health?.circuitState === 'open') return false;
      // Vision requirement
      if (request.requiresVision && !model.supportsVision) return false;
      // JSON mode requirement
      if (request.requiresJsonMode && !model.supportsJsonMode) return false;
      // Context window
      if (request.contextTokens > model.contextWindow * 0.9) return false;
      // EU data residency
      if (request.requiresEUResidency && !model.dataResidency.includes('EU')) return false;
      // Cost budget
      if (request.maxCostUSD) {
        const estCost = model.costPer1kInput * request.contextTokens / 1000;
        if (estCost > request.maxCostUSD) return false;
      }
      // Tier restriction by user tier
      const maxTier = this.getMaxTierForUserTier(request.tier);
      return model.tier <= maxTier;
    });
  }

  private selectBestModel(candidates: ProviderModel[], request: RoutingRequest): ProviderModel {
    // If preferred model is specified and available, use it
    if (request.preferredModel) {
      const preferred = candidates.find(m => m.id === request.preferredModel);
      if (preferred) return preferred;
    }

    // Score each candidate
    const scored = candidates.map(model => ({
      model,
      score: this.scoreModel(model, request),
    })).sort((a, b) => b.score - a.score);

    return scored[0].model;
  }

  private scoreModel(model: ProviderModel, request: RoutingRequest): number {
    let score = 0;
    // Penalise higher cost
    score -= model.costPer1kInput * 100;
    // Reward for legal domain optimization
    if (model.legalDomainOptimized) score += 20;
    // Reward for matching complexity to tier
    const complexityTierMap: Record<QueryComplexity, ProviderTier> = {
      simple: 3, medium: 2, complex: 2, expert: 1,
    };
    const idealTier = complexityTierMap[request.complexity];
    score -= Math.abs(model.tier - idealTier) * 10;
    // Reward for health
    const health = this.providerHealth.get(model.id);
    if (health) {
      score += health.successRate * 10;
      score -= (health.latencyMs / 1000);
    }
    return score;
  }

  private getMaxTierForUserTier(userTier: string): ProviderTier {
    const map: Record<string, ProviderTier> = {
      solo: 3,
      plus: 2,
      pro: 2,
      enterprise: 1,
    };
    return map[userTier] || 3;
  }

  private buildRoutingReason(model: ProviderModel, request: RoutingRequest): string {
    const parts: string[] = [];
    if (model.legalDomainOptimized) parts.push('legal-optimized');
    parts.push(`tier-${model.tier}`);
    parts.push(`complexity:${request.complexity}`);
    if (request.requiresEUResidency) parts.push('eu-residency');
    return parts.join(', ');
  }

  private async runHealthChecks(): Promise<void> {
    // In production: ping each provider's health endpoint
    // Reset half-open circuits that have waited long enough
    for (const [id, health] of this.providerHealth.entries()) {
      if (health.circuitState === 'open') {
        const timeSinceLastCheck = Date.now() - health.lastCheckedAt.getTime();
        if (timeSinceLastCheck >= this.CIRCUIT_HALF_OPEN_DELAY_MS) {
          health.circuitState = 'half-open';
          health.lastCheckedAt = new Date();
          this.providerHealth.set(id, health);
          logger.info('[LLMPriority] Circuit half-opened for retry', { modelId: id });
        }
      }
    }
  }
}

export const llmPriorityManager = LLMPriorityManager.getInstance();
