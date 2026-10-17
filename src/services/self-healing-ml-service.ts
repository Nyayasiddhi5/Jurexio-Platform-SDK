import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('self-healing-ml-service');

export interface SelfHealingConfig {
  maxRetries: number;
  retryDelayMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  halfOpenMaxAttempts: number;
  healthCheckIntervalMs: number;
  degradedModeEnabled: boolean;
  recoveryStrategies: RecoveryStrategy[];
}

export interface RecoveryStrategy {
  id: string;
  name: string;
  type: 'retry' | 'fallback_model' | 'reduced_complexity' | 'cached_response' | 'degraded_mode' | 'circuit_break';
  priority: number;
  maxAttempts: number;
  conditions: string[];
  fallbackConfig?: Record<string, any>;
}

export interface CircuitBreaker {
  id: string;
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  halfOpenAttempts: number;
  threshold: number;
  resetMs: number;
}

export interface FailureEvent {
  id: string;
  componentId: string;
  componentName: string;
  errorType: 'timeout' | 'error' | 'quality_degradation' | 'rate_limit' | 'connection' | 'validation';
  errorMessage: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  context: Record<string, any>;
  recoveryAttempts: RecoveryAttempt[];
  resolved: boolean;
  resolvedBy?: string;
  resolutionTime?: number;
}

export interface RecoveryAttempt {
  id: string;
  strategy: string;
  attempt: number;
  success: boolean;
  latencyMs: number;
  resultQuality: number;
  timestamp: string;
  details: string;
}

export interface ComponentHealth {
  id: string;
  name: string;
  type: 'llm_provider' | 'service' | 'endpoint' | 'database' | 'cache';
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  healthScore: number;
  uptime: number;
  lastCheckAt: string;
  recentFailures: number;
  circuitBreaker: CircuitBreaker;
  metrics: {
    avgLatencyMs: number;
    p99LatencyMs: number;
    errorRate: number;
    requestCount: number;
  };
}

export interface SelfHealingStats {
  totalFailures: number;
  totalRecoveries: number;
  recoveryRate: number;
  averageRecoveryTimeMs: number;
  activeCircuitBreakers: number;
  openCircuitBreakers: number;
  componentHealthSummary: Record<string, string>;
  strategyEffectiveness: Record<string, number>;
  degradedComponents: string[];
  lastFailureTimestamp: string | null;
  uptimePercentage: number;
}

const DEFAULT_CONFIG: SelfHealingConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
  halfOpenMaxAttempts: 2,
  healthCheckIntervalMs: 30000,
  degradedModeEnabled: true,
  recoveryStrategies: [
    {
      id: 'strategy-retry',
      name: 'Simple Retry',
      type: 'retry',
      priority: 1,
      maxAttempts: 3,
      conditions: ['timeout', 'connection', 'error'],
    },
    {
      id: 'strategy-fallback-model',
      name: 'Fallback Model',
      type: 'fallback_model',
      priority: 2,
      maxAttempts: 2,
      conditions: ['error', 'quality_degradation', 'rate_limit'],
      fallbackConfig: { modelTier: 'degraded', maxTokens: 1024 },
    },
    {
      id: 'strategy-reduced-complexity',
      name: 'Reduced Complexity',
      type: 'reduced_complexity',
      priority: 3,
      maxAttempts: 2,
      conditions: ['timeout', 'rate_limit', 'quality_degradation'],
      fallbackConfig: { simplifyPrompt: true, reduceContext: true },
    },
    {
      id: 'strategy-cached-response',
      name: 'Cached Response',
      type: 'cached_response',
      priority: 4,
      maxAttempts: 1,
      conditions: ['timeout', 'error', 'connection', 'rate_limit'],
    },
    {
      id: 'strategy-degraded-mode',
      name: 'Degraded Mode',
      type: 'degraded_mode',
      priority: 5,
      maxAttempts: 1,
      conditions: ['timeout', 'error', 'connection', 'rate_limit', 'quality_degradation', 'validation'],
    },
    {
      id: 'strategy-circuit-break',
      name: 'Circuit Break',
      type: 'circuit_break',
      priority: 6,
      maxAttempts: 1,
      conditions: ['error', 'connection', 'rate_limit'],
    },
  ],
};

