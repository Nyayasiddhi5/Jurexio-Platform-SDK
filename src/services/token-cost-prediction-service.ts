/**
 * Token Cost Prediction Service
 * 
 * Predicts token costs before workflow execution for budget management.
 * Integrates with AG-UI for real-time cost calculation streaming.
 * 
 * Features:
 * - Task complexity analysis
 * - Provider-specific cost estimation
 * - Multi-model cost comparison
 * - Real-time AG-UI progress events
 * - Historical accuracy tracking
 * - GRPO-based auto-improvement
 */

import { EventEmitter } from 'events';
import { db } from '../db/index.js';
import {
  jurexioOrchestrationJobs,
  type OrchestrationJobType,
} from '@shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('token-cost-prediction-service');

// JRX-PREFLIGHT-FIX-003 (2026-04-30): `OrchestrationWorkflow` was previously imported
// from `@shared/schema.js` but was never exported there (the schema only exposes
// `OrchestrationJobType`). The sibling implementation at
// `src/packages/analytics/token-cost-prediction-service.ts` already declares this as a
// local string alias for the same reason — mirroring it here so preflight type-check
// stops failing on the missing import. Workflow names are free-form route slugs
// (`'contract-review'`, `'litigation-prep'`, …) so a string alias is semantically correct.
type OrchestrationWorkflow = string;

// ================================================================================================
// TYPES
// ================================================================================================

export interface TaskComplexityAnalysis {
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedTokens: number;
  confidenceScore: number;
  factors: {
    taskLength: number;
    domainSpecificity: number;
    multiStepWorkflow: boolean;
    requiresResearch: boolean;
    codeGeneration: boolean;
    creativeTasks: boolean;
  };
}

export interface ProviderCostEstimate {
  providerId: string;
  providerName: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  inputCostPerToken: number;
  outputCostPerToken: number;
  totalEstimatedCost: number;
  estimatedLatencyMs: number;
  qualityScore: number;
  recommended: boolean;
}

export interface CostPredictionResult {
  predictionId: string;
  workflow: OrchestrationWorkflow;
  complexity: TaskComplexityAnalysis;
  providerEstimates: ProviderCostEstimate[];
  recommendedProvider: ProviderCostEstimate;
  totalEstimatedCost: number;
  confidenceScore: number;
  estimatedDurationSeconds: number;
  createdAt: Date;
}

export interface CostPredictionOptions {
  workflow: OrchestrationWorkflow;
  taskDescription?: string;
  preferredProviders?: string[];
  budgetLimit?: number;
  qualityThreshold?: number;
  aguiSessionId?: string; // For real-time streaming
}

// ================================================================================================
// PROVIDER PRICING DATA
// ================================================================================================

interface ProviderPricing {
  id: string;
  name: string;
  models: {
    modelId: string;
    name: string;
    inputCostPer1M: number; // Cost per 1M input tokens
    outputCostPer1M: number; // Cost per 1M output tokens
    avgLatencyMs: number;
    qualityScore: number; // 0-1 scale
    capabilities: string[];
  }[];
}

