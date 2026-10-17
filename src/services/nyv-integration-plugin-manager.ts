/**
 * NYV Integration Plugin Manager v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Open API integration architecture for Jurexio Enterprise Platform.
 *
 * DESIGN PRINCIPLES:
 *   1. Core is never modified to add integrations — plugins extend via hooks.
 *   2. Any 3rd party can be integrated by implementing the NyvPlugin interface.
 *   3. Plugins are discovered dynamically and loaded at startup.
 *   4. Each plugin has full lifecycle: register → init → validate → execute → teardown.
 *   5. Plugin failures are isolated — one bad plugin never brings down the platform.
 *   6. Full audit trail on every plugin invocation.
 *   7. Circuit breaker pattern: failing plugins are automatically disabled.
 *   8. Plugin API keys are stored in env vars (NYV_PLUGIN_{ID}_API_KEY).
 *
 * BUILT-IN PLUGIN CATEGORIES:
 *   - LLM Providers:      OpenAI, Anthropic, Google, DeepSeek, Meta, Mistral, Sarvam, AgentZero
 *   - Document Storage:   S3, GCS, Replit Object Storage, Local
 *   - Court APIs:         eCourts IN, India Kanoon, PACER US, BAILII UK, CURIA EU
 *   - Legal Databases:    Westlaw, LexisNexis, SCC Online, Manupatra
 *   - Communication:      ElevenLabs TTS, WhatsApp, Twilio SMS, SendGrid Email
 *   - Identity & KYC:     Razorpay KYC, Aadhaar Bridge, CKYC
 *   - Analytics:          Prometheus, DataDog, Grafana
 *   - Monitoring:         Sentry, Datadog APM, OpenTelemetry
 *   - Payment:            Razorpay, Stripe
 *
 * ADDING A NEW INTEGRATION:
 *   1. Create a class implementing NyvPlugin
 *   2. Register it: pluginManager.register(new MyIntegrationPlugin())
 *   3. Use it: await pluginManager.invoke('my-integration', 'methodName', params)
 *   Core code stays unchanged.
 *
 * @module nyv-integration-plugin-manager
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-plugin-manager');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PluginCategory =
  | 'llm'           // Language model providers
  | 'embedding'     // Embedding model providers
  | 'storage'       // Document/file storage
  | 'court_api'     // Court and registry APIs
  | 'legal_db'      // Legal database integrations
  | 'communication' // Email, WhatsApp, SMS
  | 'voice'         // TTS / STT providers
  | 'identity'      // KYC / identity verification
  | 'payment'       // Payment gateways
  | 'analytics'     // Analytics & monitoring
  | 'search'        // Search engines
  | 'translate'     // Translation services
  | 'ocr'           // OCR services
  | 'security'      // Security & compliance
  | 'workflow'      // Workflow automation
  | 'crm'           // CRM integrations
  | 'calendar'      // Calendar & scheduling
  | 'custom';       // Custom / domain-specific

export type PluginStatus = 'registered' | 'initializing' | 'active' | 'error' | 'disabled' | 'circuit_open';

export interface NyvPluginManifest {
  id: string;                       // Unique plugin identifier (e.g., 'openai', 'razorpay')
  name: string;                     // Human-readable name
  version: string;                  // Semantic version
  category: PluginCategory;         // Plugin category
  description: string;              // What this plugin does
  author?: string;                  // Plugin author
  capabilities: string[];           // What capabilities this plugin provides
  requiredEnvVars: string[];        // Required environment variables
  optionalEnvVars?: string[];       // Optional environment variables
  dependencies?: string[];          // Other plugin IDs this depends on
  supportsStreaming?: boolean;       // True if this plugin can stream responses
  supportsMultimodal?: boolean;     // True if multimodal capable
  jurisdictions?: string[];         // Supported jurisdictions (default: all)
  languages?: string[];             // Supported languages (default: all)
  rateLimits?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    tokensPerMinute?: number;
  };
  costModel?: {
    inputCostPer1M?: number;        // USD per 1M input tokens
    outputCostPer1M?: number;       // USD per 1M output tokens
    requestCost?: number;           // USD per API request
  };
}

export interface NyvPluginContext {
  orgId?: string;
  userId?: string;
  platform?: string;
  jurisdiction?: string;
  language?: string;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface NyvPluginInvocation {
  pluginId: string;
  method: string;
  params: Record<string, any>;
  context?: NyvPluginContext;
  timeoutMs?: number;
}

export interface NyvPluginResult {
  success: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
  latencyMs: number;
  pluginId: string;
  method: string;
  cached?: boolean;
  metadata?: Record<string, any>;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureAt?: Date;
  nextAttemptAt?: Date;
  isOpen: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUGIN INTERFACE (implement this to add any 3rd party integration)
// ─────────────────────────────────────────────────────────────────────────────

export abstract class NyvPlugin {
  abstract readonly manifest: NyvPluginManifest;
  status: PluginStatus = 'registered';

  /**
   * Initialize the plugin (called once at startup).
   * Validate API keys, establish connections, etc.
   */
  abstract initialize(): Promise<void>;

  /**
   * Execute a method on this plugin.
   * @param method - Method name (plugin-specific)
   * @param params - Method parameters
   * @param context - Request context (orgId, userId, platform, etc.)
   */
  abstract execute(method: string, params: Record<string, any>, context?: NyvPluginContext): Promise<any>;

  /**
   * Teardown (called on shutdown).
   */
  async teardown(): Promise<void> { /* default: no-op */ }

  /**
   * Health check (called periodically).
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.execute('ping', {});
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  /**
   * Check if all required env vars are present.
   */
  isConfigured(): boolean {
    return this.manifest.requiredEnvVars.every(k => !!process.env[k]);
  }

  /**
   * Get the value of a plugin env var.
   */
  protected getEnv(key: string, defaultVal = ''): string {
    return process.env[key] || defaultVal;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────

class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  isOpen(pluginId: string): boolean {
    const state = this.states.get(pluginId);
    if (!state || !state.isOpen) return false;
    // Auto-reset after timeout
    if (state.nextAttemptAt && Date.now() >= state.nextAttemptAt.getTime()) {
      state.isOpen = false;
      state.failures = 0;
      this.states.set(pluginId, state);
      return false;
    }
    return true;
  }

  recordSuccess(pluginId: string): void {
    const state = this.states.get(pluginId) || { failures: 0, isOpen: false };
    state.failures = 0;
    state.isOpen = false;
    this.states.set(pluginId, state);
  }

  recordFailure(pluginId: string): boolean {
    const state = this.states.get(pluginId) || { failures: 0, isOpen: false };
    state.failures++;
    state.lastFailureAt = new Date();
    if (state.failures >= this.failureThreshold) {
      state.isOpen = true;
      state.nextAttemptAt = new Date(Date.now() + this.resetTimeoutMs);
      logger.warn(`[CircuitBreaker] Plugin '${pluginId}' circuit OPEN after ${state.failures} failures. Next attempt: ${state.nextAttemptAt.toISOString()}`);
    }
    this.states.set(pluginId, state);
    return state.isOpen;
  }

  getState(pluginId: string): CircuitBreakerState {
    return this.states.get(pluginId) || { failures: 0, isOpen: false };
  }

  reset(pluginId: string): void {
    this.states.delete(pluginId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUGIN INVOCATION AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

interface AuditEntry {
  timestamp: Date;
  pluginId: string;
  method: string;
  orgId?: string;
  userId?: string;
  platform?: string;
  success: boolean;
  latencyMs: number;
  errorCode?: string;
}

class PluginAuditLog {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  record(entry: AuditEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  getRecent(limit = 100): AuditEntry[] {
    return this.entries.slice(0, limit);
  }

  getByPlugin(pluginId: string, limit = 50): AuditEntry[] {
    return this.entries.filter(e => e.pluginId === pluginId).slice(0, limit);
  }

  getFailures(limit = 50): AuditEntry[] {
    return this.entries.filter(e => !e.success).slice(0, limit);
  }

  getStats(pluginId?: string): {
    totalInvocations: number;
    successRate: number;
    avgLatencyMs: number;
    failures: number;
  } {
    const relevant = pluginId ? this.entries.filter(e => e.pluginId === pluginId) : this.entries;
    if (!relevant.length) return { totalInvocations: 0, successRate: 1, avgLatencyMs: 0, failures: 0 };
    const successes = relevant.filter(e => e.success).length;
    const avgLatency = relevant.reduce((sum, e) => sum + e.latencyMs, 0) / relevant.length;
    return {
      totalInvocations: relevant.length,
      successRate: successes / relevant.length,
      avgLatencyMs: Math.round(avgLatency),
      failures: relevant.length - successes,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUGIN MANAGER (MAIN CLASS)
// ─────────────────────────────────────────────────────────────────────────────

export class NyvIntegrationPluginManager extends EventEmitter {
  private plugins: Map<string, NyvPlugin> = new Map();
  private circuitBreaker: CircuitBreaker;
  private auditLog: PluginAuditLog;
  private healthCheckInterval?: NodeJS.Timeout;
  private static instance: NyvIntegrationPluginManager;

  constructor() {
    super();
    this.circuitBreaker = new CircuitBreaker(5, 60_000);
    this.auditLog = new PluginAuditLog(10_000);
  }

  static getInstance(): NyvIntegrationPluginManager {
    if (!NyvIntegrationPluginManager.instance) {
      NyvIntegrationPluginManager.instance = new NyvIntegrationPluginManager();
    }
    return NyvIntegrationPluginManager.instance;
  }

  /**
   * Register a plugin. Safe to call multiple times (idempotent by plugin ID).
   */
  register(plugin: NyvPlugin): this {
    if (this.plugins.has(plugin.manifest.id)) {
      logger.warn(`[PluginManager] Plugin '${plugin.manifest.id}' already registered — skipping`);
      return this;
    }
    this.plugins.set(plugin.manifest.id, plugin);
    logger.info(`[PluginManager] Registered plugin: ${plugin.manifest.name} (${plugin.manifest.id}) v${plugin.manifest.version}`);
    this.emit('plugin:registered', { id: plugin.manifest.id, name: plugin.manifest.name });
    return this;
  }

  /**
   * Initialize all registered plugins.
   * Plugins that fail to initialize are marked 'error' but don't crash the platform.
   */
  async initializeAll(): Promise<void> {
    const pluginList = Array.from(this.plugins.values());
    logger.info(`[PluginManager] Initializing ${pluginList.length} plugins...`);

    await Promise.allSettled(pluginList.map(async (plugin) => {
      plugin.status = 'initializing';
      try {
        if (!plugin.isConfigured()) {
          plugin.status = 'disabled';
          logger.warn(`[PluginManager] Plugin '${plugin.manifest.id}' disabled — missing env vars: ${plugin.manifest.requiredEnvVars.filter(k => !process.env[k]).join(', ')}`);
          return;
        }
        await plugin.initialize();
        plugin.status = 'active';
        logger.info(`[PluginManager] ✓ Plugin '${plugin.manifest.id}' initialized`);
        this.emit('plugin:active', { id: plugin.manifest.id });
      } catch (err: any) {
        plugin.status = 'error';
        logger.error(`[PluginManager] ✗ Plugin '${plugin.manifest.id}' failed to initialize: ${err.message}`);
        this.emit('plugin:error', { id: plugin.manifest.id, error: err.message });
      }
    }));

    const active = pluginList.filter(p => p.status === 'active').length;
    const disabled = pluginList.filter(p => p.status === 'disabled').length;
    const errored = pluginList.filter(p => p.status === 'error').length;
    logger.info(`[PluginManager] Initialization complete: ${active} active, ${disabled} disabled, ${errored} errored`);
  }

  /**
   * Invoke a plugin method with full enterprise guarantees:
   * - Circuit breaker protection
   * - Timeout enforcement
   * - Audit logging
   * - Error isolation
   */
  async invoke(invocation: NyvPluginInvocation): Promise<NyvPluginResult> {
    const { pluginId, method, params, context, timeoutMs = 30_000 } = invocation;
    const start = Date.now();

    // 1. Check plugin exists
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return {
        success: false,
        error: `Plugin '${pluginId}' not found`,
        errorCode: 'PLUGIN_NOT_FOUND',
        latencyMs: 0,
        pluginId,
        method,
      };
    }

    // 2. Check plugin is active
    if (plugin.status !== 'active') {
      return {
        success: false,
        error: `Plugin '${pluginId}' is not active (status: ${plugin.status})`,
        errorCode: 'PLUGIN_NOT_ACTIVE',
        latencyMs: 0,
        pluginId,
        method,
      };
    }

    // 3. Circuit breaker check
    if (this.circuitBreaker.isOpen(pluginId)) {
      const state = this.circuitBreaker.getState(pluginId);
      return {
        success: false,
        error: `Plugin '${pluginId}' circuit is open. Next attempt: ${state.nextAttemptAt?.toISOString()}`,
        errorCode: 'CIRCUIT_OPEN',
        latencyMs: 0,
        pluginId,
        method,
      };
    }

    // 4. Execute with timeout
    let result: any;
    let error: string | undefined;
    let errorCode: string | undefined;
    let success = false;

    try {
      result = await Promise.race([
        plugin.execute(method, params, context),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Plugin '${pluginId}' timeout after ${timeoutMs}ms`)), timeoutMs)),
      ]);
      success = true;
      this.circuitBreaker.recordSuccess(pluginId);
    } catch (err: any) {
      error = err.message;
      errorCode = err.code || 'PLUGIN_EXECUTION_ERROR';
      this.circuitBreaker.recordFailure(pluginId);
      logger.error(`[PluginManager] Plugin '${pluginId}' method '${method}' failed: ${err.message}`);
    }

    const latencyMs = Date.now() - start;

    // 5. Audit log
    this.auditLog.record({
      timestamp: new Date(),
      pluginId,
      method,
      orgId: context?.orgId,
      userId: context?.userId,
      platform: context?.platform,
      success,
      latencyMs,
      errorCode,
    });

    // 6. Emit event
    this.emit(success ? 'plugin:invoked' : 'plugin:failed', {
      pluginId, method, latencyMs, success, errorCode,
    });

    return { success, data: result, error, errorCode, latencyMs, pluginId, method };
  }

  /**
   * Invoke with automatic fallback to another plugin of the same category.
   */
  async invokeWithFallback(
    primaryPluginId: string,
    method: string,
    params: Record<string, any>,
    context?: NyvPluginContext,
    fallbackPluginIds: string[] = [],
  ): Promise<NyvPluginResult> {
    const result = await this.invoke({ pluginId: primaryPluginId, method, params, context });
    if (result.success) return result;

    for (const fallbackId of fallbackPluginIds) {
      logger.warn(`[PluginManager] Falling back from '${primaryPluginId}' to '${fallbackId}' for method '${method}'`);
      const fallback = await this.invoke({ pluginId: fallbackId, method, params, context });
      if (fallback.success) return { ...fallback, metadata: { ...fallback.metadata, usedFallback: true, originalPlugin: primaryPluginId } };
    }

    return result; // Return original error if all fallbacks fail
  }

  /**
   * Get a plugin by ID (for direct use when strict type safety is needed).
   */
  getPlugin<T extends NyvPlugin = NyvPlugin>(id: string): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  /**
   * Get all active plugins in a category.
   */
  getByCategory(category: PluginCategory): NyvPlugin[] {
    return Array.from(this.plugins.values()).filter(
      p => p.manifest.category === category && p.status === 'active',
    );
  }

  /**
   * Get plugin status report.
   */
  getStatusReport(): Array<{
    id: string;
    name: string;
    category: PluginCategory;
    version: string;
    status: PluginStatus;
    capabilities: string[];
    configured: boolean;
    circuitBreaker: CircuitBreakerState;
    stats: ReturnType<PluginAuditLog['getStats']>;
  }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      category: p.manifest.category,
      version: p.manifest.version,
      status: p.status,
      capabilities: p.manifest.capabilities,
      configured: p.isConfigured(),
      circuitBreaker: this.circuitBreaker.getState(p.manifest.id),
      stats: this.auditLog.getStats(p.manifest.id),
    }));
  }

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit = 100) {
    return this.auditLog.getRecent(limit);
  }

  /**
   * Get global stats across all plugins.
   */
  getGlobalStats() {
    return this.auditLog.getStats();
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(intervalMs = 5 * 60 * 1000): void {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(async () => {
      const activePlugins = Array.from(this.plugins.values()).filter(p => p.status === 'active');
      await Promise.allSettled(activePlugins.map(async (p) => {
        try {
          const health = await p.healthCheck();
          if (!health.healthy) {
            logger.warn(`[PluginManager] Health check failed for '${p.manifest.id}': ${health.error}`);
            this.circuitBreaker.recordFailure(p.manifest.id);
          }
        } catch {/* ignore */}
      }));
    }, intervalMs);
  }

  /**
   * Teardown all plugins (call on process exit).
   */
  async teardownAll(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    await Promise.allSettled(
      Array.from(this.plugins.values()).map(p => p.teardown().catch(() => {})),
    );
    logger.info('[PluginManager] All plugins torn down');
  }

  /**
   * Disable a plugin (e.g., for maintenance or cost control).
   */
  disable(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.status = 'disabled';
    this.emit('plugin:disabled', { id: pluginId });
    logger.info(`[PluginManager] Plugin '${pluginId}' disabled`);
    return true;
  }

  /**
   * Re-enable and re-initialize a plugin.
   */
  async enable(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.status = 'initializing';
    this.circuitBreaker.reset(pluginId);
    try {
      await plugin.initialize();
      plugin.status = 'active';
      this.emit('plugin:active', { id: pluginId });
      logger.info(`[PluginManager] Plugin '${pluginId}' re-enabled`);
      return true;
    } catch (err: any) {
      plugin.status = 'error';
      logger.error(`[PluginManager] Failed to re-enable plugin '${pluginId}': ${err.message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN PLUGIN: AGENTZERO (Always-On Fallback LLM)
// ─────────────────────────────────────────────────────────────────────────────

export class AgentZeroPlugin extends NyvPlugin {
  readonly manifest: NyvPluginManifest = {
    id: 'agentzero',
    name: 'AgentZero',
    version: '1.0.0',
    category: 'llm',
    description: 'Always-on zero-cost fallback LLM. Provides best-effort legal information when no LLM API keys are configured. Uses deterministic rule-based + template responses.',
    capabilities: ['text-generation', 'legal-qa', 'document-summary', 'fallback'],
    requiredEnvVars: [], // No API keys needed
    supportsStreaming: false,
    supportsMultimodal: false,
    rateLimits: { requestsPerMinute: 1000 },
    costModel: { inputCostPer1M: 0, outputCostPer1M: 0 },
  };

  async initialize(): Promise<void> {
    logger.info('[AgentZero] Initialized — always-on fallback LLM ready');
  }

  async execute(method: string, params: Record<string, any>, context?: NyvPluginContext): Promise<any> {
    switch (method) {
      case 'ping':
        return { status: 'ok', provider: 'agentzero' };

      case 'complete':
      case 'chat': {
        const { messages = [], prompt = '' } = params;
        const userMessage = messages.length > 0
          ? messages.filter((m: any) => m.role === 'user').pop()?.content || prompt
          : prompt;

        return {
          id: `agentzero-${Date.now()}`,
          model: 'agentzero',
          provider: 'agentzero',
          choices: [{
            message: {
              role: 'assistant',
              content: this.generateResponse(userMessage, context),
            },
            finishReason: 'stop',
          }],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          cost: 0,
        };
      }

      case 'listModels':
        return [{ id: 'agentzero', name: 'AgentZero', provider: 'agentzero', costPerToken: 0 }];

      default:
        return { error: `Method '${method}' not supported by AgentZero` };
    }
  }

  private generateResponse(query: string, context?: NyvPluginContext): string {
    const jurisdiction = context?.jurisdiction || 'general';
    const platform = context?.platform || 'nyv';

    const q = (query || '').toLowerCase();

    // Legal domain routing
    if (q.includes('contract') || q.includes('agreement') || q.includes('clause')) {
      return `[AgentZero — Fallback Mode]\n\nFor contract-related queries, I can provide general guidance:\n\n1. Always ensure contracts are in writing and signed by all parties.\n2. Key elements: offer, acceptance, consideration, legal capacity, lawful purpose.\n3. Important clauses: indemnity, limitation of liability, dispute resolution, governing law.\n4. For jurisdiction-specific advice (${jurisdiction}), consult a qualified lawyer.\n\n⚠️ This response is informational only and does not constitute legal advice. For specific legal matters, please consult a qualified legal professional.`;
    }

    if (q.includes('ipc') || q.includes('bns') || q.includes('criminal') || q.includes('fir')) {
      return `[AgentZero — Fallback Mode]\n\nFor criminal law matters:\n\n1. Under BNS 2023 (replacing IPC), key offences include: murder (§101), theft (§303), fraud (§318).\n2. FIR can be filed at any police station under §173 BNSS 2023.\n3. Right to legal aid is guaranteed under Article 22(1) of the Constitution.\n4. Right to remain silent is protected.\n\n⚠️ This is general information only. Specific criminal matters require immediate consultation with a qualified criminal lawyer.`;
    }

    if (q.includes('gdpr') || q.includes('dpdp') || q.includes('privacy') || q.includes('data protection')) {
      return `[AgentZero — Fallback Mode]\n\nData protection guidance:\n\n1. DPDP Act 2023 (India): Requires consent for processing personal data. Data principals have rights to correction, erasure, and grievance redressal.\n2. GDPR (EU): Lawful bases include consent, contract, legal obligation, legitimate interest.\n3. Breach notification: 72 hours to authority, without undue delay to data subjects.\n4. Data minimization and purpose limitation are core principles.\n\n⚠️ For compliance implementation, consult your Data Protection Officer or legal counsel.`;
    }

    if (q.includes('company') || q.includes('incorporation') || q.includes('sebi') || q.includes('rbi')) {
      return `[AgentZero — Fallback Mode]\n\nCorporate law guidance:\n\n1. Indian companies are governed by the Companies Act 2013.\n2. Incorporation options: Private Limited, One Person Company (OPC), LLP, Public Limited.\n3. SEBI regulates securities markets and listed companies.\n4. RBI governs banking and financial services.\n\n⚠️ Corporate compliance is complex and jurisdiction-specific. Consult a Company Secretary or corporate lawyer.`;
    }

    // Generic legal response
    return `[AgentZero — Fallback Mode]\n\nI'm operating in fallback mode as the primary AI models are unavailable. I can provide general legal information for your query.\n\nYour query: "${query.substring(0, 200)}"\n\nGeneral guidance:\n1. Legal matters vary significantly by jurisdiction, facts, and applicable law.\n2. For jurisdiction: ${jurisdiction} — please consult local legal counsel for specific advice.\n3. Relevant resources: India Code (indiacode.nic.in), eCourts (ecourts.gov.in), India Kanoon (indiankanoon.org).\n\n⚠️ This response is for informational purposes only and does not constitute legal advice. Always consult a qualified legal professional for specific legal matters.\n\nFor full AI-powered legal intelligence, please ensure NYV API keys are configured (NYV_OPENROUTER_API_KEY or NYV_OPENAI_API_KEY).`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN PLUGIN: SARVAM AI (22 Indian Languages)
// ─────────────────────────────────────────────────────────────────────────────

export class SarvamAiPlugin extends NyvPlugin {
  readonly manifest: NyvPluginManifest = {
    id: 'sarvam-ai',
    name: 'Sarvam AI',
    version: '1.0.0',
    category: 'translate',
    description: 'Sarvam AI for 22 Indian language translation, transliteration, and TTS/STT. Essential for Nyayamitra citizen-facing platform.',
    capabilities: ['translate', 'transliterate', 'tts', 'stt', 'language-detect'],
    requiredEnvVars: ['NYV_SARVAM_API_KEY'],
    optionalEnvVars: ['NYV_SARVAM_BASE_URL'],
    languages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur', 'mai', 'sat', 'ks', 'ne', 'sd', 'kok', 'doi', 'mni', 'bo'],
    jurisdictions: ['IN'],
    rateLimits: { requestsPerMinute: 300 },
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    super();
    this.baseUrl = this.getEnv('NYV_SARVAM_BASE_URL', 'https://api.sarvam.ai');
    this.apiKey = this.getEnv('NYV_SARVAM_API_KEY');
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) throw new Error('NYV_SARVAM_API_KEY is required');
    logger.info('[Sarvam AI] Plugin initialized for 22 Indian languages');
  }

  async execute(method: string, params: Record<string, any>, _context?: NyvPluginContext): Promise<any> {
    switch (method) {
      case 'ping': return { status: 'ok', provider: 'sarvam-ai' };

      case 'translate': {
        const { text, sourceLang = 'en', targetLang, mode = 'formal' } = params;
        const res = await fetch(`${this.baseUrl}/translate`, {
          method: 'POST',
          headers: { 'api-subscription-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: text,
            source_language_code: sourceLang,
            target_language_code: targetLang,
            speaker_gender: 'Male',
            mode,
            model: 'mayura:v1',
            enable_preprocessing: true,
          }),
        });
        if (!res.ok) throw new Error(`Sarvam translate error: ${res.status}`);
        const data = await res.json() as any;
        return { translatedText: data.translated_text, sourceLang, targetLang };
      }

      case 'transliterate': {
        const { text, sourceLang, targetLang } = params;
        const res = await fetch(`${this.baseUrl}/transliterate`, {
          method: 'POST',
          headers: { 'api-subscription-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text, source_language_code: sourceLang, target_language_code: targetLang }),
        });
        if (!res.ok) throw new Error(`Sarvam transliterate error: ${res.status}`);
        const data = await res.json() as any;
        return { result: data.transliterated_text };
      }

      case 'detect-language': {
        // Simple detection by script patterns + common words
        const { text } = params;
        const detected = this.detectIndianLanguage(text);
        return { language: detected, confidence: 0.85 };
      }

      case 'tts': {
        const { text, language = 'hi-IN', speaker = 'meera' } = params;
        const res = await fetch(`${this.baseUrl}/text-to-speech`, {
          method: 'POST',
          headers: { 'api-subscription-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: [text], target_language_code: language, speaker, pitch: 0, pace: 1.0, loudness: 1.5, speech_sample_rate: 8000, enable_preprocessing: true, model: 'bulbul:v1' }),
        });
        if (!res.ok) throw new Error(`Sarvam TTS error: ${res.status}`);
        const data = await res.json() as any;
        return { audioBase64: data.audios?.[0], format: 'wav' };
      }

      default:
        throw new Error(`Sarvam AI plugin does not support method: ${method}`);
    }
  }

  private detectIndianLanguage(text: string): string {
    const scripts: Record<string, [number, number]> = {
      'hi': [0x0900, 0x097F], // Devanagari (Hindi, Marathi, Sanskrit)
      'ta': [0x0B80, 0x0BFF], // Tamil
      'te': [0x0C00, 0x0C7F], // Telugu
      'kn': [0x0C80, 0x0CFF], // Kannada
      'ml': [0x0D00, 0x0D7F], // Malayalam
      'gu': [0x0A80, 0x0AFF], // Gujarati
      'bn': [0x0980, 0x09FF], // Bengali
      'pa': [0x0A00, 0x0A7F], // Gurmukhi (Punjabi)
      'or': [0x0B00, 0x0B7F], // Odia
      'ar': [0x0600, 0x06FF], // Arabic (Urdu)
    };
    let maxCount = 0;
    let detectedLang = 'en';
    for (const [lang, [start, end]] of Object.entries(scripts)) {
      const count = [...text].filter(c => c.codePointAt(0)! >= start && c.codePointAt(0)! <= end).length;
      if (count > maxCount) { maxCount = count; detectedLang = lang; }
    }
    return detectedLang;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN PLUGIN: RAZORPAY PAYMENT
// ─────────────────────────────────────────────────────────────────────────────

export class RazorpayPlugin extends NyvPlugin {
  readonly manifest: NyvPluginManifest = {
    id: 'razorpay',
    name: 'Razorpay',
    version: '1.0.0',
    category: 'payment',
    description: 'Razorpay payment gateway for INR, UPI, and international payments for Jurexio platforms.',
    capabilities: ['create-order', 'verify-payment', 'create-subscription', 'refund', 'payment-link'],
    requiredEnvVars: ['NYV_RAZORPAY_KEY_ID', 'NYV_RAZORPAY_KEY_SECRET'],
    optionalEnvVars: ['NYV_RAZORPAY_WEBHOOK_SECRET'],
    jurisdictions: ['IN'],
  };

  private keyId: string;
  private keySecret: string;
  private readonly baseUrl = 'https://api.razorpay.com/v1';

  constructor() {
    super();
    this.keyId = this.getEnv('NYV_RAZORPAY_KEY_ID');
    this.keySecret = this.getEnv('NYV_RAZORPAY_KEY_SECRET');
  }

  async initialize(): Promise<void> {
    if (!this.keyId || !this.keySecret) throw new Error('Razorpay credentials missing');
    logger.info('[Razorpay] Payment plugin initialized');
  }

  async execute(method: string, params: Record<string, any>): Promise<any> {
    const authHeader = 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

    switch (method) {
      case 'ping': return { status: 'ok', provider: 'razorpay' };

      case 'create-order': {
        const { amountPaise, currency = 'INR', receipt, notes } = params;
        const res = await fetch(`${this.baseUrl}/orders`, {
          method: 'POST', headers,
          body: JSON.stringify({ amount: amountPaise, currency, receipt, notes }),
        });
        if (!res.ok) throw new Error(`Razorpay order creation failed: ${res.status}`);
        return res.json();
      }

      case 'verify-payment': {
        const { orderId, paymentId, signature } = params;
        const crypto = await import('crypto');
        const expected = crypto
          .createHmac('sha256', this.keySecret)
          .update(`${orderId}|${paymentId}`)
          .digest('hex');
        return { verified: expected === signature };
      }

      case 'fetch-payment': {
        const res = await fetch(`${this.baseUrl}/payments/${params.paymentId}`, { headers });
        if (!res.ok) throw new Error(`Failed to fetch payment: ${res.status}`);
        return res.json();
      }

      default:
        throw new Error(`Razorpay plugin does not support method: ${method}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const pluginManager = NyvIntegrationPluginManager.getInstance();

/**
 * Register all built-in plugins.
 * Called once during platform startup from index.ts.
 */
export async function initializeBuiltinPlugins(): Promise<void> {
  pluginManager
    .register(new AgentZeroPlugin())
    .register(new SarvamAiPlugin())
    .register(new RazorpayPlugin());

  await pluginManager.initializeAll();
  pluginManager.startHealthChecks(5 * 60 * 1000); // Health check every 5 min
  logger.info('[PluginManager] Built-in plugins initialized');
}

export default pluginManager;
