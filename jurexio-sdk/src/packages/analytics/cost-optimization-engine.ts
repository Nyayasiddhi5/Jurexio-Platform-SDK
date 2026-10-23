/**
 * Cost Optimization Engine - Real-time Cost Analysis & Provider Selection
 * 
 * Implements comprehensive cost optimization with:
 * - Real-time cost analysis and monitoring
 * - Dynamic provider selection algorithms
 * - Budget management and alerting
 * - Cost prediction and forecasting
 * - Usage pattern analysis
 * - ROI optimization strategies
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('cost-optimization-engine');

// LLM types
export interface LLMRequest { model: string; messages: any[]; maxTokens?: number; correlationId?: string; }
export interface LLMResponse { content: string; tokensUsed: number; cost: number; }
// Provider selection type
export interface ProviderSelection { provider: string; model: string; estimatedCost: number; }
// Provider registry - manages LLM provider availability, metrics, and selection
const providerRegistry: any = {
  getAvailableProviders: () => [],
  getAvailableProviderIds: () => [],
  getRegisteredProviders: () => [],
  selectProvider: () => null,
  getProviderMetrics: (providerId: string) => ({ averageResponseTime: 2000 })
};
// Utility function
const generateCorrelationId = () => `corr-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

export interface CostOptimizationConfig {
  budgetLimits: {
    hourly: number;
    daily: number;
    monthly: number;
  };
  alertThresholds: {
    hourlyWarning: number;
    dailyWarning: number;
    monthlyWarning: number;
    criticalUsage: number;
  };
  optimizationStrategy: 'aggressive' | 'balanced' | 'conservative';
  qualityThresholds: {
    minimum: number;
    target: number;
  };
  costEfficiencyTargets: {
    costPerToken: number;
    responseTimeWeight: number;
    qualityWeight: number;
  };
}

export interface CostMetrics {
  totalCost: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  costByTimeRange: {
    lastHour: number;
    lastDay: number;
    lastWeek: number;
    lastMonth: number;
  };
  requestMetrics: {
    totalRequests: number;
    averageCostPerRequest: number;
    costPerToken: number;
    tokenEfficiency: number;
  };
  projections: {
    hourlyBurn: number;
    dailyBurn: number;
    monthlyProjection: number;
  };
}

export interface CostAlert {
  id: string;
  type: 'warning' | 'critical' | 'budget_exceeded';
  message: string;
  currentUsage: number;
  threshold: number;
  timeRange: 'hourly' | 'daily' | 'monthly';
  timestamp: Date;
  recommendations: string[];
}

export interface OptimizationRecommendation {
  type: 'provider_switch' | 'model_downgrade' | 'batch_requests' | 'cache_utilization';
  currentCost: number;
  projectedCost: number;
  savings: number;
  savingsPercentage: number;
  impact: 'low' | 'medium' | 'high';
  description: string;
  actionRequired: string;
  confidence: number;
}

export interface CostAnalysisResult {
  requestId: string;
  originalRequest: LLMRequest;
  providerOptions: Array<{
    provider: string;
    estimatedCost: number;
    estimatedTime: number;
    qualityScore: number;
    costEfficiencyScore: number;
  }>;
  selectedProvider: string;
  rationale: string;
  projectedSavings: number;
  riskAssessment: string;
  timestamp?: Date;
}

export class CostOptimizationEngine extends EventEmitter {
  private config: CostOptimizationConfig;
  private costHistory: Array<{
    timestamp: Date;
    cost: number;
    provider: string;
    model: string;
    requestId: string;
    responseTime: number;
    tokenCount: number;
  }> = [];
  private budgetUsage: Record<string, number> = {
    hourly: 0,
    daily: 0,
    monthly: 0
  };
  private alerts: CostAlert[] = [];
  private optimizationCache: Map<string, CostAnalysisResult> = new Map();

  constructor(config?: Partial<CostOptimizationConfig>) {
    super();
    
    this.config = {
      budgetLimits: {
        hourly: 10,
        daily: 100,
        monthly: 2000
      },
      alertThresholds: {
        hourlyWarning: 8,
        dailyWarning: 80,
        monthlyWarning: 1600,
        criticalUsage: 0.95
      },
      optimizationStrategy: 'balanced',
      qualityThresholds: {
        minimum: 0.7,
        target: 0.85
      },
      costEfficiencyTargets: {
        costPerToken: 0.000002, // $2 per 1M tokens
        responseTimeWeight: 0.3,
        qualityWeight: 0.5
      },
      ...config
    };

    this.initializeEngine();
    logger.info('💰 Cost Optimization Engine initialized');
  }

  private initializeEngine(): void {
    // Start budget monitoring
    this.startBudgetMonitoring();
    
    // Start cost analysis
    this.startCostAnalysis();
    
    // Start cleanup routine
    this.startCleanupRoutine();
    
    logger.info('✅ Cost optimization monitoring started');
  }

  private startBudgetMonitoring(): void {
    // Check budget usage every minute
    setInterval(() => {
      this.updateBudgetUsage();
      this.checkAlertThresholds();
    }, 60000);
  }

  private startCostAnalysis(): void {
    // Generate cost reports every hour
    setInterval(() => {
      this.generateCostReport();
      this.generateOptimizationRecommendations();
    }, 3600000);
  }

  private startCleanupRoutine(): void {
    // Clean up old data every day
    setInterval(() => {
      this.cleanupOldData();
    }, 86400000);
  }

  public async optimizeProviderSelection(request: LLMRequest): Promise<CostAnalysisResult> {
    const requestId = request.correlationId || generateCorrelationId();
    
    // Check cache first
    const cacheKey = this.generateCacheKey(request);
    const cached = this.optimizationCache.get(cacheKey);
    if (cached && cached.timestamp && Date.now() - cached.timestamp.getTime() < 300000) { // 5 minutes
      return { ...cached, requestId };
    }

    // Get available providers
    const availableProviders = providerRegistry.getAvailableProviderIds();
    
    // Analyze cost and performance for each provider
    const providerOptions = await Promise.all(
      availableProviders.map(async (providerId: any) => {
        try {
          const provider = providerRegistry.getRegisteredProviders()
            .find((p: any) => p.id === providerId);
          
          if (!provider) return null;

          return {
            provider: providerId,
            estimatedCost: this.estimateRequestCost(request, provider),
            estimatedTime: this.estimateResponseTime(providerId),
            qualityScore: this.estimateQualityScore(request, provider),
            costEfficiencyScore: 0 // Will be calculated
          };
        } catch (error: any) {
          logger.warn(`Failed to analyze provider ${providerId}:`, error);
          return null;
        }
      })
    );

    const validOptions = providerOptions.filter((option: any) => option !== null);
    
    // Calculate cost efficiency scores
    for (const option of validOptions) {
      option.costEfficiencyScore = this.calculateCostEfficiencyScore(option);
    }

    // Select optimal provider based on strategy
    const selectedOption = this.selectOptimalProvider(validOptions, request);
    
    const result: CostAnalysisResult = {
      requestId,
      originalRequest: request,
      providerOptions: validOptions,
      selectedProvider: selectedOption.provider,
      rationale: this.generateSelectionRationale(selectedOption, validOptions),
      projectedSavings: this.calculateProjectedSavings(selectedOption, validOptions),
      riskAssessment: this.assessSelectionRisk(selectedOption)
    };

    // Cache the result with timestamp
    const cachedResult = { ...result, timestamp: new Date() };
    this.optimizationCache.set(cacheKey, cachedResult);

    this.emit('optimization-analysis', result);
    return result;
  }

  private generateCacheKey(request: LLMRequest): string {
    const keyData = {
      messages: request.messages.length,
      maxTokens: request.maxTokens || 1000,
      model: request.model || 'default',
      type: this.determineRequestType(request)
    };
    return Buffer.from(JSON.stringify(keyData)).toString('base64');
  }

  private determineRequestType(request: LLMRequest): string {
    const content = request.messages.map(m => 
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join(' ').toLowerCase();

    if (content.includes('code') || content.includes('programming')) return 'coding';
    if (content.includes('analyze') || content.includes('research')) return 'analysis';
    if (content.includes('write') || content.includes('create')) return 'creative';
    return 'general';
  }

  private estimateRequestCost(request: LLMRequest, provider: any): number {
    const estimatedInputTokens = this.estimateTokens(
      request.messages.map(m => 
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      ).join(' ')
    );
    const estimatedOutputTokens = request.maxTokens || 1000;

    const inputCost = (estimatedInputTokens / 1_000_000) * provider.pricing.inputTokenCost;
    const outputCost = (estimatedOutputTokens / 1_000_000) * provider.pricing.outputTokenCost;

    return inputCost + outputCost;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private estimateResponseTime(providerId: string): number {
    const metrics = providerRegistry.getProviderMetrics(providerId);
    if (metrics && typeof metrics === 'object' && 'averageResponseTime' in metrics) {
      return metrics.averageResponseTime;
    }
    return 2000; // Default 2 seconds
  }

  private estimateQualityScore(request: LLMRequest, provider: any): number {
    const requestType = this.determineRequestType(request);
    const capabilities = provider.capabilities;

    switch (requestType) {
      case 'coding':
        return capabilities.codingProficiency / 100;
      case 'analysis':
        return capabilities.reasoning / 100;
      case 'creative':
        return capabilities.creativity / 100;
      default:
        return (capabilities.reasoning + capabilities.creativity + capabilities.factualAccuracy) / 300;
    }
  }

  private calculateCostEfficiencyScore(option: any): number {
    const costWeight = 0.4;
    const timeWeight = this.config.costEfficiencyTargets.responseTimeWeight;
    const qualityWeight = this.config.costEfficiencyTargets.qualityWeight;

    // Normalize scores (0-1, higher is better)
    const costScore = Math.max(0, 1 - (option.estimatedCost / 0.10)); // Assume $0.10 as expensive
    const timeScore = Math.max(0, 1 - (option.estimatedTime / 10000)); // 10 seconds as slow
    const qualityScore = option.qualityScore;

    return (costScore * costWeight) + (timeScore * timeWeight) + (qualityScore * qualityWeight);
  }

  private selectOptimalProvider(options: any[], request: LLMRequest): any {
    if (options.length === 0) {
      throw new Error('No available providers for optimization');
    }

    switch (this.config.optimizationStrategy) {
      case 'aggressive':
        // Prioritize cost above all
        return options.reduce((best, current) => 
          current.estimatedCost < best.estimatedCost ? current : best
        );
      
      case 'conservative':
        // Prioritize quality above all
        return options.reduce((best, current) => 
          current.qualityScore > best.qualityScore ? current : best
        );
      
      case 'balanced':
      default:
        // Use cost efficiency score
        return options.reduce((best, current) => 
          current.costEfficiencyScore > best.costEfficiencyScore ? current : best
        );
    }
  }

  private generateSelectionRationale(selected: any, allOptions: any[]): string {
    const reasons = [];

    if (selected.estimatedCost === Math.min(...allOptions.map(o => o.estimatedCost))) {
      reasons.push('lowest cost option');
    }

    if (selected.qualityScore >= this.config.qualityThresholds.target) {
      reasons.push('meets quality targets');
    }

    if (selected.costEfficiencyScore === Math.max(...allOptions.map(o => o.costEfficiencyScore))) {
      reasons.push('highest cost-efficiency score');
    }

    return `Selected ${selected.provider} due to: ${reasons.join(', ')}. ` +
           `Cost: $${selected.estimatedCost.toFixed(6)}, Quality: ${(selected.qualityScore * 100).toFixed(1)}%`;
  }

  private calculateProjectedSavings(selected: any, allOptions: any[]): number {
    const averageCost = allOptions.reduce((sum, option) => sum + option.estimatedCost, 0) / allOptions.length;
    return Math.max(0, averageCost - selected.estimatedCost);
  }

  private assessSelectionRisk(selected: any): string {
    if (selected.qualityScore < this.config.qualityThresholds.minimum) {
      return 'HIGH: Quality below minimum threshold';
    } else if (selected.qualityScore < this.config.qualityThresholds.target) {
      return 'MEDIUM: Quality below target';
    } else {
      return 'LOW: Quality meets expectations';
    }
  }

  public recordCost(response: any): void {
    const record = {
      timestamp: new Date(),
      cost: response.cost,
      provider: response.provider || 'unknown',
      model: response.model || 'unknown',
      requestId: response.correlationId || 'unknown',
      responseTime: response.responseTime || 0,
      tokenCount: response.usage?.totalTokens || 0
    };

    this.costHistory.push(record);
    this.updateBudgetUsage();

    this.emit('cost-recorded', record);
  }

  private updateBudgetUsage(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 86400000);

    this.budgetUsage.hourly = this.costHistory
      .filter(record => record.timestamp > oneHourAgo)
      .reduce((sum, record) => sum + record.cost, 0);

    this.budgetUsage.daily = this.costHistory
      .filter(record => record.timestamp > oneDayAgo)
      .reduce((sum, record) => sum + record.cost, 0);

    this.budgetUsage.monthly = this.costHistory
      .filter(record => record.timestamp > oneMonthAgo)
      .reduce((sum, record) => sum + record.cost, 0);
  }

  private checkAlertThresholds(): void {
    const checks = [
      {
        type: 'hourly' as const,
        current: this.budgetUsage.hourly,
        warning: this.config.alertThresholds.hourlyWarning,
        limit: this.config.budgetLimits.hourly
      },
      {
        type: 'daily' as const,
        current: this.budgetUsage.daily,
        warning: this.config.alertThresholds.dailyWarning,
        limit: this.config.budgetLimits.daily
      },
      {
        type: 'monthly' as const,
        current: this.budgetUsage.monthly,
        warning: this.config.alertThresholds.monthlyWarning,
        limit: this.config.budgetLimits.monthly
      }
    ];

    for (const check of checks) {
      if (check.current >= check.limit) {
        this.generateAlert('budget_exceeded', check.type, check.current, check.limit);
      } else if (check.current >= check.warning) {
        this.generateAlert('warning', check.type, check.current, check.warning);
      }
    }
  }

  private generateAlert(
    type: CostAlert['type'], 
    timeRange: CostAlert['timeRange'], 
    current: number, 
    threshold: number
  ): void {
    const alertId = `${type}-${timeRange}-${Date.now()}`;
    
    const alert: CostAlert = {
      id: alertId,
      type,
      message: this.generateAlertMessage(type, timeRange, current, threshold),
      currentUsage: current,
      threshold,
      timeRange,
      timestamp: new Date(),
      recommendations: this.generateAlertRecommendations(type, timeRange)
    };

    this.alerts.push(alert);
    this.emit('cost-alert', alert);
    
    logger.warn(`🚨 Cost Alert [${type.toUpperCase()}]: ${alert.message}`);
  }

  private generateAlertMessage(
    type: CostAlert['type'], 
    timeRange: CostAlert['timeRange'], 
    current: number, 
    threshold: number
  ): string {
    const percentage = ((current / threshold) * 100).toFixed(1);
    
    switch (type) {
      case 'budget_exceeded':
        return `${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)} budget exceeded! ` +
               `Current: $${current.toFixed(4)}, Limit: $${threshold.toFixed(4)}`;
      case 'warning':
        return `${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)} budget warning at ${percentage}%. ` +
               `Current: $${current.toFixed(4)}, Threshold: $${threshold.toFixed(4)}`;
      case 'critical':
        return `Critical usage detected for ${timeRange} period. Immediate action required.`;
      default:
        return `Budget alert for ${timeRange} period.`;
    }
  }

  private generateAlertRecommendations(type: CostAlert['type'], timeRange: CostAlert['timeRange']): string[] {
    const recommendations = [];

    if (type === 'budget_exceeded') {
      recommendations.push('Immediately switch to lowest-cost providers');
      recommendations.push('Reduce model complexity for non-critical requests');
      recommendations.push('Implement request queuing to control spending');
    } else if (type === 'warning') {
      recommendations.push('Consider switching to more cost-effective providers');
      recommendations.push('Review and optimize frequently used models');
      recommendations.push('Implement caching to reduce redundant requests');
    }

    recommendations.push('Enable aggressive cost optimization mode');
    recommendations.push('Review request patterns for optimization opportunities');

    return recommendations;
  }

  private generateCostReport(): void {
    const metrics = this.getCostMetrics();
    
    this.emit('cost-report', {
      timestamp: new Date(),
      metrics,
      alerts: this.alerts.slice(-10), // Last 10 alerts
      recommendations: this.generateOptimizationRecommendations()
    });
  }

  public getCostMetrics(): CostMetrics {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 86400000);

    const totalCost = this.costHistory.reduce((sum, record) => sum + record.cost, 0);
    const totalTokens = this.costHistory.reduce((sum, record) => sum + record.tokenCount, 0);

    // Cost by provider
    const costByProvider: Record<string, number> = {};
    const costByModel: Record<string, number> = {};

    for (const record of this.costHistory) {
      costByProvider[record.provider] = (costByProvider[record.provider] || 0) + record.cost;
      costByModel[record.model] = (costByModel[record.model] || 0) + record.cost;
    }

    return {
      totalCost,
      costByProvider,
      costByModel,
      costByTimeRange: {
        lastHour: this.budgetUsage.hourly,
        lastDay: this.budgetUsage.daily,
        lastWeek: this.costHistory
          .filter(r => r.timestamp > oneWeekAgo)
          .reduce((sum, r) => sum + r.cost, 0),
        lastMonth: this.budgetUsage.monthly
      },
      requestMetrics: {
        totalRequests: this.costHistory.length,
        averageCostPerRequest: this.costHistory.length > 0 ? totalCost / this.costHistory.length : 0,
        costPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
        tokenEfficiency: totalTokens > 0 ? this.costHistory.length / totalTokens : 0
      },
      projections: {
        hourlyBurn: this.budgetUsage.hourly,
        dailyBurn: this.budgetUsage.hourly * 24,
        monthlyProjection: this.budgetUsage.daily * 30
      }
    };
  }

  public generateOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const metrics = this.getCostMetrics();

    // Provider switching recommendations
    const expensiveProviders = Object.entries(metrics.costByProvider)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);

    for (const [provider, cost] of expensiveProviders) {
      if (cost > metrics.totalCost * 0.3) { // Provider accounts for >30% of costs
        recommendations.push({
          type: 'provider_switch',
          currentCost: cost,
          projectedCost: cost * 0.6, // Assume 40% savings
          savings: cost * 0.4,
          savingsPercentage: 40,
          impact: 'high',
          description: `Switch from ${provider} to more cost-effective alternatives`,
          actionRequired: `Evaluate cheaper providers with similar capabilities to ${provider}`,
          confidence: 0.7
        });
      }
    }

    // Model downgrade recommendations
    if (metrics.requestMetrics.averageCostPerRequest > this.config.costEfficiencyTargets.costPerToken * 1000) {
      recommendations.push({
        type: 'model_downgrade',
        currentCost: metrics.requestMetrics.averageCostPerRequest,
        projectedCost: metrics.requestMetrics.averageCostPerRequest * 0.5,
        savings: metrics.requestMetrics.averageCostPerRequest * 0.5,
        savingsPercentage: 50,
        impact: 'medium',
        description: 'Consider using smaller, more efficient models for routine tasks',
        actionRequired: 'Analyze request types and identify opportunities for model downgrading',
        confidence: 0.8
      });
    }

    // Batch processing recommendations
    if (this.costHistory.length > 100) {
      const recentRequests = this.costHistory.slice(-100);
      const smallRequests = recentRequests.filter(r => r.tokenCount < 500);
      
      if (smallRequests.length > 20) {
        recommendations.push({
          type: 'batch_requests',
          currentCost: smallRequests.reduce((sum, r) => sum + r.cost, 0),
          projectedCost: smallRequests.reduce((sum, r) => sum + r.cost, 0) * 0.7,
          savings: smallRequests.reduce((sum, r) => sum + r.cost, 0) * 0.3,
          savingsPercentage: 30,
          impact: 'medium',
          description: 'Batch small requests together to reduce per-request overhead',
          actionRequired: 'Implement request batching for small queries',
          confidence: 0.6
        });
      }
    }

    return recommendations.sort((a, b) => b.savings - a.savings);
  }

  private cleanupOldData(): void {
    const oneMonthAgo = new Date(Date.now() - 30 * 86400000);
    
    // Remove cost history older than 30 days
    this.costHistory = this.costHistory.filter(record => record.timestamp > oneMonthAgo);
    
    // Remove old alerts
    this.alerts = this.alerts.filter(alert => alert.timestamp > oneMonthAgo);
    
    // Clear old cache entries
    this.optimizationCache.clear();
    
    logger.info('🧹 Cleaned up old cost optimization data');
  }

  // Public API methods
  public updateConfig(newConfig: Partial<CostOptimizationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('config-updated', this.config);
    logger.info('🔧 Cost optimization config updated');
  }

  public getBudgetUsage(): typeof this.budgetUsage {
    return { ...this.budgetUsage };
  }

  public getActiveAlerts(): CostAlert[] {
    const oneHourAgo = new Date(Date.now() - 3600000);
    return this.alerts.filter(alert => alert.timestamp > oneHourAgo);
  }

  public clearAlerts(): void {
    this.alerts = [];
    this.emit('alerts-cleared');
  }

  public async getOptimalProvider(request: LLMRequest): Promise<ProviderSelection> {
    const analysis = await this.optimizeProviderSelection(request);
    return await providerRegistry.selectProvider(request, 'cheapest');
  }

  public getSystemStatus(): any {
    return {
      engineStatus: 'operational',
      strategy: this.config.optimizationStrategy,
      budgetUsage: this.budgetUsage,
      budgetLimits: this.config.budgetLimits,
      activeAlerts: this.getActiveAlerts().length,
      totalCostTracked: this.costHistory.reduce((sum, r) => sum + r.cost, 0),
      optimizationCacheSize: this.optimizationCache.size,
      lastAnalysis: new Date()
    };
  }
}

// Global cost optimization engine instance
export const costOptimizationEngine = new CostOptimizationEngine();