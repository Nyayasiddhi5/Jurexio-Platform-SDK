// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Unified LLM Adapter Interface
 * 
 * Provides a consistent interface across all 15+ LLM providers with:
 * - Real API integrations (no mocks)
 * - Cost tracking and optimization
 * - Health monitoring and circuit breakers
 * - Intelligent fallback handling
 * - Performance metrics collection
 */

import { EventEmitter } from 'events';
import { circuitBreakerManager } from '../circuit-breaker.js';
import { generateCorrelationId } from '../orchestration-utils.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('unified-llm-adapter');

export interface LLMProvider {
  id: string;
  name: string;
  models: string[];
  capabilities: ProviderCapabilities;
  pricing: ProviderPricing;
  limits: ProviderLimits;
  status: 'available' | 'limited' | 'offline' | 'maintenance';
  region: string[];
  apiVersion: string;
  lastHealthCheck: Date;
  healthScore: number; // 0-100
}

export interface ProviderCapabilities {
  textGeneration: boolean;
  codeGeneration: boolean;
  imageGeneration: boolean;
  audioGeneration: boolean;
  speechToText: boolean;
  textToSpeech: boolean;
  multimodal: boolean;
  functionCalling: boolean;
  streaming: boolean;
  embedding: boolean;
  reasoning: number; // 0-100 capability score
  creativity: number; // 0-100 capability score
  factualAccuracy: number; // 0-100 capability score
  codingProficiency: number; // 0-100 capability score
  multilingualSupport: string[]; // Supported language codes
}

export interface ProviderPricing {
  inputTokenCost: number; // Cost per 1M input tokens
  outputTokenCost: number; // Cost per 1M output tokens
  imageGenerationCost?: number; // Cost per image
  audioGenerationCost?: number; // Cost per minute
  embeddingCost?: number; // Cost per 1M embedding tokens
  currency: string;
  billingModel: 'pay-per-use' | 'subscription' | 'free-tier' | 'hybrid';
  freeTierLimits?: {
    tokensPerMonth: number;
    requestsPerMinute: number;
    requestsPerDay: number;
  };
}

export interface ProviderLimits {
  maxTokensPerRequest: number;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  maxConcurrentRequests: number;
  contextWindow: number;
  timeoutMs: number;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  stream?: boolean;
  tools?: LLMTool[];
  systemPrompt?: string;
  metadata?: Record<string, any>;
  correlationId?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | LLMMessageContent[];
  name?: string;
  functionCall?: {
    name: string;
    arguments: string;
  };
}

export interface LLMMessageContent {
  type: 'text' | 'image' | 'audio';
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
}

export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface LLMResponse {
  id: string;
  content: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
  responseTime: number;
  finishReason: 'stop' | 'length' | 'function_call' | 'content_filter' | 'error';
  functionCalls?: Array<{
    name: string;
    arguments: any;
  }>;
  metadata?: Record<string, any>;
  correlationId: string;
  timestamp: Date;
}

export interface HealthCheckResult {
  provider: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  uptime: number;
  lastError?: string;
  errorRate: number;
  successRate: number;
  timestamp: Date;
}

export interface CostMetrics {
  totalCost: number;
  averageCostPerRequest: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  tokenUsage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
  period: 'hour' | 'day' | 'week' | 'month';
  timestamp: Date;
}

export abstract class UnifiedLLMAdapter extends EventEmitter {
  protected provider: LLMProvider;
  protected apiKey: string;
  protected baseUrl: string;
  protected rateLimiter: Map<string, number> = new Map();
  protected costTracker: CostMetrics[] = [];
  protected healthHistory: HealthCheckResult[] = [];

  constructor(provider: LLMProvider, apiKey: string, baseUrl?: string) {
    super();
    this.provider = provider;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || this.getDefaultBaseUrl();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Start cost tracking
    this.startCostTracking();
    
    logger.info(`🔧 Initialized ${provider.name} adapter with real API integration`);
  }