// ── PROVIDER PRICING — April 2026 Current Models ─────────────────────────────
const PROVIDER_PRICING: ProviderPricing[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      // GPT-4.1 Series (Apr 2025, 1M context, real API IDs)
      {
        modelId: 'gpt-4.1',
        name: 'GPT-4.1',
        inputCostPer1M: 2.00,
        outputCostPer1M: 8.00,
        avgLatencyMs: 2800,
        qualityScore: 0.96,
        capabilities: ['code', 'creative', 'analysis', 'reasoning', 'vision', 'legal']
      },
      {
        modelId: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        inputCostPer1M: 0.40,
        outputCostPer1M: 1.60,
        avgLatencyMs: 1200,
        qualityScore: 0.89,
        capabilities: ['code', 'creative', 'analysis', 'vision']
      },
      {
        modelId: 'gpt-4.1-nano',
        name: 'GPT-4.1 Nano',
        inputCostPer1M: 0.10,
        outputCostPer1M: 0.40,
        avgLatencyMs: 600,
        qualityScore: 0.82,
        capabilities: ['general', 'code', 'analysis']
      },
      // Reasoning Series
      {
        modelId: 'o3',
        name: 'o3 (Reasoning)',
        inputCostPer1M: 10.00,
        outputCostPer1M: 40.00,
        avgLatencyMs: 8000,
        qualityScore: 0.99,
        capabilities: ['deep-reasoning', 'legal', 'math', 'complex-analysis']
      },
      {
        modelId: 'o4-mini',
        name: 'o4-mini (Reasoning)',
        inputCostPer1M: 1.10,
        outputCostPer1M: 4.40,
        avgLatencyMs: 3500,
        qualityScore: 0.93,
        capabilities: ['reasoning', 'code', 'analysis', 'legal']
      },
      {
        modelId: 'o3-pro',
        name: 'o3-pro',
        inputCostPer1M: 20.00,
        outputCostPer1M: 80.00,
        avgLatencyMs: 12000,
        qualityScore: 0.99,
        capabilities: ['deep-reasoning', 'research', 'legal-expert']
      }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      // Claude 4.6 Series (Feb 2026, 1M context)
      {
        modelId: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        inputCostPer1M: 5.00,
        outputCostPer1M: 25.00,
        avgLatencyMs: 4500,
        qualityScore: 0.99,
        capabilities: ['code', 'creative', 'analysis', 'reasoning', 'legal', 'vision', 'extended-thinking']
      },
      {
        modelId: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        inputCostPer1M: 3.00,
        outputCostPer1M: 15.00,
        avgLatencyMs: 3000,
        qualityScore: 0.96,
        capabilities: ['code', 'creative', 'analysis', 'reasoning', 'legal', 'vision']
      },
      {
        modelId: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        inputCostPer1M: 0.25,
        outputCostPer1M: 1.25,
        avgLatencyMs: 800,
        qualityScore: 0.84,
        capabilities: ['general', 'code', 'fast', 'high-volume']
      }
    ]
  },
  {
    id: 'google',
    name: 'Google DeepMind',
    models: [
      // Gemini 3.1 Pro (Feb 19, 2026 — gemini-3-pro-preview deprecated Mar 9 2026)
      {
        modelId: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro',
        inputCostPer1M: 3.00,
        outputCostPer1M: 12.00,
        avgLatencyMs: 3500,
        qualityScore: 0.97,
        capabilities: ['code', 'reasoning', 'multimodal', 'legal', 'analysis']
      },
      // Gemini 2.5 Series — stable production
      {
        modelId: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        inputCostPer1M: 1.25,
        outputCostPer1M: 5.00,
        avgLatencyMs: 2500,
        qualityScore: 0.94,
        capabilities: ['code', 'creative', 'analysis', 'multimodal', 'long-context']
      },
      {
        modelId: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        inputCostPer1M: 0.075,
        outputCostPer1M: 0.30,
        avgLatencyMs: 900,
        qualityScore: 0.87,
        capabilities: ['general', 'code', 'analysis', 'multimodal', 'fast']
      },
      {
        modelId: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        inputCostPer1M: 0.02,
        outputCostPer1M: 0.08,
        avgLatencyMs: 500,
        qualityScore: 0.80,
        capabilities: ['general', 'fast', 'low-cost']
      }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      {
        modelId: 'deepseek-v3',
        name: 'DeepSeek V3',
        inputCostPer1M: 0.27,
        outputCostPer1M: 1.10,
        avgLatencyMs: 2000,
        qualityScore: 0.91,
        capabilities: ['code', 'analysis', 'reasoning', 'cost-optimized']
      },
      {
        modelId: 'deepseek-r1',
        name: 'DeepSeek R1 (Reasoning)',
        inputCostPer1M: 0.55,
        outputCostPer1M: 2.19,
        avgLatencyMs: 5000,
        qualityScore: 0.93,
        capabilities: ['deep-reasoning', 'math', 'legal', 'analysis']
      },
      {
        modelId: 'deepseek-prover-v2',
        name: 'DeepSeek Prover V2',
        inputCostPer1M: 0.50,
        outputCostPer1M: 2.00,
        avgLatencyMs: 6000,
        qualityScore: 0.95,
        capabilities: ['theorem-proving', 'formal-reasoning', 'legal-logic']
      }
    ]
  },
  {
    id: 'meta',
    name: 'Meta AI',
    models: [
      {
        modelId: 'llama-4-maverick',
        name: 'Llama 4 Maverick',
        inputCostPer1M: 0.18,
        outputCostPer1M: 0.59,
        avgLatencyMs: 1800,
        qualityScore: 0.90,
        capabilities: ['code', 'analysis', 'reasoning', 'vision', 'cost-optimized']
      },
      {
        modelId: 'llama-4-scout',
        name: 'Llama 4 Scout',
        inputCostPer1M: 0.09,
        outputCostPer1M: 0.29,
        avgLatencyMs: 1000,
        qualityScore: 0.86,
        capabilities: ['general', 'analysis', 'long-context', 'ultra-low-cost']
      }
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    models: [
      {
        modelId: 'mistral-large-2512',
        name: 'Mistral Large 3',
        inputCostPer1M: 2.00,
        outputCostPer1M: 6.00,
        avgLatencyMs: 2500,
        qualityScore: 0.91,
        capabilities: ['code', 'analysis', 'eu-data-residency', 'multilingual']
      },
      {
        modelId: 'devstral-medium',
        name: 'Devstral Medium',
        inputCostPer1M: 0.30,
        outputCostPer1M: 0.90,
        avgLatencyMs: 1500,
        qualityScore: 0.88,
        capabilities: ['code', 'agentic-coding', 'software-engineering']
      }
    ]
  },
  {
    id: 'agentzero',
    name: 'AgentZero',
    models: [
      {
        modelId: 'agentzero',
        name: 'AgentZero (Always-On Fallback)',
        inputCostPer1M: 0.00,
        outputCostPer1M: 0.00,
        avgLatencyMs: 200,
        qualityScore: 0.65,
        capabilities: ['fallback', 'offline', 'zero-cost']
      }
    ]
  }
];

