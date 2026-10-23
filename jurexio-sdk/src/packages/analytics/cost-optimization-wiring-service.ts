import { createLogger } from '../../utils/logger.js';

const logger = createLogger('cost-optimization-wiring-service');

/**
 * Cost Optimization Engine Wiring Service
 * 
 * Enables comprehensive cost tracking and optimization:
 * - Real-time cost monitoring
 * - Budget enforcement
 * - Cost allocation by studio/workflow
 * - Optimization recommendations
 * 
 * Integration Points:
 * - Pre-orchestration: Set budget constraints
 * - During-orchestration: Track and enforce budgets
 * - Post-orchestration: Cost analysis and reporting
 */

// Studio type
export type StudioType = string;

export interface BudgetConfig {
  maxCostPerRequest: number;
  dailyBudget: number;
  monthlyBudget: number;
  enforceHardLimits: boolean;
}

export interface CostBreakdown {
  orchestrationId: string;
  totalCost: number;
  llmCosts: number;
  storageCosts: number;
  computeCosts: number;
  timestamp: Date;
  studioType?: StudioType;
}

export interface CostStats {
  totalSpent: number;
  todaySpent: number;
  monthSpent: number;
  avgCostPerRequest: number;
  costByStudio: Record<string, number>;
  costByProvider: Record<string, number>;
}

export interface CostOptimizationRecommendation {
  type: 'switch_provider' | 'use_cache' | 'reduce_tokens' | 'batch_requests';
  potentialSavings: number;
  savingsPercent: number;
  description: string;
  priority: 'low' | 'medium' | 'high';
}

/**
 * Cost Optimization Engine Wiring Service
 */
class CostOptimizationWiringService {
  private costHistory: CostBreakdown[] = [];
  private budgets: Map<string, BudgetConfig> = new Map();
  private stats: CostStats = {
    totalSpent: 0,
    todaySpent: 0,
    monthSpent: 0,
    avgCostPerRequest: 0,
    costByStudio: {},
    costByProvider: {},
  };

  constructor() {
    logger.info('💰 Cost Optimization Engine Wiring Service initialized');
    logger.info('🎯 Features: Real-time tracking, Budget enforcement, Cost allocation, Optimization recommendations');
  }

  /**
   * Set budget for orchestration
   */
  setBudget(orchestrationId: string, config: Partial<BudgetConfig>): BudgetConfig {
    const fullConfig: BudgetConfig = {
      maxCostPerRequest: 0.10,
      dailyBudget: 10.00,
      monthlyBudget: 200.00,
      enforceHardLimits: true,
      ...config,
    };

    this.budgets.set(orchestrationId, fullConfig);
    logger.info(`💰 [Budget] Set for ${orchestrationId} - Max per request: $${fullConfig.maxCostPerRequest.toFixed(2)}`);

    return fullConfig;
  }