  /**
   * Abstract methods that each provider must implement
   */
  abstract generateResponse(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Streaming + multimodal entrypoints — default implementations throw a
   * NotImplementedError so callers know the capability is missing on this
   * provider. Providers that DO support these capabilities override the
   * matching method explicitly. Optional `?` on abstract members is invalid
   * in TypeScript; this concrete-default approach is the production-grade
   * substitute.
   */
  // eslint-disable-next-line require-yield
  async *generateStream(_request: LLMRequest): AsyncGenerator<Partial<LLMResponse>, void, unknown> {
    throw new Error(`Provider ${this.provider.name} does not implement streaming generation.`);
  }
  async generateEmbeddings(_texts: string[]): Promise<number[][]> {
    throw new Error(`Provider ${this.provider.name} does not implement embeddings.`);
  }
  async generateImage(_prompt: string, _options?: any): Promise<{ url: string; cost: number }> {
    throw new Error(`Provider ${this.provider.name} does not implement image generation.`);
  }
  async generateAudio(_text: string, _options?: any): Promise<{ url: string; cost: number }> {
    throw new Error(`Provider ${this.provider.name} does not implement audio generation.`);
  }
  async transcribeAudio(_audioUrl: string): Promise<{ text: string; cost: number }> {
    throw new Error(`Provider ${this.provider.name} does not implement audio transcription.`);
  }

  protected abstract getDefaultBaseUrl(): string;
  protected abstract validateApiKey(): Promise<boolean>;

  /**
   * Default health-metrics updater — providers may override for finer-grained
   * tracking. The base implementation drives the `healthHistory` array used
   * by `calculateHealthScore` / `calculateUptime`.
   */
  protected updateHealthMetrics(success: boolean, _latencyMs: number): void {
    this.healthHistory.push({
      provider: this.provider.id,
      status: success ? 'healthy' : 'unhealthy',
      responseTime: _latencyMs,
      uptime: this.calculateUptime(),
      errorRate: this.calculateErrorRate(),
      successRate: this.calculateSuccessRate(),
      timestamp: new Date(),
    } as HealthCheckResult);
    if (this.healthHistory.length > 200) this.healthHistory.shift();
    this.provider.healthScore = this.calculateHealthScore();
  }

  /**
   * Health check implementation
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    
    try {
      logger.info(`🏥 [${correlationId}] Performing health check for ${this.provider.name}...`);
      
      // Use circuit breaker for health check
      const isHealthy = await circuitBreakerManager.execute(
        `${this.provider.id}-health`,
        async () => {
          // Simple test request
          const testResponse = await this.generateResponse({
            messages: [{ role: 'user', content: 'Health check - respond with OK' }],
            maxTokens: 10,
            correlationId
          });
          
          return testResponse.content.length > 0;
        },
        // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
        async () => {
          logger.warn(`⚠️ [${correlationId}] Circuit breaker open for ${this.provider.name}`);
          return false;
        }
      );
      
      const responseTime = Date.now() - startTime;
      const result: HealthCheckResult = {
        provider: this.provider.id,
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime,
        uptime: this.calculateUptime(),
        errorRate: this.calculateErrorRate(),
        successRate: this.calculateSuccessRate(),
        timestamp: new Date()
      };
      
      this.healthHistory.push(result);
      this.provider.healthScore = this.calculateHealthScore();
      this.provider.lastHealthCheck = new Date();
      
      logger.info(`✅ [${correlationId}] Health check completed: ${this.provider.name} - ${result.status} (${responseTime}ms)`);
      this.emit('health-check-completed', result);
      
      return result;
      
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const result: HealthCheckResult = {
        provider: this.provider.id,
        status: 'unhealthy',
        responseTime,
        uptime: this.calculateUptime(),
        lastError: error instanceof Error ? error.message : String(error),
        errorRate: this.calculateErrorRate(),
        successRate: this.calculateSuccessRate(),
        timestamp: new Date()
      };
      
      this.healthHistory.push(result);
      this.provider.healthScore = 0;
      this.provider.status = 'offline';
      
      logger.error(`❌ [${correlationId}] Health check failed for ${this.provider.name}:`, error);
      this.emit('health-check-failed', result);
      
      return result;
    }
  }

  /**
   * Cost calculation and tracking
   */
  calculateCost(usage: { promptTokens: number; completionTokens: number }): number {
    const inputCost = (usage.promptTokens / 1000000) * this.provider.pricing.inputTokenCost;
    const outputCost = (usage.completionTokens / 1000000) * this.provider.pricing.outputTokenCost;
    return inputCost + outputCost;
  }

  trackCost(response: LLMResponse): void {
    const cost = this.calculateCost(response.usage);
    response.cost = cost;
    
    // Update cost metrics
    const currentMetrics = this.getCurrentCostMetrics();
    currentMetrics.totalCost += cost;
    currentMetrics.tokenUsage.totalTokens += response.usage.totalTokens;
    currentMetrics.tokenUsage.inputTokens += response.usage.promptTokens;
    currentMetrics.tokenUsage.outputTokens += response.usage.completionTokens;
    
    if (!currentMetrics.costByProvider[this.provider.id]) {
      currentMetrics.costByProvider[this.provider.id] = 0;
    }
    currentMetrics.costByProvider[this.provider.id] += cost;
    
    if (!currentMetrics.costByModel[response.model]) {
      currentMetrics.costByModel[response.model] = 0;
    }
    currentMetrics.costByModel[response.model] += cost;
    
    this.emit('cost-tracked', { provider: this.provider.id, cost, response });
  }

  /**
   * Rate limiting implementation
   */
  async checkRateLimit(): Promise<boolean> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const key = `${this.provider.id}-${Math.floor(now / windowMs)}`;
    
    const currentCount = this.rateLimiter.get(key) || 0;
    if (currentCount >= this.provider.limits.maxRequestsPerMinute) {
      logger.warn(`⚠️ Rate limit exceeded for ${this.provider.name}: ${currentCount}/${this.provider.limits.maxRequestsPerMinute}`);
      return false;
    }
    
    this.rateLimiter.set(key, currentCount + 1);
    return true;
  }