// ================================================================================================
// TOKEN COST PREDICTION SERVICE
// ================================================================================================

export class TokenCostPredictionService extends EventEmitter {
  private predictionHistory: Map<string, CostPredictionResult> = new Map();

  constructor() {
    super();
    logger.info('💰 Token Cost Prediction Service initialized');
  }

  /**
   * Predict token costs for a workflow with real-time AG-UI streaming
   */
  async predictCost(options: CostPredictionOptions): Promise<CostPredictionResult> {
    const startTime = Date.now();
    const predictionId = `pred_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;

    try {
      // Emit AG-UI thinking event: Starting cost prediction
      if (options.aguiSessionId) {
        this.emit('agui:thinking', {
          sessionId: options.aguiSessionId,
          step: 'Analyzing task complexity',
          details: `Workflow: ${options.workflow}, estimating token requirements`
        });
      }

      // Step 1: Analyze task complexity
      if (options.aguiSessionId) {
        this.emit('agui:progress', {
          sessionId: options.aguiSessionId,
          progress: 0.2,
          message: 'Analyzing task complexity and token requirements'
        });
      }

      const complexity = await this.analyzeComplexity(options.workflow, options.taskDescription);

      // Step 2: Fetch historical data for accuracy
      if (options.aguiSessionId) {
        this.emit('agui:progress', {
          sessionId: options.aguiSessionId,
          progress: 0.4,
          message: 'Fetching historical execution data for calibration'
        });
      }

      const historicalAvg = await this.getHistoricalAverages(options.workflow);

      // Step 3: Calculate provider-specific estimates
      if (options.aguiSessionId) {
        this.emit('agui:progress', {
          sessionId: options.aguiSessionId,
          progress: 0.6,
          message: 'Calculating cost estimates across providers'
        });
      }

      const providerEstimates = this.calculateProviderEstimates(
        complexity,
        historicalAvg,
        options.preferredProviders,
        options.qualityThreshold
      );

      // Step 4: Select recommended provider
      if (options.aguiSessionId) {
        this.emit('agui:progress', {
          sessionId: options.aguiSessionId,
          progress: 0.8,
          message: 'Selecting optimal provider based on cost-quality balance'
        });
      }

      const recommendedProvider = this.selectRecommendedProvider(
        providerEstimates,
        options.budgetLimit,
        options.qualityThreshold
      );

      // Build final result
      const result: CostPredictionResult = {
        predictionId,
        workflow: options.workflow,
        complexity,
        providerEstimates,
        recommendedProvider,
        totalEstimatedCost: recommendedProvider.totalEstimatedCost,
        confidenceScore: complexity.confidenceScore * 0.85, // Adjust for market volatility
        estimatedDurationSeconds: Math.ceil(recommendedProvider.estimatedLatencyMs / 1000),
        createdAt: new Date()
      };

      // Store in history
      this.predictionHistory.set(predictionId, result);

      // Emit AG-UI completion
      if (options.aguiSessionId) {
        this.emit('agui:message', {
          sessionId: options.aguiSessionId,
          message: `💰 Cost prediction complete: $${result.totalEstimatedCost.toFixed(4)}`,
          metadata: {
            predictionId,
            recommendedProvider: recommendedProvider.providerName,
            recommendedModel: recommendedProvider.model,
            estimatedTokens: complexity.estimatedTokens,
            processingTime: Date.now() - startTime
          }
        });

        this.emit('agui:artifact_created', {
          sessionId: options.aguiSessionId,
          artifact: {
            type: 'cost-prediction',
            id: predictionId,
            data: result
          }
        });
      }

      logger.info(`💰 Cost prediction complete: ${predictionId} ($${result.totalEstimatedCost.toFixed(4)})`);
      this.emit('predictionComplete', result);

      return result;

    } catch (error: any) {
      // Emit AG-UI error
      if (options.aguiSessionId) {
        this.emit('agui:error', {
          sessionId: options.aguiSessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
          details: 'Cost prediction failed'
        });
      }

      logger.error('Cost prediction failed:', error);
      throw error;
    }
  }

  /**
   * Analyze task complexity and estimate token usage
   */
  private async analyzeComplexity(
    workflow: OrchestrationWorkflow,
    taskDescription?: string
  ): Promise<TaskComplexityAnalysis> {
    
    // Base token estimate by workflow type
    const baseTokens: Record<OrchestrationWorkflow, number> = {
      'ideation': 3000,
      'prd_generation': 5000,
      'technical_design': 8000,
      'code_generation': 12000,
      'code_review': 6000,
      'testing': 7000,
      'deployment_plan': 4000,
      'market_analysis': 9000,
      'pitch_deck': 6000,
      'financial_model': 5000
    };

    const estimatedTokens = baseTokens[workflow] || 5000;

    // Analyze task description if provided
    let taskLength = 0;
    let domainSpecificity = 0.5;
    let multiStepWorkflow = false;
    let requiresResearch = false;
    let codeGeneration = false;
    let creativeTasks = false;

    if (taskDescription) {
      taskLength = taskDescription.length;
      domainSpecificity = (taskDescription.match(/\b(technical|specialized|expert|advanced)\b/gi) || []).length > 0 ? 0.8 : 0.5;
      multiStepWorkflow = (taskDescription.match(/\b(then|next|after|step|phase)\b/gi) || []).length > 2;
      requiresResearch = (taskDescription.match(/\b(research|analyze|investigate|explore)\b/gi) || []).length > 0;
      codeGeneration = (taskDescription.match(/\b(code|implement|develop|build|create)\b/gi) || []).length > 0;
      creativeTasks = (taskDescription.match(/\b(design|creative|innovative|unique)\b/gi) || []).length > 0;
    }

    // Determine complexity level
    let complexity: 'simple' | 'moderate' | 'complex' | 'expert' = 'moderate';
    let multiplier = 1.0;

    if (estimatedTokens < 4000 && !multiStepWorkflow) {
      complexity = 'simple';
      multiplier = 0.8;
    } else if (estimatedTokens < 7000 && domainSpecificity < 0.7) {
      complexity = 'moderate';
      multiplier = 1.0;
    } else if (estimatedTokens < 10000 || domainSpecificity >= 0.7) {
      complexity = 'complex';
      multiplier = 1.3;
    } else {
      complexity = 'expert';
      multiplier = 1.6;
    }

    // Apply multipliers
    let adjustedTokens = estimatedTokens * multiplier;
    if (multiStepWorkflow) adjustedTokens *= 1.2;
    if (requiresResearch) adjustedTokens *= 1.15;
    if (codeGeneration) adjustedTokens *= 1.25;
    if (creativeTasks) adjustedTokens *= 1.1;

    return {
      complexity,
      estimatedTokens: Math.ceil(adjustedTokens),
      confidenceScore: 0.85 - (domainSpecificity * 0.1), // Less confident for specialized tasks
      factors: {
        taskLength,
        domainSpecificity,
        multiStepWorkflow,
        requiresResearch,
        codeGeneration,
        creativeTasks
      }
    };
  }

  /**
   * Get historical averages for workflow type
   *
   * JRX-PREFLIGHT-FIX-004 (2026-04-30): the previous implementation queried columns
   * (`workflow`, `inputTokens`, `outputTokens`, `cost`) that do not exist on the
   * `jurexioOrchestrationJobs` table — the schema actually exposes `jobType` (varchar)
   * and stores token/cost data inside the `output` jsonb. This pulled the most recent
   * 20 rows by `jobType` and reads the figures back from the jsonb payload. If the
   * payload doesn't carry those fields yet, we return `null` and the caller falls back
   * to the heuristic complexity-based estimate.
   */
  private async getHistoricalAverages(
    workflow: OrchestrationWorkflow
  ): Promise<{ avgTokens: number; avgCost: number } | null> {
    if (!db) return null;
    try {
      const recentJobs = await db
        .select()
        .from(jurexioOrchestrationJobs)
        .where(eq(jurexioOrchestrationJobs.jobType, workflow))
        .orderBy(desc(jurexioOrchestrationJobs.createdAt))
        .limit(20);

      if (recentJobs.length === 0) return null;

      let tokensSum = 0;
      let costSum = 0;
      let tokenSamples = 0;
      let costSamples = 0;

      for (const job of recentJobs) {
        const out = (job.output ?? {}) as Record<string, unknown>;
        const inT = Number(out.inputTokens ?? out.input_tokens ?? 0);
        const outT = Number(out.outputTokens ?? out.output_tokens ?? 0);
        const c = Number(out.cost ?? out.totalCost ?? out.total_cost ?? 0);
        if (inT + outT > 0) {
          tokensSum += inT + outT;
          tokenSamples++;
        }
        if (c > 0) {
          costSum += c;
          costSamples++;
        }
      }

      if (tokenSamples === 0 && costSamples === 0) return null;

      const avgTokens = tokenSamples > 0 ? Math.ceil(tokensSum / tokenSamples) : 0;
      const avgCost = costSamples > 0 ? costSum / costSamples : 0;

      return { avgTokens, avgCost };
    } catch (error: any) {
      logger.warn('Failed to fetch historical averages:', error);
      return null;
    }
  }

  /**
   * Calculate cost estimates for each provider
   */
  private calculateProviderEstimates(
    complexity: TaskComplexityAnalysis,
    historical: { avgTokens: number; avgCost: number } | null,
    preferredProviders?: string[],
    qualityThreshold?: number
  ): ProviderCostEstimate[] {
    
    const estimates: ProviderCostEstimate[] = [];
    const inputTokens = Math.ceil(complexity.estimatedTokens * 0.3); // 30% input
    const outputTokens = Math.ceil(complexity.estimatedTokens * 0.7); // 70% output

    // Use historical data if available and reliable
    const useHistorical = historical && complexity.confidenceScore > 0.7;
    const finalInputTokens = useHistorical ? Math.ceil(historical.avgTokens * 0.3) : inputTokens;
    const finalOutputTokens = useHistorical ? Math.ceil(historical.avgTokens * 0.7) : outputTokens;

    for (const provider of PROVIDER_PRICING) {
      // Skip if not in preferred list
      if (preferredProviders && preferredProviders.length > 0 && !preferredProviders.includes(provider.id)) {
        continue;
      }

      for (const model of provider.models) {
        // Skip if below quality threshold
        if (qualityThreshold && model.qualityScore < qualityThreshold) {
          continue;
        }

        const inputCost = (finalInputTokens / 1_000_000) * model.inputCostPer1M;
        const outputCost = (finalOutputTokens / 1_000_000) * model.outputCostPer1M;
        const totalCost = inputCost + outputCost;

        estimates.push({
          providerId: provider.id,
          providerName: provider.name,
          model: model.name,
          estimatedInputTokens: finalInputTokens,
          estimatedOutputTokens: finalOutputTokens,
          inputCostPerToken: model.inputCostPer1M / 1_000_000,
          outputCostPerToken: model.outputCostPer1M / 1_000_000,
          totalEstimatedCost: totalCost,
          estimatedLatencyMs: model.avgLatencyMs,
          qualityScore: model.qualityScore,
          recommended: false
        });
      }
    }

    return estimates.sort((a, b) => a.totalEstimatedCost - b.totalEstimatedCost);
  }

  /**
   * Select recommended provider based on cost-quality balance
   */
  private selectRecommendedProvider(
    estimates: ProviderCostEstimate[],
    budgetLimit?: number,
    qualityThreshold?: number
  ): ProviderCostEstimate {
    
    if (estimates.length === 0) {
      throw new Error('No provider estimates available');
    }

    // Filter by budget
    let candidates = budgetLimit
      ? estimates.filter(e => e.totalEstimatedCost <= budgetLimit)
      : estimates;

    if (candidates.length === 0) {
      logger.warn('No providers within budget, using cheapest option');
      candidates = [estimates[0]]; // Cheapest
    }

    // Score by cost-quality balance (70% quality, 30% cost)
    const scored = candidates.map(estimate => {
      const costScore = 1 - (estimate.totalEstimatedCost / Math.max(...candidates.map(e => e.totalEstimatedCost)));
      const qualityScore = estimate.qualityScore;
      const balanceScore = (qualityScore * 0.7) + (costScore * 0.3);
      return { estimate, balanceScore };
    });

    // Sort by balance score
    scored.sort((a, b) => b.balanceScore - a.balanceScore);

    const recommended = scored[0].estimate;
    recommended.recommended = true;

    return recommended;
  }

  /**
   * Track actual cost vs predicted for GRPO learning
   */
  async trackActualCost(
    predictionId: string,
    actualInputTokens: number,
    actualOutputTokens: number,
    actualCost: number,
    actualDurationMs: number
  ): Promise<void> {
    const prediction = this.predictionHistory.get(predictionId);
    if (!prediction) {
      logger.warn(`Prediction ${predictionId} not found in history`);
      return;
    }

    const accuracy = 1 - Math.abs(prediction.totalEstimatedCost - actualCost) / actualCost;
    const tokenAccuracy = 1 - Math.abs(prediction.complexity.estimatedTokens - (actualInputTokens + actualOutputTokens)) / (actualInputTokens + actualOutputTokens);

    logger.info(`📊 Prediction accuracy: ${(accuracy * 100).toFixed(2)}% cost, ${(tokenAccuracy * 100).toFixed(2)}% tokens`);

    // Emit for GRPO learning
    this.emit('predictionAccuracy', {
      predictionId,
      predicted: {
        cost: prediction.totalEstimatedCost,
        tokens: prediction.complexity.estimatedTokens
      },
      actual: {
        cost: actualCost,
        tokens: actualInputTokens + actualOutputTokens
      },
      accuracy: {
        cost: accuracy,
        tokens: tokenAccuracy
      }
    });
  }
}

// Singleton instance
export const tokenCostPredictionService = new TokenCostPredictionService();
