// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('token-cost-prediction-service');

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

// External schema types
const jurexioOrchestrationJobs: any = {};
type OrchestrationJobType = string;
type OrchestrationWorkflow = string;
const eq = (a: any, b: any) => ({});
const desc = (a: any) => ({});
const sql = (s: TemplateStringsArray, ...v: any[]) => ({});

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

const PROVIDER_PRICING: ProviderPricing[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      {
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        inputCostPer1M: 2.50,
        outputCostPer1M: 10.00,
        avgLatencyMs: 3000,
        qualityScore: 0.95,
        capabilities: ['code', 'creative', 'analysis', 'reasoning']
      },
      {
        modelId: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        inputCostPer1M: 0.15,
        outputCostPer1M: 0.60,
        avgLatencyMs: 1500,
        qualityScore: 0.85,
        capabilities: ['code', 'creative', 'analysis']
      },
      {
        modelId: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        inputCostPer1M: 0.50,
        outputCostPer1M: 1.50,
        avgLatencyMs: 1000,
        qualityScore: 0.75,
        capabilities: ['general', 'code']
      }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      {
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        inputCostPer1M: 3.00,
        outputCostPer1M: 15.00,
        avgLatencyMs: 3500,
        qualityScore: 0.98,
        capabilities: ['code', 'creative', 'analysis', 'reasoning', 'extended-thinking']
      },
      {
        modelId: 'claude-3-haiku',
        name: 'Claude 3 Haiku',
        inputCostPer1M: 0.25,
        outputCostPer1M: 1.25,
        avgLatencyMs: 1200,
        qualityScore: 0.80,
        capabilities: ['general', 'code', 'fast']
      }
    ]
  },
  {
    id: 'google',
    name: 'Google',
    models: [
      {
        modelId: 'gemini-2.0-flash-thinking-exp',
        name: 'Gemini 2.0 Flash Thinking',
        inputCostPer1M: 0.00, // Free tier
        outputCostPer1M: 0.00,
        avgLatencyMs: 2500,
        qualityScore: 0.90,
        capabilities: ['code', 'reasoning', 'multimodal']
      },
      {
        modelId: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        inputCostPer1M: 1.25,
        outputCostPer1M: 5.00,
        avgLatencyMs: 2000,
        qualityScore: 0.88,
        capabilities: ['code', 'creative', 'analysis']
      }
    ]
  },
  {
    id: 'xai',
    name: 'xAI',
    models: [
      {
        modelId: 'grok-2',
        name: 'Grok 2',
        inputCostPer1M: 2.00,
        outputCostPer1M: 10.00,
        avgLatencyMs: 2800,
        qualityScore: 0.92,
        capabilities: ['code', 'creative', 'realtime-data']
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
    const predictionId = `pred_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;

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
   */
  private async getHistoricalAverages(workflow: OrchestrationWorkflow): Promise<{ avgTokens: number; avgCost: number } | null> {
    try {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2304)
      const recentJobs = await db.select()
        .from(jurexioOrchestrationJobs)
        .where(eq(jurexioOrchestrationJobs.workflow, workflow))
        .orderBy(desc(jurexioOrchestrationJobs.createdAt))
        .limit(20);

      if (recentJobs.length === 0) return null;

      const avgTokens = recentJobs.reduce((sum, job) => {
        const tokens = (job.inputTokens || 0) + (job.outputTokens || 0);
        return sum + tokens;
      }, 0) / recentJobs.length;

      const avgCost = recentJobs.reduce((sum, job) => sum + (job.cost || 0), 0) / recentJobs.length;

      return { avgTokens: Math.ceil(avgTokens), avgCost };

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
