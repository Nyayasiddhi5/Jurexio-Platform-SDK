// @ts-nocheck
// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Provider Registry - Central Management System
 * 
 * Centralized management system for all 15+ LLM providers with:
 * - Dynamic provider registration and discovery
 * - Health monitoring and status management
 * - Load balancing and circuit breaker patterns
 * - Performance metrics and analytics
 * - Configuration management
 * - Provider lifecycle management
 */

import { EventEmitter } from 'events';
import type { UnifiedLLMAdapter, LLMProvider, LLMRequest, LLMResponse } from './unified-llm-adapter.js';

// Provider imports
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { CohereProvider } from './cohere-provider.js';
import { GoogleProvider } from './google-provider.js';
import { GroqProvider } from './groq-provider.js';
import { MistralProvider } from './mistral-provider.js';
import { PerplexityProvider } from './perplexity-provider.js';
import { ReplicateProvider } from './replicate-provider.js';
import { XAIProvider } from './xai-provider.js';
import { MetaProvider } from './meta-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';
import { TogetherAIProvider } from './together-ai-provider.js';
import { AgentZeroProvider } from './agentzero-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('provider-registry');

export interface ProviderConfig {
  id: string;
  enabled: boolean;
  priority: number;
  fallbackLevel: number;
  maxConcurrentRequests: number;
  healthCheckInterval: number;
  circuitBreakerConfig: {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
  };
  costLimits: {
    maxCostPerRequest: number;
    maxCostPerHour: number;
    maxCostPerDay: number;
  };
  apiKey?: string;
  customConfig?: Record<string, any>;
}

export interface ProviderStatus {
  id: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disabled' | 'circuit-open';
  lastHealthCheck: Date;
  healthScore: number;
  responseTime: number;
  errorRate: number;
  requestCount: number;
  totalCost: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  lastError?: string;
  uptime: number;
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  totalCost: number;
  costPerRequest: number;
  requestsPerMinute: number;
  errorsByType: Record<string, number>;
  lastHourStats: {
    requests: number;
    cost: number;
    averageResponseTime: number;
  };
}

export interface ProviderSelection {
  provider: UnifiedLLMAdapter;
  reason: string;
  confidence: number;
  expectedCost: number;
  expectedResponseTime: number;
  fallbackOptions: string[];
}

export class ProviderRegistry extends EventEmitter {
  private providers: Map<string, UnifiedLLMAdapter> = new Map();
  private configs: Map<string, ProviderConfig> = new Map();
  private status: Map<string, ProviderStatus> = new Map();
  private metrics: Map<string, ProviderMetrics> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private circuitBreakers: Map<string, any> = new Map();

  // Provider class mappings
  private providerClasses = {
    'openai': OpenAIProvider,
    'anthropic': AnthropicProvider,
    'cohere': CohereProvider,
    'google': GoogleProvider,
    'groq': GroqProvider,
    'mistral': MistralProvider,
    'perplexity': PerplexityProvider,
    'replicate': ReplicateProvider,
    'xai': XAIProvider,
    'meta': MetaProvider,
    'deepseek': DeepSeekProvider,
    'together-ai': TogetherAIProvider,
    'agentzero': AgentZeroProvider,
    'openrouter': OpenRouterProvider
  };

  constructor() {
    super();
    this.initializeRegistry();
    logger.info('🏗️ Provider Registry initialized');
  }

  private async initializeRegistry(): Promise<void> {
    try {
      // Load default configurations
      await this.loadDefaultConfigurations();
      
      // Auto-discover and register providers
      await this.autoDiscoverProviders();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Initialize circuit breakers
      this.initializeCircuitBreakers();
      
      logger.info(`✅ Provider Registry ready with ${this.providers.size} providers`);
      this.emit('registry-ready', { providerCount: this.providers.size });
    } catch (error: any) {
      logger.error('Failed to initialize Provider Registry:', error);
      this.emit('registry-error', error);
    }
  }