  /**
   * Get provider information
   */
  getProviderInfo(): LLMProvider {
    return { ...this.provider };
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(): CostMetrics[] {
    return [...this.costTracker];
  }

  /**
   * Get health history
   */
  getHealthHistory(): HealthCheckResult[] {
    return [...this.healthHistory];
  }

  /**
   * Private helper methods
   */
  private startHealthMonitoring(): void {
    // Perform health check every 5 minutes
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error: any) {
        logger.error(`Health monitoring error for ${this.provider.name}:`, error);
      }
    }, 5 * 60 * 1000);
  }

  private startCostTracking(): void {
    // Aggregate cost metrics every hour
    setInterval(() => {
      this.aggregateCostMetrics();
    }, 60 * 60 * 1000);
  }

  private getCurrentCostMetrics(): CostMetrics {
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    
    let current = this.costTracker.find(m => 
      m.period === 'hour' && 
      m.timestamp.getTime() === currentHour.getTime()
    );
    
    if (!current) {
      current = {
        totalCost: 0,
        averageCostPerRequest: 0,
        costByProvider: {},
        costByModel: {},
        tokenUsage: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0
        },
        period: 'hour',
        timestamp: currentHour
      };
      this.costTracker.push(current);
    }
    
    return current;
  }

  private aggregateCostMetrics(): void {
    // Keep only last 24 hours of hourly metrics
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.costTracker = this.costTracker.filter(m => m.timestamp >= cutoff);
  }

  private calculateUptime(): number {
    const recentChecks = this.healthHistory.slice(-20); // Last 20 checks
    if (recentChecks.length === 0) return 100;
    
    const healthyChecks = recentChecks.filter(c => c.status === 'healthy').length;
    return (healthyChecks / recentChecks.length) * 100;
  }

  private calculateErrorRate(): number {
    const recentChecks = this.healthHistory.slice(-20);
    if (recentChecks.length === 0) return 0;
    
    const errorChecks = recentChecks.filter(c => c.status === 'unhealthy').length;
    return (errorChecks / recentChecks.length) * 100;
  }

  private calculateSuccessRate(): number {
    return 100 - this.calculateErrorRate();
  }

  private calculateHealthScore(): number {
    const uptime = this.calculateUptime();
    const avgResponseTime = this.getAverageResponseTime();
    const errorRate = this.calculateErrorRate();
    
    // Health score based on uptime (50%), response time (30%), error rate (20%)
    const uptimeScore = uptime;
    const responseTimeScore = Math.max(0, 100 - (avgResponseTime / 100)); // Penalize slow responses
    const errorScore = 100 - errorRate;
    
    return Math.round(
      (uptimeScore * 0.5) + 
      (responseTimeScore * 0.3) + 
      (errorScore * 0.2)
    );
  }

  private getAverageResponseTime(): number {
    const recentChecks = this.healthHistory.slice(-10);
    if (recentChecks.length === 0) return 0;
    
    const totalTime = recentChecks.reduce((sum, check) => sum + check.responseTime, 0);
    return totalTime / recentChecks.length;
  }
}

export { UnifiedLLMAdapter as default };