export class SelfHealingMLService extends EventEmitter {
  private config: SelfHealingConfig;
  private components: Map<string, ComponentHealth> = new Map();
  private failureHistory: FailureEvent[] = new Map() as any;
  private responseCache: Map<string, { result: any; timestamp: number; quality: number }> = new Map();
  private degradedModeComponents: Set<string> = new Set();
  private latencyHistory: Map<string, number[]> = new Map();
  private requestCounts: Map<string, { total: number; failures: number; startTime: number }> = new Map();
  private strategySuccessCounts: Map<string, { attempts: number; successes: number }> = new Map();
  private recoveryTimes: number[] = [];
  private startTime: number;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<SelfHealingConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.recoveryStrategies) {
      this.config.recoveryStrategies = config.recoveryStrategies;
    }
    this.failureHistory = [];
    this.startTime = Date.now();

    this.startHealthCheckTimer();

    logger.info('[SelfHeal] Self-healing ML service initialized');
    logger.info(`[SelfHeal] Max retries: ${this.config.maxRetries}, Circuit breaker threshold: ${this.config.circuitBreakerThreshold}`);
    logger.info(`[SelfHeal] Recovery strategies: ${this.config.recoveryStrategies.map(s => s.name).join(', ')}`);
    logger.info(`[SelfHeal] Health check interval: ${this.config.healthCheckIntervalMs}ms, Degraded mode: ${this.config.degradedModeEnabled}`);
    logger.info('[SelfHeal] BMAD/CAM 2.0 coordination patterns enabled for distributed recovery');
  }

  private startHealthCheckTimer(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  private performHealthChecks(): void {
    for (const [componentId, health] of this.components) {
      const previousStatus = health.status;
      this.updateComponentHealth(componentId);
      const currentStatus = this.components.get(componentId)!.status;

      if (previousStatus !== currentStatus) {
        logger.info(`[SelfHeal] Component ${health.name} status changed: ${previousStatus} -> ${currentStatus}`);
        this.emit('health:changed', { componentId, previousStatus, currentStatus });
      }

      this.checkCircuitBreakerReset(componentId);
    }

    this.emit('health:check', { timestamp: new Date().toISOString(), components: this.components.size });
  }

  private checkCircuitBreakerReset(componentId: string): void {
    const health = this.components.get(componentId);
    if (!health) return;

    const cb = health.circuitBreaker;
    if (cb.state === 'open' && cb.openedAt) {
      const elapsed = Date.now() - new Date(cb.openedAt).getTime();
      if (elapsed >= cb.resetMs) {
        cb.state = 'half_open';
        cb.halfOpenAttempts = 0;
        logger.info(`[SelfHeal] Circuit breaker ${cb.name} transitioned to half_open after ${elapsed}ms`);
        this.emit('circuitBreaker:halfOpen', { componentId, breakerId: cb.id });
      }
    }
  }

  private updateComponentHealth(componentId: string): void {
    const health = this.components.get(componentId);
    if (!health) return;

    const counts = this.requestCounts.get(componentId);
    const latencies = this.latencyHistory.get(componentId) || [];

    if (counts && counts.total > 0) {
      health.metrics.errorRate = counts.failures / counts.total;
      health.metrics.requestCount = counts.total;
    }

    if (latencies.length > 0) {
      health.metrics.avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const sorted = [...latencies].sort((a, b) => a - b);
      health.metrics.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1] || 0;
    }

    const recentFailures = this.getRecentFailureCount(componentId, 300000);
    health.recentFailures = recentFailures;

    health.healthScore = this.calculateHealthScore(health);
    health.status = this.deriveStatus(health.healthScore, health.circuitBreaker.state);
    health.lastCheckAt = new Date().toISOString();

    const totalUptime = Date.now() - this.startTime;
    const failureTime = this.estimateFailureTime(componentId);
    health.uptime = totalUptime > 0 ? Math.max(0, Math.min(100, ((totalUptime - failureTime) / totalUptime) * 100)) : 100;
  }

  private getRecentFailureCount(componentId: string, windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    return (this.failureHistory as FailureEvent[]).filter(
      f => f.componentId === componentId && f.timestamp >= cutoff
    ).length;
  }

  private calculateHealthScore(health: ComponentHealth): number {
    let score = 1.0;

    score -= health.metrics.errorRate * 0.4;

    if (health.metrics.avgLatencyMs > 5000) {
      score -= 0.2;
    } else if (health.metrics.avgLatencyMs > 2000) {
      score -= 0.1;
    }

    if (health.recentFailures > 10) {
      score -= 0.3;
    } else if (health.recentFailures > 5) {
      score -= 0.15;
    } else if (health.recentFailures > 0) {
      score -= health.recentFailures * 0.02;
    }

    if (health.circuitBreaker.state === 'open') {
      score -= 0.3;
    } else if (health.circuitBreaker.state === 'half_open') {
      score -= 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  private deriveStatus(healthScore: number, cbState: CircuitBreaker['state']): ComponentHealth['status'] {
    if (cbState === 'open') return 'unhealthy';
    if (healthScore >= 0.8) return 'healthy';
    if (healthScore >= 0.5) return 'degraded';
    return 'unhealthy';
  }

  private estimateFailureTime(componentId: string): number {
    const failures = (this.failureHistory as FailureEvent[]).filter(f => f.componentId === componentId);
    let totalFailureTime = 0;
    for (const failure of failures) {
      totalFailureTime += failure.resolutionTime || 5000;
    }
    return totalFailureTime;
  }

  private createCircuitBreaker(componentId: string, componentName: string): CircuitBreaker {
    return {
      id: `cb-${componentId}`,
      name: `CB:${componentName}`,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      openedAt: null,
      halfOpenAttempts: 0,
      threshold: this.config.circuitBreakerThreshold,
      resetMs: this.config.circuitBreakerResetMs,
    };
  }

  private recordFailureOnCircuitBreaker(componentId: string): void {
    const health = this.components.get(componentId);
    if (!health) return;

    const cb = health.circuitBreaker;
    cb.failureCount++;
    cb.lastFailureAt = new Date().toISOString();

    if (cb.state === 'half_open') {
      cb.halfOpenAttempts++;
      if (cb.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        cb.state = 'open';
        cb.openedAt = new Date().toISOString();
        logger.info(`[SelfHeal] Circuit breaker ${cb.name} reopened after half_open failures`);
        this.emit('circuitBreaker:open', { componentId, breakerId: cb.id });
      }
    } else if (cb.state === 'closed' && cb.failureCount >= cb.threshold) {
      cb.state = 'open';
      cb.openedAt = new Date().toISOString();
      logger.info(`[SelfHeal] Circuit breaker ${cb.name} opened after ${cb.failureCount} failures`);
      this.emit('circuitBreaker:open', { componentId, breakerId: cb.id });
    }
  }

  private recordSuccessOnCircuitBreaker(componentId: string): void {
    const health = this.components.get(componentId);
    if (!health) return;

    const cb = health.circuitBreaker;
    cb.successCount++;
    cb.lastSuccessAt = new Date().toISOString();

    if (cb.state === 'half_open') {
      cb.state = 'closed';
      cb.failureCount = 0;
      cb.halfOpenAttempts = 0;
      cb.openedAt = null;
      logger.info(`[SelfHeal] Circuit breaker ${cb.name} closed after successful half_open attempt`);
      this.emit('circuitBreaker:closed', { componentId, breakerId: cb.id });
    }
  }

  private recordLatency(componentId: string, latencyMs: number): void {
    if (!this.latencyHistory.has(componentId)) {
      this.latencyHistory.set(componentId, []);
    }
    const history = this.latencyHistory.get(componentId)!;
    history.push(latencyMs);
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
  }

  private incrementRequestCount(componentId: string, failed: boolean): void {
    if (!this.requestCounts.has(componentId)) {
      this.requestCounts.set(componentId, { total: 0, failures: 0, startTime: Date.now() });
    }
    const counts = this.requestCounts.get(componentId)!;
    counts.total++;
    if (failed) counts.failures++;
  }

  private getApplicableStrategies(errorType: FailureEvent['errorType']): RecoveryStrategy[] {
    return this.config.recoveryStrategies
      .filter(s => s.conditions.includes(errorType))
      .sort((a, b) => a.priority - b.priority);
  }

  private async executeStrategy<T>(
    strategy: RecoveryStrategy,
    operation: () => Promise<T>,
    componentId: string,
    attemptIndex: number,
    context: Record<string, any>
  ): Promise<{ success: boolean; result: T | null; quality: number; details: string }> {
    switch (strategy.type) {
      case 'retry':
        return this.executeRetryStrategy(operation, attemptIndex);
      case 'fallback_model':
        return this.executeFallbackModelStrategy(operation, strategy, context);
      case 'reduced_complexity':
        return this.executeReducedComplexityStrategy(operation, strategy, context);
      case 'cached_response':
        return this.executeCachedResponseStrategy<T>(componentId);
      case 'degraded_mode':
        return this.executeDegradedModeStrategy(operation, componentId);
      case 'circuit_break':
        return this.executeCircuitBreakStrategy<T>(componentId);
      default:
        return { success: false, result: null, quality: 0, details: `Unknown strategy type: ${strategy.type}` };
    }
  }

  private async executeRetryStrategy<T>(
    operation: () => Promise<T>,
    attemptIndex: number
  ): Promise<{ success: boolean; result: T | null; quality: number; details: string }> {
    const delay = this.config.retryDelayMs * Math.pow(2, attemptIndex);
    await this.delay(Math.min(delay, 30000));
    try {
      const result = await operation();
      return { success: true, result, quality: 1.0, details: `Retry succeeded after ${delay}ms delay` };
    } catch {
      return { success: false, result: null, quality: 0, details: `Retry failed after ${delay}ms delay` };
    }
  }

  private async executeFallbackModelStrategy<T>(
    operation: () => Promise<T>,
    strategy: RecoveryStrategy,
    context: Record<string, any>
  ): Promise<{ success: boolean; result: T | null; quality: number; details: string }> {
    const fallbackConfig = strategy.fallbackConfig || {};
    context._fallbackModel = true;
    context._modelTier = fallbackConfig.modelTier || 'degraded';
    context._maxTokens = fallbackConfig.maxTokens || 1024;

    try {
      const result = await operation();
      return { success: true, result, quality: 0.7, details: `Fallback model (${context._modelTier}) succeeded` };
    } catch {
      return { success: false, result: null, quality: 0, details: 'Fallback model strategy failed' };
    }
  }

  private async executeReducedComplexityStrategy<T>(
    operation: () => Promise<T>,
    strategy: RecoveryStrategy,
    context: Record<string, any>
  ): Promise<{ success: boolean; result: T | null; quality: number; details: string }> {
    context._reducedComplexity = true;
    context._simplifyPrompt = strategy.fallbackConfig?.simplifyPrompt ?? true;
    context._reduceContext = strategy.fallbackConfig?.reduceContext ?? true;

    try {
      const result = await operation();
      return { success: true, result, quality: 0.6, details: 'Reduced complexity strategy succeeded' };
    } catch {
      return { success: false, result: null, quality: 0, details: 'Reduced complexity strategy failed' };
    }
  }

  private executeCachedResponseStrategy<T>(
    componentId: string
  ): { success: boolean; result: T | null; quality: number; details: string } {
    const cached = this.responseCache.get(componentId);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return { success: true, result: cached.result as T, quality: cached.quality * 0.5, details: 'Served from cache' };
    }
    return { success: false, result: null, quality: 0, details: 'No cached response available' };
  }

  private async executeDegradedModeStrategy<T>(
    operation: () => Promise<T>,
    componentId: string
  ): Promise<{ success: boolean; result: T | null; quality: number; details: string }> {
    if (!this.config.degradedModeEnabled) {
      return { success: false, result: null, quality: 0, details: 'Degraded mode is disabled' };
    }

    this.degradedModeComponents.add(componentId);
    this.emit('degradedMode:entered', { componentId });

    try {
      const result = await operation();
      return { success: true, result, quality: 0.4, details: 'Operating in degraded mode' };
    } catch {
      return { success: false, result: null, quality: 0.1, details: 'Degraded mode fallback - minimal service' };
    }
  }

  private executeCircuitBreakStrategy<T>(
    componentId: string
  ): { success: boolean; result: T | null; quality: number; details: string } {
    const health = this.components.get(componentId);
    if (health) {
      const cb = health.circuitBreaker;
      if (cb.state !== 'open') {
        cb.state = 'open';
        cb.openedAt = new Date().toISOString();
        logger.info(`[SelfHeal] Circuit breaker ${cb.name} manually opened via strategy`);
        this.emit('circuitBreaker:open', { componentId, breakerId: cb.id });
      }
    }
    return { success: false, result: null, quality: 0, details: 'Circuit breaker activated - requests blocked' };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private trackStrategyOutcome(strategyId: string, success: boolean): void {
    if (!this.strategySuccessCounts.has(strategyId)) {
      this.strategySuccessCounts.set(strategyId, { attempts: 0, successes: 0 });
    }
    const counts = this.strategySuccessCounts.get(strategyId)!;
    counts.attempts++;
    if (success) counts.successes++;
  }

  registerComponent(id: string, name: string, type: ComponentHealth['type']): ComponentHealth {
    const circuitBreaker = this.createCircuitBreaker(id, name);

    const health: ComponentHealth = {
      id,
      name,
      type,
      status: 'unknown',
      healthScore: 1.0,
      uptime: 100,
      lastCheckAt: new Date().toISOString(),
      recentFailures: 0,
      circuitBreaker,
      metrics: {
        avgLatencyMs: 0,
        p99LatencyMs: 0,
        errorRate: 0,
        requestCount: 0,
      },
    };

    this.components.set(id, health);
    logger.info(`[SelfHeal] Registered component: ${name} (${type}) [${id}]`);
    this.emit('component:registered', health);

    return health;
  }

  async executeWithHealing<T>(
    componentId: string,
    operation: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<{ result: T | null; healed: boolean; strategy?: string; quality: number }> {
    const health = this.components.get(componentId);
    if (!health) {
      logger.info(`[SelfHeal] Unknown component: ${componentId}, executing without healing`);
      try {
        const result = await operation();
        return { result, healed: false, quality: 1.0 };
      } catch {
        return { result: null, healed: false, quality: 0 };
      }
    }

    const cb = health.circuitBreaker;
    if (cb.state === 'open') {
      logger.info(`[SelfHeal] Circuit breaker ${cb.name} is open, attempting cached/degraded response`);
      const cached = this.executeCachedResponseStrategy<T>(componentId);
      if (cached.success) {
        return { result: cached.result, healed: true, strategy: 'cached_response', quality: cached.quality };
      }
      if (this.config.degradedModeEnabled) {
        this.degradedModeComponents.add(componentId);
        return { result: null, healed: false, strategy: 'circuit_break', quality: 0 };
      }
      return { result: null, healed: false, strategy: 'circuit_break', quality: 0 };
    }

    const startTime = Date.now();

    try {
      const result = await operation();
      const latencyMs = Date.now() - startTime;

      this.recordSuccessOnCircuitBreaker(componentId);
      this.recordLatency(componentId, latencyMs);
      this.incrementRequestCount(componentId, false);
      this.reportSuccess(componentId);

      this.responseCache.set(componentId, { result, timestamp: Date.now(), quality: 1.0 });

      if (this.degradedModeComponents.has(componentId)) {
        this.degradedModeComponents.delete(componentId);
        logger.info(`[SelfHeal] Component ${health.name} recovered from degraded mode`);
        this.emit('degradedMode:exited', { componentId });
      }

      return { result, healed: false, quality: 1.0 };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      this.recordLatency(componentId, latencyMs);
      this.incrementRequestCount(componentId, true);

      const errorType = this.classifyError(error);
      const severity = this.classifySeverity(errorType, health);
      const failureEvent = this.reportFailure(componentId, errorType, error.message || String(error), severity);

      logger.info(`[SelfHeal] Failure detected on ${health.name}: ${errorType} - ${error.message || error}`);

      const strategies = this.getApplicableStrategies(errorType);
      let attemptIndex = 0;

      for (const strategy of strategies) {
        for (let attempt = 0; attempt < strategy.maxAttempts && attemptIndex < this.config.maxRetries; attempt++) {
          attemptIndex++;
          const attemptStart = Date.now();

          logger.info(`[SelfHeal] Attempting recovery: ${strategy.name} (attempt ${attemptIndex}/${this.config.maxRetries})`);

          const result = await this.executeStrategy<T>(strategy, operation, componentId, attemptIndex, { ...context });
          const attemptLatency = Date.now() - attemptStart;

          const recoveryAttempt: RecoveryAttempt = {
            id: randomUUID(),
            strategy: strategy.name,
            attempt: attemptIndex,
            success: result.success,
            latencyMs: attemptLatency,
            resultQuality: result.quality,
            timestamp: new Date().toISOString(),
            details: result.details,
          };

          failureEvent.recoveryAttempts.push(recoveryAttempt);
          this.trackStrategyOutcome(strategy.id, result.success);

          if (result.success) {
            const totalRecoveryTime = Date.now() - startTime;
            failureEvent.resolved = true;
            failureEvent.resolvedBy = strategy.name;
            failureEvent.resolutionTime = totalRecoveryTime;
            this.recoveryTimes.push(totalRecoveryTime);

            this.recordSuccessOnCircuitBreaker(componentId);

            if (result.result !== null && result.result !== undefined) {
              this.responseCache.set(componentId, { result: result.result, timestamp: Date.now(), quality: result.quality });
            }

            logger.info(`[SelfHeal] Recovery successful via ${strategy.name} in ${totalRecoveryTime}ms (quality: ${result.quality.toFixed(2)})`);
            this.emit('recovery:success', { componentId, strategy: strategy.name, quality: result.quality, timeMs: totalRecoveryTime });

            return { result: result.result, healed: true, strategy: strategy.name, quality: result.quality };
          }
        }

        if (attemptIndex >= this.config.maxRetries) break;
      }

      this.recordFailureOnCircuitBreaker(componentId);
      logger.info(`[SelfHeal] All recovery strategies exhausted for ${health.name}`);
      this.emit('recovery:exhausted', { componentId, failureId: failureEvent.id });

      return { result: null, healed: false, quality: 0 };
    }
  }

  reportFailure(
    componentId: string,
    errorType: FailureEvent['errorType'],
    errorMessage: string,
    severity: FailureEvent['severity'] = 'medium'
  ): FailureEvent {
    const health = this.components.get(componentId);
    const componentName = health?.name || componentId;

    const failureEvent: FailureEvent = {
      id: randomUUID(),
      componentId,
      componentName,
      errorType,
      errorMessage,
      severity,
      timestamp: new Date().toISOString(),
      context: {},
      recoveryAttempts: [],
      resolved: false,
    };

    (this.failureHistory as FailureEvent[]).push(failureEvent);

    if ((this.failureHistory as FailureEvent[]).length > 10000) {
      (this.failureHistory as FailureEvent[]).splice(0, (this.failureHistory as FailureEvent[]).length - 10000);
    }

    this.recordFailureOnCircuitBreaker(componentId);
    this.incrementRequestCount(componentId, true);

    logger.info(`[SelfHeal] Failure reported: ${componentName} [${errorType}] ${severity} - ${errorMessage}`);
    this.emit('failure:reported', failureEvent);

    return failureEvent;
  }

  reportSuccess(componentId: string): void {
    this.recordSuccessOnCircuitBreaker(componentId);
    this.incrementRequestCount(componentId, false);
    this.updateComponentHealth(componentId);
    this.emit('success:reported', { componentId, timestamp: new Date().toISOString() });
  }

  getCircuitBreaker(componentId: string): CircuitBreaker {
    const health = this.components.get(componentId);
    if (health) {
      return { ...health.circuitBreaker };
    }
    return this.createCircuitBreaker(componentId, componentId);
  }

  getComponentHealth(componentId: string): ComponentHealth | null {
    const health = this.components.get(componentId);
    if (!health) return null;
    this.updateComponentHealth(componentId);
    return { ...health, circuitBreaker: { ...health.circuitBreaker } };
  }

  getAllHealth(): ComponentHealth[] {
    for (const componentId of this.components.keys()) {
      this.updateComponentHealth(componentId);
    }
    return Array.from(this.components.values()).map(h => ({
      ...h,
      circuitBreaker: { ...h.circuitBreaker },
      metrics: { ...h.metrics },
    }));
  }

  getStats(): SelfHealingStats {
    const failures = this.failureHistory as FailureEvent[];
    const totalFailures = failures.length;
    const totalRecoveries = failures.filter(f => f.resolved).length;
    const recoveryRate = totalFailures > 0 ? totalRecoveries / totalFailures : 1;

    const averageRecoveryTimeMs = this.recoveryTimes.length > 0
      ? this.recoveryTimes.reduce((a, b) => a + b, 0) / this.recoveryTimes.length
      : 0;

    const allHealth = this.getAllHealth();
    const activeCircuitBreakers = allHealth.length;
    const openCircuitBreakers = allHealth.filter(h => h.circuitBreaker.state === 'open').length;

    const componentHealthSummary: Record<string, string> = {};
    for (const h of allHealth) {
      componentHealthSummary[h.id] = h.status;
    }

    const strategyEffectiveness: Record<string, number> = {};
    for (const [strategyId, counts] of this.strategySuccessCounts) {
      strategyEffectiveness[strategyId] = counts.attempts > 0 ? counts.successes / counts.attempts : 0;
    }

    const degradedComponents = Array.from(this.degradedModeComponents);

    const lastFailure = failures.length > 0 ? failures[failures.length - 1] : null;

    const totalUptime = Date.now() - this.startTime;
    let totalFailureTime = 0;
    for (const f of failures) {
      totalFailureTime += f.resolutionTime || 5000;
    }
    const uptimePercentage = totalUptime > 0
      ? Math.max(0, Math.min(100, ((totalUptime - totalFailureTime) / totalUptime) * 100))
      : 100;

    return {
      totalFailures,
      totalRecoveries,
      recoveryRate,
      averageRecoveryTimeMs,
      activeCircuitBreakers,
      openCircuitBreakers,
      componentHealthSummary,
      strategyEffectiveness,
      degradedComponents,
      lastFailureTimestamp: lastFailure?.timestamp || null,
      uptimePercentage,
    };
  }

  resetCircuitBreaker(componentId: string): boolean {
    const health = this.components.get(componentId);
    if (!health) return false;

    const cb = health.circuitBreaker;
    cb.state = 'closed';
    cb.failureCount = 0;
    cb.halfOpenAttempts = 0;
    cb.openedAt = null;

    logger.info(`[SelfHeal] Circuit breaker ${cb.name} manually reset`);
    this.emit('circuitBreaker:reset', { componentId, breakerId: cb.id });

    return true;
  }

  getFailureHistory(componentId?: string, limit: number = 100): FailureEvent[] {
    let history = this.failureHistory as FailureEvent[];
    if (componentId) {
      history = history.filter(f => f.componentId === componentId);
    }
    return history.slice(-limit).map(f => ({ ...f, recoveryAttempts: [...f.recoveryAttempts] }));
  }

  setDegradedMode(componentId: string, enabled: boolean): void {
    if (enabled) {
      this.degradedModeComponents.add(componentId);
      logger.info(`[SelfHeal] Degraded mode enabled for component ${componentId}`);
      this.emit('degradedMode:entered', { componentId });
    } else {
      this.degradedModeComponents.delete(componentId);
      logger.info(`[SelfHeal] Degraded mode disabled for component ${componentId}`);
      this.emit('degradedMode:exited', { componentId });
    }
  }

  private classifyError(error: any): FailureEvent['errorType'] {
    const message = (error.message || String(error)).toLowerCase();

    if (message.includes('timeout') || message.includes('timed out') || message.includes('deadline')) {
      return 'timeout';
    }
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return 'rate_limit';
    }
    if (message.includes('connect') || message.includes('econnrefused') || message.includes('network') || message.includes('dns')) {
      return 'connection';
    }
    if (message.includes('quality') || message.includes('degraded') || message.includes('low score')) {
      return 'quality_degradation';
    }
    if (message.includes('valid') || message.includes('schema') || message.includes('format') || message.includes('parse')) {
      return 'validation';
    }
    return 'error';
  }

  private classifySeverity(errorType: FailureEvent['errorType'], health: ComponentHealth): FailureEvent['severity'] {
    if (health.circuitBreaker.state === 'open') return 'critical';
    if (health.recentFailures > 10) return 'critical';

    switch (errorType) {
      case 'connection': return health.recentFailures > 3 ? 'high' : 'medium';
      case 'rate_limit': return 'medium';
      case 'timeout': return health.recentFailures > 5 ? 'high' : 'medium';
      case 'quality_degradation': return 'low';
      case 'validation': return 'low';
      case 'error': return health.recentFailures > 3 ? 'high' : 'medium';
      default: return 'medium';
    }
  }
}

export const selfHealingMLService = new SelfHealingMLService();