  /**
   * Check if request is within budget
   */
  checkBudget(
    orchestrationId: string,
    estimatedCost: number
  ): { allowed: boolean; reason?: string; remainingBudget?: number } {
    const budget = this.budgets.get(orchestrationId);
    if (!budget) {
      return { allowed: true };
    }

    // Check per-request limit
    if (estimatedCost > budget.maxCostPerRequest) {
      return {
        allowed: !budget.enforceHardLimits,
        reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds max per request $${budget.maxCostPerRequest.toFixed(2)}`,
      };
    }

    // Check daily budget
    if (this.stats.todaySpent + estimatedCost > budget.dailyBudget) {
      return {
        allowed: !budget.enforceHardLimits,
        reason: `Would exceed daily budget of $${budget.dailyBudget.toFixed(2)}`,
        remainingBudget: Math.max(0, budget.dailyBudget - this.stats.todaySpent),
      };
    }

    // Check monthly budget
    if (this.stats.monthSpent + estimatedCost > budget.monthlyBudget) {
      return {
        allowed: !budget.enforceHardLimits,
        reason: `Would exceed monthly budget of $${budget.monthlyBudget.toFixed(2)}`,
        remainingBudget: Math.max(0, budget.monthlyBudget - this.stats.monthSpent),
      };
    }

    return { allowed: true };
  }

  /**
   * Record cost for orchestration
   */
  recordCost(breakdown: CostBreakdown): void {
    this.costHistory.push(breakdown);

    // Update aggregate stats
    this.stats.totalSpent += breakdown.totalCost;
    this.stats.todaySpent += breakdown.totalCost;
    this.stats.monthSpent += breakdown.totalCost;

    // Update per-studio costs
    if (breakdown.studioType) {
      this.stats.costByStudio[breakdown.studioType] = 
        (this.stats.costByStudio[breakdown.studioType] || 0) + breakdown.totalCost;
    }

    // Update average
    this.stats.avgCostPerRequest = this.stats.totalSpent / this.costHistory.length;

    logger.info(`💰 [Cost] Recorded $${breakdown.totalCost.toFixed(4)} for ${breakdown.orchestrationId}`);
  }

  /**
   * Generate cost optimization recommendations
   */
  generateRecommendations(
    orchestrationId: string,
    recentCost: number
  ): CostOptimizationRecommendation[] {
    const recommendations: CostOptimizationRecommendation[] = [];

    // High cost per request
    if (recentCost > this.stats.avgCostPerRequest * 2) {
      recommendations.push({
        type: 'switch_provider',
        potentialSavings: recentCost * 0.5,
        savingsPercent: 50,
        description: 'Switch to more cost-effective provider for similar quality',
        priority: 'high',
      });
    }

    // Opportunity for caching
    if (this.detectRepetitivePatterns()) {
      recommendations.push({
        type: 'use_cache',
        potentialSavings: this.stats.avgCostPerRequest * 0.7,
        savingsPercent: 70,
        description: 'Enable semantic caching to avoid redundant API calls',
        priority: 'high',
      });
    }

    // High token usage
    if (recentCost > 0.05) {
      recommendations.push({
        type: 'reduce_tokens',
        potentialSavings: recentCost * 0.3,
        savingsPercent: 30,
        description: 'Optimize prompts to reduce token usage',
        priority: 'medium',
      });
    }

    // Batching opportunity
    if (this.costHistory.length > 10) {
      recommendations.push({
        type: 'batch_requests',
        potentialSavings: this.stats.avgCostPerRequest * 0.2,
        savingsPercent: 20,
        description: 'Batch similar requests to reduce overhead costs',
        priority: 'low',
      });
    }

    return recommendations;
  }

  /**
   * Detect repetitive patterns for caching
   */
  private detectRepetitivePatterns(): boolean {
    // Simplified - would analyze actual request patterns in production
    return this.costHistory.length > 20;
  }

  /**
   * Get cost statistics
   */
  getCostStats(): CostStats {
    return { ...this.stats };
  }

  /**
   * Get cost breakdown by time period
   */
  getCostBreakdown(
    startDate: Date,
    endDate: Date
  ): CostBreakdown[] {
    return this.costHistory.filter(entry =>
      entry.timestamp >= startDate && entry.timestamp <= endDate
    );
  }

  /**
   * Reset daily/monthly counters (would be called by cron job)
   */
  resetCounters(type: 'daily' | 'monthly'): void {
    if (type === 'daily') {
      this.stats.todaySpent = 0;
      logger.info('💰 [Budget] Daily spending reset');
    } else {
      this.stats.monthSpent = 0;
      logger.info('💰 [Budget] Monthly spending reset');
    }
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    return {
      status: 'healthy' as const,
      totalSpent: this.stats.totalSpent,
      avgCostPerRequest: this.stats.avgCostPerRequest,
      requestsTracked: this.costHistory.length,
      features: {
        realTimeTracking: true,
        budgetEnforcement: true,
        costAllocation: true,
        optimizationRecs: true,
      },
    };
  }
}

// Export singleton instance
export const costOptimizationWiringService = new CostOptimizationWiringService();