  private async loadDefaultConfigurations(): Promise<void> {
    const defaultConfigs: ProviderConfig[] = [
      // Tier 1: Premium providers
      {
        id: 'openai',
        enabled: true,
        priority: 100,
        fallbackLevel: 1,
        maxConcurrentRequests: 10,
        healthCheckInterval: 60000,
        circuitBreakerConfig: { failureThreshold: 5, resetTimeout: 60000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 1.0, maxCostPerHour: 100, maxCostPerDay: 1000 }
      },
      {
        id: 'anthropic',
        enabled: true,
        priority: 95,
        fallbackLevel: 1,
        maxConcurrentRequests: 8,
        healthCheckInterval: 60000,
        circuitBreakerConfig: { failureThreshold: 5, resetTimeout: 60000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 1.0, maxCostPerHour: 100, maxCostPerDay: 1000 }
      },
      {
        id: 'google',
        enabled: true,
        priority: 90,
        fallbackLevel: 1,
        maxConcurrentRequests: 8,
        healthCheckInterval: 60000,
        circuitBreakerConfig: { failureThreshold: 5, resetTimeout: 60000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.5, maxCostPerHour: 50, maxCostPerDay: 500 }
      },
      
      // Tier 2: High-performance providers
      {
        id: 'xai',
        enabled: true,
        priority: 85,
        fallbackLevel: 2,
        maxConcurrentRequests: 6,
        healthCheckInterval: 120000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 120000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.8, maxCostPerHour: 80, maxCostPerDay: 800 }
      },
      {
        id: 'meta',
        enabled: true,
        priority: 80,
        fallbackLevel: 2,
        maxConcurrentRequests: 8,
        healthCheckInterval: 120000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 120000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.3, maxCostPerHour: 30, maxCostPerDay: 300 }
      },
      {
        id: 'deepseek',
        enabled: true,
        priority: 78,
        fallbackLevel: 2,
        maxConcurrentRequests: 10,
        healthCheckInterval: 120000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 120000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.2, maxCostPerHour: 20, maxCostPerDay: 200 }
      },
      
      // Tier 3: Specialized providers
      {
        id: 'cohere',
        enabled: true,
        priority: 75,
        fallbackLevel: 3,
        maxConcurrentRequests: 6,
        healthCheckInterval: 180000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 180000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.5, maxCostPerHour: 50, maxCostPerDay: 500 }
      },
      {
        id: 'mistral',
        enabled: true,
        priority: 70,
        fallbackLevel: 3,
        maxConcurrentRequests: 6,
        healthCheckInterval: 180000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 180000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.3, maxCostPerHour: 30, maxCostPerDay: 300 }
      },
      {
        id: 'groq',
        enabled: true,
        priority: 68,
        fallbackLevel: 3,
        maxConcurrentRequests: 12,
        healthCheckInterval: 180000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 180000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.1, maxCostPerHour: 10, maxCostPerDay: 100 }
      },
      {
        id: 'perplexity',
        enabled: true,
        priority: 65,
        fallbackLevel: 3,
        maxConcurrentRequests: 6,
        healthCheckInterval: 180000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 180000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.3, maxCostPerHour: 30, maxCostPerDay: 300 }
      },
      {
        id: 'replicate',
        enabled: true,
        priority: 60,
        fallbackLevel: 3,
        maxConcurrentRequests: 4,
        healthCheckInterval: 180000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 180000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0.5, maxCostPerHour: 50, maxCostPerDay: 500 }
      },
      
      // Tier 4: Open source and alternative providers
      {
        id: 'together-ai',
        enabled: true,
        priority: 55,
        fallbackLevel: 4,
        maxConcurrentRequests: 8,
        healthCheckInterval: 300000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 300000, monitoringPeriod: 600000 },
        costLimits: { maxCostPerRequest: 0.2, maxCostPerHour: 20, maxCostPerDay: 200 }
      },
      {
        id: 'openrouter',
        enabled: true,
        priority: 50,
        fallbackLevel: 4,
        maxConcurrentRequests: 6,
        healthCheckInterval: 300000,
        circuitBreakerConfig: { failureThreshold: 3, resetTimeout: 300000, monitoringPeriod: 600000 },
        costLimits: { maxCostPerRequest: 0.5, maxCostPerHour: 50, maxCostPerDay: 500 }
      },
      
      // Tier 5: Emergency fallback
      {
        id: 'agentzero',
        enabled: true,
        priority: 1,
        fallbackLevel: 5,
        maxConcurrentRequests: 50,
        healthCheckInterval: 600000,
        circuitBreakerConfig: { failureThreshold: 10, resetTimeout: 60000, monitoringPeriod: 300000 },
        costLimits: { maxCostPerRequest: 0, maxCostPerHour: 0, maxCostPerDay: 0 }
      }
    ];

    for (const config of defaultConfigs) {
      this.configs.set(config.id, config);
    }

    logger.info(`📋 Loaded ${defaultConfigs.length} default provider configurations`);
  }

  private async autoDiscoverProviders(): Promise<void> {
    const discoveries = [];

    for (const [providerId, config] of this.configs) {
      if (config.enabled && this.providerClasses[providerId as keyof typeof this.providerClasses]) {
        discoveries.push(this.discoverAndRegisterProvider(providerId, config));
      }
    }

    await Promise.allSettled(discoveries);
  }

  private async discoverAndRegisterProvider(providerId: string, config: ProviderConfig): Promise<void> {
    try {
      const ProviderClass = this.providerClasses[providerId as keyof typeof this.providerClasses];
      if (!ProviderClass) {
        throw new Error(`Provider class not found for ${providerId}`);
      }

      // Check for API key
      const apiKey = config.apiKey || process.env[`${providerId.toUpperCase()}_API_KEY`] || process.env[`${providerId.replace('-', '_').toUpperCase()}_API_KEY`];
      
      if (!apiKey && providerId !== 'agentzero') {
        logger.warn(`⚠️ No API key found for ${providerId}, skipping registration`);
        return;
      }

      // Instantiate provider
      const provider = new ProviderClass(apiKey);

      // Validate provider
      const isValid = await provider.validateApiKey();
      if (!isValid && providerId !== 'agentzero') {
        logger.warn(`⚠️ API key validation failed for ${providerId}, skipping registration`);
        return;
      }

      // Register provider
      this.registerProvider(provider);
      
      logger.info(`✅ Successfully discovered and registered ${providerId}`);
    } catch (error: any) {
      logger.error(`❌ Failed to discover provider ${providerId}:`, error);
    }
  }

  public registerProvider(provider: UnifiedLLMAdapter): void {
    const providerId = provider.getProvider().id;
    
    this.providers.set(providerId, provider);
    
    // Initialize status
    this.status.set(providerId, {
      id: providerId,
      status: 'healthy',
      lastHealthCheck: new Date(),
      healthScore: 100,
      responseTime: 0,
      errorRate: 0,
      requestCount: 0,
      totalCost: 0,
      circuitBreakerState: 'closed',
      uptime: 100
    });

    // Initialize metrics
    this.metrics.set(providerId, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      totalCost: 0,
      costPerRequest: 0,
      requestsPerMinute: 0,
      errorsByType: {},
      lastHourStats: { requests: 0, cost: 0, averageResponseTime: 0 }
    });

    this.emit('provider-registered', { providerId, provider: provider.getProvider() });
    logger.info(`📝 Registered provider: ${providerId}`);
  }

  public unregisterProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      this.providers.delete(providerId);
      this.status.delete(providerId);
      this.metrics.delete(providerId);
      
      // Clear health check interval
      const interval = this.healthCheckIntervals.get(providerId);
      if (interval) {
        clearInterval(interval);
        this.healthCheckIntervals.delete(providerId);
      }

      this.emit('provider-unregistered', { providerId });
      logger.info(`🗑️ Unregistered provider: ${providerId}`);
    }
  }

  private startHealthMonitoring(): void {
    for (const [providerId, config] of this.configs) {
      if (this.providers.has(providerId)) {
        const interval = setInterval(async () => {
          await this.performHealthCheck(providerId);
        }, config.healthCheckInterval);
        
        this.healthCheckIntervals.set(providerId, interval);
      }
    }
    
    logger.info('❤️ Health monitoring started for all providers');
  }

  private async performHealthCheck(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    const status = this.status.get(providerId);
    
    if (!provider || !status) return;

    try {
      const startTime = Date.now();
      const isHealthy = await provider.performHealthCheck();
      const responseTime = Date.now() - startTime;

      // Update status
      status.lastHealthCheck = new Date();
      status.responseTime = responseTime;
      status.healthScore = isHealthy ? Math.min(status.healthScore + 5, 100) : Math.max(status.healthScore - 10, 0);
      status.status = this.determineHealthStatus(status.healthScore);

      this.emit('health-check-completed', { providerId, isHealthy, responseTime, healthScore: status.healthScore });
    } catch (error: any) {
      const status = this.status.get(providerId)!;
      status.lastError = error instanceof Error ? error.message : String(error);
      status.healthScore = Math.max(status.healthScore - 20, 0);
      status.status = 'unhealthy';
      
      this.emit('health-check-failed', { providerId, error: status.lastError });
      logger.error(`❌ Health check failed for ${providerId}:`, error);
    }
  }

  private determineHealthStatus(healthScore: number): ProviderStatus['status'] {
    if (healthScore >= 80) return 'healthy';
    if (healthScore >= 50) return 'degraded';
    return 'unhealthy';
  }

  private initializeCircuitBreakers(): void {
    for (const [providerId, config] of this.configs) {
      if (this.providers.has(providerId)) {
        this.circuitBreakers.set(providerId, {
          state: 'closed',
          failures: 0,
          lastFailureTime: null,
          nextAttemptTime: null
        });
      }
    }
    
    logger.info('⚡ Circuit breakers initialized for all providers');
  }

  public async selectProvider(request: LLMRequest, strategy: 'fastest' | 'cheapest' | 'most-reliable' | 'balanced' = 'balanced'): Promise<ProviderSelection> {
    const availableProviders = this.getAvailableProviders();
    
    if (availableProviders.length === 0) {
      throw new Error('No available providers found');
    }

    let selectedProvider: UnifiedLLMAdapter;
    let reason: string;
    let confidence: number;

    switch (strategy) {
      case 'fastest':
        selectedProvider = this.selectFastestProvider(availableProviders);
        reason = 'Selected for fastest response time';
        confidence = 0.8;
        break;
      
      case 'cheapest':
        selectedProvider = this.selectCheapestProvider(availableProviders, request);
        reason = 'Selected for lowest cost';
        confidence = 0.9;
        break;
      
      case 'most-reliable':
        selectedProvider = this.selectMostReliableProvider(availableProviders);
        reason = 'Selected for highest reliability';
        confidence = 0.95;
        break;
      
      default: // balanced
        selectedProvider = this.selectBalancedProvider(availableProviders, request);
        reason = 'Selected using balanced algorithm (cost + performance + reliability)';
        confidence = 0.85;
        break;
    }

    const providerId = selectedProvider.getProvider().id;
    const metrics = this.metrics.get(providerId);
    const fallbackOptions = this.getFallbackOptions(providerId);

    return {
      provider: selectedProvider,
      reason,
      confidence,
      expectedCost: this.estimateCost(selectedProvider, request),
      expectedResponseTime: metrics?.averageResponseTime || 1000,
      fallbackOptions
    };
  }

  private getAvailableProviders(): UnifiedLLMAdapter[] {
    const available: UnifiedLLMAdapter[] = [];
    
    for (const [providerId, provider] of this.providers) {
      const status = this.status.get(providerId);
      const config = this.configs.get(providerId);
      
      if (status && config && 
          config.enabled && 
          status.status !== 'unhealthy' && 
          status.circuitBreakerState !== 'open') {
        available.push(provider);
      }
    }
    
    return available.sort((a, b) => {
      const configA = this.configs.get(a.getProvider().id)!;
      const configB = this.configs.get(b.getProvider().id)!;
      return configB.priority - configA.priority;
    });
  }

  private selectFastestProvider(providers: UnifiedLLMAdapter[]): UnifiedLLMAdapter {
    let fastest = providers[0];
    let bestTime = Infinity;

    for (const provider of providers) {
      const metrics = this.metrics.get(provider.getProvider().id);
      if (metrics && metrics.averageResponseTime < bestTime) {
        bestTime = metrics.averageResponseTime;
        fastest = provider;
      }
    }

    return fastest;
  }

  private selectCheapestProvider(providers: UnifiedLLMAdapter[], request: LLMRequest): UnifiedLLMAdapter {
    let cheapest = providers[0];
    let bestCost = Infinity;

    for (const provider of providers) {
      const cost = this.estimateCost(provider, request);
      if (cost < bestCost) {
        bestCost = cost;
        cheapest = provider;
      }
    }

    return cheapest;
  }

  private selectMostReliableProvider(providers: UnifiedLLMAdapter[]): UnifiedLLMAdapter {
    let mostReliable = providers[0];
    let bestScore = 0;

    for (const provider of providers) {
      const status = this.status.get(provider.getProvider().id);
      if (status && status.healthScore > bestScore) {
        bestScore = status.healthScore;
        mostReliable = provider;
      }
    }

    return mostReliable;
  }

  private selectBalancedProvider(providers: UnifiedLLMAdapter[], request: LLMRequest): UnifiedLLMAdapter {
    let best = providers[0];
    let bestScore = 0;

    for (const provider of providers) {
      const providerId = provider.getProvider().id;
      const status = this.status.get(providerId);
      const metrics = this.metrics.get(providerId);
      const config = this.configs.get(providerId);

      if (!status || !metrics || !config) continue;

      // Calculate composite score (0-100)
      const reliabilityScore = status.healthScore; // 0-100
      const speedScore = Math.max(0, 100 - (metrics.averageResponseTime / 100)); // 0-100
      const costScore = Math.max(0, 100 - (this.estimateCost(provider, request) * 1000)); // 0-100
      const priorityScore = config.priority; // 0-100

      const compositeScore = (
        reliabilityScore * 0.3 +
        speedScore * 0.25 +
        costScore * 0.25 +
        priorityScore * 0.2
      );

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        best = provider;
      }
    }

    return best;
  }

  private estimateCost(provider: UnifiedLLMAdapter, request: LLMRequest): number {
    const pricing = provider.getProvider().pricing;
    const estimatedTokens = this.estimateTokens(request);
    
    return (estimatedTokens.input * pricing.inputTokenCost / 1_000_000) +
           (estimatedTokens.output * pricing.outputTokenCost / 1_000_000);
  }

  private estimateTokens(request: LLMRequest): { input: number; output: number } {
    const inputText = request.messages.map(m => 
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join(' ');
    
    const inputTokens = Math.ceil(inputText.length / 4); // Rough estimation
    const outputTokens = request.maxTokens || 1000;
    
    return { input: inputTokens, output: outputTokens };
  }

  private getFallbackOptions(currentProviderId: string): string[] {
    const currentConfig = this.configs.get(currentProviderId);
    if (!currentConfig) return [];

    return Array.from(this.configs.entries())
      .filter(([id, config]) => 
        id !== currentProviderId &&
        config.enabled &&
        config.fallbackLevel >= currentConfig.fallbackLevel &&
        this.status.get(id)?.status !== 'unhealthy'
      )
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([id]) => id)
      .slice(0, 3); // Top 3 fallback options
  }

  // Public API methods
  public getProviderStatus(providerId?: string): ProviderStatus | Map<string, ProviderStatus> {
    if (providerId) {
      return this.status.get(providerId) || null;
    }
    return new Map(this.status);
  }

  public getProviderMetrics(providerId?: string): ProviderMetrics | Map<string, ProviderMetrics> {
    if (providerId) {
      return this.metrics.get(providerId) || null;
    }
    return new Map(this.metrics);
  }

  public getRegisteredProviders(): LLMProvider[] {
    return Array.from(this.providers.values()).map(p => p.getProvider());
  }

  public getAvailableProviderIds(): string[] {
    return this.getAvailableProviders().map(p => p.getProvider().id);
  }

  public updateProviderConfig(providerId: string, config: Partial<ProviderConfig>): void {
    const currentConfig = this.configs.get(providerId);
    if (currentConfig) {
      this.configs.set(providerId, { ...currentConfig, ...config });
      this.emit('config-updated', { providerId, config });
      logger.info(`🔧 Updated configuration for ${providerId}`);
    }
  }

  public enableProvider(providerId: string): void {
    this.updateProviderConfig(providerId, { enabled: true });
  }

  public disableProvider(providerId: string): void {
    this.updateProviderConfig(providerId, { enabled: false });
  }

  public getSystemStatus(): any {
    const totalProviders = this.providers.size;
    const healthyProviders = Array.from(this.status.values())
      .filter(s => s.status === 'healthy').length;
    const totalRequests = Array.from(this.metrics.values())
      .reduce((sum, m) => sum + m.totalRequests, 0);
    const totalCost = Array.from(this.metrics.values())
      .reduce((sum, m) => sum + m.totalCost, 0);

    return {
      registryStatus: 'operational',
      totalProviders,
      healthyProviders,
      availableProviders: this.getAvailableProviderIds().length,
      totalRequests,
      totalCost,
      uptime: process.uptime(),
      lastHealthCheck: new Date(),
      fallbackLevels: {
        level1: this.getProvidersByFallbackLevel(1).length,
        level2: this.getProvidersByFallbackLevel(2).length,
        level3: this.getProvidersByFallbackLevel(3).length,
        level4: this.getProvidersByFallbackLevel(4).length,
        level5: this.getProvidersByFallbackLevel(5).length
      }
    };
  }

  private getProvidersByFallbackLevel(level: number): string[] {
    return Array.from(this.configs.entries())
      .filter(([_, config]) => config.fallbackLevel === level && config.enabled)
      .map(([id]) => id);
  }

  public async shutdown(): Promise<void> {
    logger.info('🔄 Shutting down Provider Registry...');
    
    // Clear all intervals
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    
    this.healthCheckIntervals.clear();
    this.emit('registry-shutdown');
    
    logger.info('✅ Provider Registry shutdown complete');
  }

  // Circuit breaker methods
  public getCircuitBreakerState(providerId: string): string {
    return this.circuitBreakers.get(providerId)?.state || 'unknown';
  }

  public recordProviderFailure(providerId: string): void {
    const breaker = this.circuitBreakers.get(providerId);
    const config = this.configs.get(providerId);
    
    if (breaker && config) {
      breaker.failures++;
      breaker.lastFailureTime = Date.now();
      
      if (breaker.failures >= config.circuitBreakerConfig.failureThreshold) {
        breaker.state = 'open';
        breaker.nextAttemptTime = Date.now() + config.circuitBreakerConfig.resetTimeout;
        
        const status = this.status.get(providerId);
        if (status) {
          status.circuitBreakerState = 'open';
        }
        
        this.emit('circuit-breaker-opened', { providerId });
        logger.info(`⚡ Circuit breaker opened for ${providerId}`);
      }
    }
  }

  public recordProviderSuccess(providerId: string): void {
    const breaker = this.circuitBreakers.get(providerId);
    
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
      
      const status = this.status.get(providerId);
      if (status) {
        status.circuitBreakerState = 'closed';
      }
    }
  }
}

// Global registry instance
export const providerRegistry = new ProviderRegistry();