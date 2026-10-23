/**
 * Jurexio Cost Manager v9.0
 * Cost tracking, budgets, and optimization
 * Implements cost ceilings, budget caps, and FinOps tracking
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('cost-manager');

class JurexioLogger { constructor(private context: string) {} info(...args: any[]) { logger.info(`[${this.context}]`, ...args); } warn(...args: any[]) { logger.warn(`[${this.context}]`, ...args); } error(...args: any[]) { logger.error(`[${this.context}]`, ...args); } debug(...args: any[]) { logger.debug(`[${this.context}]`, ...args); } }

export class CostManager extends EventEmitter {
  private logger: JurexioLogger;
  private initialized = false;
  private costTracking: Map<string, CostEntry[]> = new Map();
  private budgets: Map<string, Budget> = new Map();
  private costCeilings: CostCeilings;
  private totalCostToDate = 0;
  
  constructor(private config: CostManagerConfig) {
    super();
    this.logger = new JurexioLogger('CostManager');
    this.costCeilings = config.ceilings || DEFAULT_COST_CEILINGS;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.info('💰 Initializing Cost Manager...');

      // Load existing cost data
      await this.loadCostHistory();

      // Setup budget monitoring
      await this.setupBudgetMonitoring();

      // Start cost tracking
      this.startCostTracking();

      this.initialized = true;
      this.logger.info('✅ Cost Manager initialized');

    } catch (error: any) {
      this.logger.error('❌ Cost Manager initialization failed:', error);
      throw error;
    }
  }

  /**
   * Record cost for a specific operation
   */
  async recordCost(entry: CostEntry): Promise<void> {
    try {
      // Validate cost entry
      this.validateCostEntry(entry);

      // Check budget limits before recording
      await this.checkBudgetLimits(entry);

      // Record the cost
      if (!this.costTracking.has(entry.tenant)) {
        this.costTracking.set(entry.tenant, []);
      }
      
      const tenantCosts = this.costTracking.get(entry.tenant)!;
      tenantCosts.push(entry);
      
      // Update total cost
      this.totalCostToDate += entry.totalCost;

      // Emit cost event for monitoring
      this.emit('costRecorded', entry);

      // Log to cost ledger (would be database)
      await this.logToCostLedger(entry);

      // Check if approaching limits
      await this.checkCostThresholds(entry);

    } catch (error: any) {
      this.logger.error('❌ Failed to record cost:', error);
      throw error;
    }
  }

  /**
   * Check if request would exceed budget limits
   */
  async checkBudgetLimits(entry: CostEntry): Promise<void> {
    // Check per-request ceiling
    if (entry.totalCost > this.costCeilings.perRequest) {
      throw new CostLimitError(
        `Request cost $${entry.totalCost.toFixed(4)} exceeds per-request ceiling $${this.costCeilings.perRequest}`
      );
    }

    // Check hourly budget
    const hourlyCost = await this.getHourlyCost(entry.tenant);
    if (hourlyCost + entry.totalCost > this.costCeilings.perHour) {
      throw new CostLimitError(
        `Request would exceed hourly budget: $${(hourlyCost + entry.totalCost).toFixed(2)} > $${this.costCeilings.perHour}`
      );
    }

    // Check daily budget
    const dailyCost = await this.getDailyCost(entry.tenant);
    if (dailyCost + entry.totalCost > this.costCeilings.perDay) {
      throw new CostLimitError(
        `Request would exceed daily budget: $${(dailyCost + entry.totalCost).toFixed(2)} > $${this.costCeilings.perDay}`
      );
    }

    // Check tenant-specific budget
    const tenantBudget = this.budgets.get(entry.tenant);
    if (tenantBudget) {
      const currentSpend = await this.getTenantCost(entry.tenant, tenantBudget.period);
      if (currentSpend + entry.totalCost > tenantBudget.limit) {
        throw new CostLimitError(
          `Request would exceed tenant budget: $${(currentSpend + entry.totalCost).toFixed(2)} > $${tenantBudget.limit}`
        );
      }
    }
  }

  /**
   * Get cost recommendations for optimization
   */
  async getCostRecommendations(tenant?: string): Promise<CostRecommendation[]> {
    const recommendations: CostRecommendation[] = [];

    try {
      // Analyze cost patterns
      const costData = tenant ? 
        this.costTracking.get(tenant) || [] : 
        Array.from(this.costTracking.values()).flat();

      if (costData.length === 0) {
        return recommendations;
      }

      // Analyze provider costs
      const providerCosts = this.analyzeProviderCosts(costData);
      const providerRecs = this.generateProviderRecommendations(providerCosts);
      recommendations.push(...providerRecs);

      // Analyze usage patterns
      const usagePatterns = this.analyzeUsagePatterns(costData);
      const usageRecs = this.generateUsageRecommendations(usagePatterns);
      recommendations.push(...usageRecs);

      // Analyze model selection
      const modelAnalysis = this.analyzeModelSelection(costData);
      const modelRecs = this.generateModelRecommendations(modelAnalysis);
      recommendations.push(...modelRecs);

      // Sort by potential savings
      recommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);

    } catch (error: any) {
      this.logger.error('❌ Failed to generate cost recommendations:', error);
    }

    return recommendations;
  }

  /**
   * Get cost breakdown for period
   */
  async getCostBreakdown(
    tenant: string, 
    period: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<CostBreakdown> {
    const costData = this.costTracking.get(tenant) || [];
    const periodStart = this.getPeriodStart(period);
    const relevantCosts = costData.filter(entry => entry.timestamp >= periodStart);

    const breakdown: CostBreakdown = {
      total: 0,
      byProvider: {},
      byModel: {},
      byCapability: {},
      byTimeOfDay: {},
      trends: this.calculateCostTrends(costData, period)
    };

    for (const entry of relevantCosts) {
      breakdown.total += entry.totalCost;

      // By provider
      if (!breakdown.byProvider[entry.provider]) {
        breakdown.byProvider[entry.provider] = 0;
      }
      breakdown.byProvider[entry.provider] += entry.totalCost;

      // By model
      if (!breakdown.byModel[entry.model]) {
        breakdown.byModel[entry.model] = 0;
      }
      breakdown.byModel[entry.model] += entry.totalCost;

      // By capability
      if (!breakdown.byCapability[entry.capability]) {
        breakdown.byCapability[entry.capability] = 0;
      }
      breakdown.byCapability[entry.capability] += entry.totalCost;

      // By time of day
      const hour = new Date(entry.timestamp).getHours();
      const timeSlot = `${hour}:00-${hour + 1}:00`;
      if (!breakdown.byTimeOfDay[timeSlot]) {
        breakdown.byTimeOfDay[timeSlot] = 0;
      }
      breakdown.byTimeOfDay[timeSlot] += entry.totalCost;
    }

    return breakdown;
  }

  /**
   * Set budget for tenant
   */
  async setBudget(tenant: string, budget: Budget): Promise<void> {
    this.budgets.set(tenant, budget);
    this.logger.info(`💰 Set budget for ${tenant}: $${budget.limit}/${budget.period}`);
    
    this.emit('budgetSet', { tenant, budget });
  }

  /**
   * Get current cost for tenant
   */
  async getTenantCost(tenant: string, period: TimePeriod): Promise<number> {
    const costData = this.costTracking.get(tenant) || [];
    const periodStart = this.getPeriodStart(period);
    
    return costData
      .filter(entry => entry.timestamp >= periodStart)
      .reduce((sum, entry) => sum + entry.totalCost, 0);
  }

  private async getHourlyCost(tenant: string): Promise<number> {
    return this.getTenantCost(tenant, 'hour');
  }

  private async getDailyCost(tenant: string): Promise<number> {
    return this.getTenantCost(tenant, 'day');
  }

  private validateCostEntry(entry: CostEntry): void {
    if (!entry.tenant) throw new Error('Cost entry missing tenant');
    if (!entry.provider) throw new Error('Cost entry missing provider');
    if (!entry.model) throw new Error('Cost entry missing model');
    if (!entry.capability) throw new Error('Cost entry missing capability');
    if (entry.totalCost < 0) throw new Error('Cost entry has negative cost');
    if (!entry.timestamp) throw new Error('Cost entry missing timestamp');
  }

  private async loadCostHistory(): Promise<void> {
    try {
      // This would load from database
      this.logger.info('💾 Loading cost history...');
    } catch (error: any) {
      this.logger.warn('⚠️ Failed to load cost history:', error);
    }
  }

  private async setupBudgetMonitoring(): Promise<void> {
    // Setup default budgets based on cost ceilings
    const defaultBudget: Budget = {
      limit: this.costCeilings.perDay * 30, // Monthly budget
      period: 'month',
      alertThresholds: [0.5, 0.8, 0.9] // 50%, 80%, 90%
    };

    // This would typically load tenant budgets from database
    this.budgets.set('default', defaultBudget);
  }

  private startCostTracking(): void {
    // Start periodic cost analysis
    setInterval(async () => {
      await this.analyzeCostTrends();
    }, 60 * 1000); // Every minute

    // Start budget monitoring
    setInterval(async () => {
      await this.monitorBudgets();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private async logToCostLedger(entry: CostEntry): Promise<void> {
    try {
      // This would log to job_lineage table
      this.emit('costLedgerEntry', {
        job_id: entry.requestId,
        step: entry.step || 'llm-call',
        agent: entry.agent || 'unknown',
        model: entry.model,
        provider: entry.provider,
        tokens_in: entry.tokensIn || 0,
        tokens_out: entry.tokensOut || 0,
        gpu_sec: entry.gpuSeconds || 0,
        cost_usd: entry.totalCost,
        fallback_used: entry.fallbackUsed || false,
        quality_score: entry.qualityScore || 0,
        timestamp: entry.timestamp
      });
    } catch (error: any) {
      this.logger.warn('⚠️ Failed to log to cost ledger:', error);
    }
  }

  private async checkCostThresholds(entry: CostEntry): Promise<void> {
    const tenantBudget = this.budgets.get(entry.tenant);
    if (!tenantBudget) return;

    const currentSpend = await this.getTenantCost(entry.tenant, tenantBudget.period);
    const spendRatio = currentSpend / tenantBudget.limit;

    for (const threshold of tenantBudget.alertThresholds) {
      if (spendRatio >= threshold && spendRatio - (entry.totalCost / tenantBudget.limit) < threshold) {
        this.emit('budgetAlert', {
          tenant: entry.tenant,
          threshold: threshold * 100,
          currentSpend,
          budgetLimit: tenantBudget.limit,
          percentUsed: spendRatio * 100
        });

        this.logger.warn(`⚠️ Budget alert: ${entry.tenant} at ${(spendRatio * 100).toFixed(1)}% of budget`);
      }
    }
  }

  private analyzeProviderCosts(costData: CostEntry[]): ProviderCostAnalysis {
    const analysis: ProviderCostAnalysis = {};

    for (const entry of costData) {
      if (!analysis[entry.provider]) {
        analysis[entry.provider] = {
          totalCost: 0,
          requestCount: 0,
          avgCostPerRequest: 0,
          tokensProcessed: 0,
          avgCostPerToken: 0
        };
      }

      const providerData = analysis[entry.provider];
      providerData.totalCost += entry.totalCost;
      providerData.requestCount += 1;
      providerData.tokensProcessed += (entry.tokensIn || 0) + (entry.tokensOut || 0);
    }

    // Calculate averages
    for (const provider of Object.keys(analysis)) {
      const data = analysis[provider];
      data.avgCostPerRequest = data.totalCost / data.requestCount;
      data.avgCostPerToken = data.tokensProcessed > 0 ? data.totalCost / data.tokensProcessed : 0;
    }

    return analysis;
  }

  private generateProviderRecommendations(analysis: ProviderCostAnalysis): CostRecommendation[] {
    const recommendations: CostRecommendation[] = [];

    const providers = Object.entries(analysis).sort((a, b) => b[1].avgCostPerToken - a[1].avgCostPerToken);
    
    if (providers.length > 1) {
      const mostExpensive = providers[0];
      const cheapest = providers[providers.length - 1];
      
      const savings = (mostExpensive[1].avgCostPerToken - cheapest[1].avgCostPerToken) * mostExpensive[1].tokensProcessed;
      
      if (savings > 0.01) { // Only recommend if savings > $0.01
        recommendations.push({
          type: 'provider-optimization',
          title: `Switch from ${mostExpensive[0]} to ${cheapest[0]} for cost optimization`,
          description: `${cheapest[0]} costs ${((1 - cheapest[1].avgCostPerToken / mostExpensive[1].avgCostPerToken) * 100).toFixed(1)}% less per token`,
          potentialSavings: savings,
          confidence: 0.8,
          implementation: `Configure Jurexio-L router to prefer ${cheapest[0]} for routine tasks`
        });
      }
    }

    return recommendations;
  }

  private analyzeUsagePatterns(costData: CostEntry[]): UsagePatternAnalysis {
    const patterns: UsagePatternAnalysis = {
      peakHours: {},
      requestSizes: {},
      capabilities: {}
    };

    for (const entry of costData) {
      // Peak hours analysis
      const hour = new Date(entry.timestamp).getHours();
      patterns.peakHours[hour] = (patterns.peakHours[hour] || 0) + entry.totalCost;

      // Request sizes
      const tokenTotal = (entry.tokensIn || 0) + (entry.tokensOut || 0);
      const sizeCategory = this.categorizeRequestSize(tokenTotal);
      patterns.requestSizes[sizeCategory] = (patterns.requestSizes[sizeCategory] || 0) + entry.totalCost;

      // Capabilities
      patterns.capabilities[entry.capability] = (patterns.capabilities[entry.capability] || 0) + entry.totalCost;
    }

    return patterns;
  }

  private generateUsageRecommendations(patterns: UsagePatternAnalysis): CostRecommendation[] {
    const recommendations: CostRecommendation[] = [];

    // Check for potential caching opportunities
    const totalCapabilityCost = Object.values(patterns.capabilities).reduce((sum, cost) => sum + cost, 0);
    const textGenerationCost = patterns.capabilities['text-generation'] || 0;
    
    if (textGenerationCost / totalCapabilityCost > 0.6) {
      const cachingSavings = textGenerationCost * 0.3; // Assume 30% cache hit rate
      recommendations.push({
        type: 'caching',
        title: 'Enable intelligent caching for text generation',
        description: 'High volume of text generation requests could benefit from response caching',
        potentialSavings: cachingSavings,
        confidence: 0.7,
        implementation: 'Configure response caching with semantic similarity matching'
      });
    }

    return recommendations;
  }

  private analyzeModelSelection(costData: CostEntry[]): ModelSelectionAnalysis {
    const analysis: ModelSelectionAnalysis = {};

    for (const entry of costData) {
      if (!analysis[entry.model]) {
        analysis[entry.model] = {
          usage: 0,
          totalCost: 0,
          avgQuality: 0,
          capabilities: new Set()
        };
      }

      const modelData = analysis[entry.model];
      modelData.usage += 1;
      modelData.totalCost += entry.totalCost;
      modelData.avgQuality = ((modelData.avgQuality * (modelData.usage - 1)) + (entry.qualityScore || 0)) / modelData.usage;
      modelData.capabilities.add(entry.capability);
    }

    return analysis;
  }

  private generateModelRecommendations(analysis: ModelSelectionAnalysis): CostRecommendation[] {
    const recommendations: CostRecommendation[] = [];

    // Find overpriced models with acceptable quality alternatives
    const models = Object.entries(analysis).sort((a, b) => b[1].totalCost - a[1].totalCost);

    for (let i = 0; i < models.length - 1; i++) {
      const expensive = models[i];
      const cheaper = models[i + 1];

      // Check if quality difference is minimal
      const qualityDiff = expensive[1].avgQuality - cheaper[1].avgQuality;
      const costDiff = expensive[1].totalCost - cheaper[1].totalCost;

      if (qualityDiff < 0.1 && costDiff > 0.01) { // Quality difference < 10%, cost difference > $0.01
        recommendations.push({
          type: 'model-optimization',
          title: `Consider using ${cheaper[0]} instead of ${expensive[0]}`,
          description: `Similar quality (${(qualityDiff * 100).toFixed(1)}% difference) at lower cost`,
          potentialSavings: costDiff,
          confidence: 0.6,
          implementation: 'Adjust model routing preferences in Jurexio-L router'
        });
        break; // Only recommend one model switch at a time
      }
    }

    return recommendations;
  }

  private categorizeRequestSize(tokens: number): string {
    if (tokens < 100) return 'small';
    if (tokens < 1000) return 'medium';
    if (tokens < 10000) return 'large';
    return 'xlarge';
  }

  private getPeriodStart(period: TimePeriod): number {
    const now = new Date();
    
    switch (period) {
      case 'hour':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
      case 'day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      case 'week':
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        return new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate()).getTime();
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      default:
        return now.getTime();
    }
  }

  private calculateCostTrends(costData: CostEntry[], period: TimePeriod): CostTrend[] {
    // Simplified trend calculation
    return [];
  }

  private async analyzeCostTrends(): Promise<void> {
    // Analyze cost trends across all tenants
  }

  private async monitorBudgets(): Promise<void> {
    // Monitor all tenant budgets
    for (const [tenant, budget] of this.budgets) {
      try {
        const currentSpend = await this.getTenantCost(tenant, budget.period);
        const spendRatio = currentSpend / budget.limit;

        if (spendRatio > 0.9) {
          this.emit('budgetWarning', {
            tenant,
            currentSpend,
            budgetLimit: budget.limit,
            percentUsed: spendRatio * 100
          });
        }
      } catch (error: any) {
        this.logger.warn(`⚠️ Budget monitoring failed for ${tenant}:`, error);
      }
    }
  }

  async getTotalCost(): Promise<number> {
    return this.totalCostToDate;
  }

  async getHealth(): Promise<ComponentHealth> {
    return {
      healthy: this.initialized,
      status: this.initialized ? 'active' : 'inactive',
      lastCheck: Date.now(),
      details: {
        totalCost: this.totalCostToDate,
        activeBudgets: this.budgets.size,
        trackedTenants: this.costTracking.size
      }
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info('🔄 Shutting down cost manager...');
    this.initialized = false;
  }
}

// Error classes
class CostLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostLimitError';
  }
}

// Type definitions
const DEFAULT_COST_CEILINGS: CostCeilings = {
  perRequest: 10.0,  // $10 per request
  perHour: 1000.0,   // $1000 per hour
  perDay: 10000.0    // $10000 per day
};

interface CostManagerConfig {
  ceilings?: CostCeilings;
  telemetry?: any;
}

interface CostCeilings {
  perRequest: number;
  perHour: number;
  perDay: number;
}

interface CostEntry {
  requestId: string;
  tenant: string;
  provider: string;
  model: string;
  capability: string;
  totalCost: number;
  tokensIn?: number;
  tokensOut?: number;
  gpuSeconds?: number;
  step?: string;
  agent?: string;
  fallbackUsed?: boolean;
  qualityScore?: number;
  timestamp: number;
}

interface Budget {
  limit: number;
  period: TimePeriod;
  alertThresholds: number[];
}

type TimePeriod = 'hour' | 'day' | 'week' | 'month';

interface CostBreakdown {
  total: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byCapability: Record<string, number>;
  byTimeOfDay: Record<string, number>;
  trends: CostTrend[];
}

interface CostTrend {
  period: string;
  cost: number;
  change: number;
}

interface CostRecommendation {
  type: string;
  title: string;
  description: string;
  potentialSavings: number;
  confidence: number;
  implementation: string;
}

interface ProviderCostAnalysis {
  [providerId: string]: {
    totalCost: number;
    requestCount: number;
    avgCostPerRequest: number;
    tokensProcessed: number;
    avgCostPerToken: number;
  };
}

interface UsagePatternAnalysis {
  peakHours: Record<number, number>;
  requestSizes: Record<string, number>;
  capabilities: Record<string, number>;
}

interface ModelSelectionAnalysis {
  [modelId: string]: {
    usage: number;
    totalCost: number;
    avgQuality: number;
    capabilities: Set<string>;
  };
}

interface ComponentHealth {
  healthy: boolean;
  status: string;
  lastCheck: number;
  details?: Record<string, unknown>;
}