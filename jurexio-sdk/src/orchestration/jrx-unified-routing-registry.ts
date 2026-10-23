import { createLogger } from '../utils/logger.js';

const logger = createLogger('unified-routing-registry');

/**
 * Unified Routing Registry
 * 
 * PURPOSE: Consolidate 18 wiring services into unified plugin system
 * Replaces fragmented orchestration hooks with centralized, configurable routing
 * 
 * FEATURES:
 * - Plugin registration with priority ordering
 * - Feature flag support for enable/disable
 * - Three-phase hooks (pre, during, post orchestration)
 * - Conflict resolution via priority chain
 * - Centralized configuration
 * 
 * MIGRATION PATH:
 * ```typescript
 * // BEFORE: 18 separate wiring service imports
 * import { parlantWiringService } from './parlant-wiring-service.js';
 * import { bmadWiringService } from './bmad-wiring-service.js';
 * // ... 16 more imports
 * 
 * // AFTER: Unified registry
 * const registry = new UnifiedRoutingRegistry();
 * registry.registerPlugin('parlant', parlantPlugin, { priority: 10, enabled: true });
 * registry.registerPlugin('bmad', bmadPlugin, { priority: 20, enabled: true });
 * 
 * // Apply all plugins
 * const enhancedRequest = await registry.applyPreOrchestrationPlugins(request);
 * ```
 * 
 * Phase 2A Stage 0 - Consolidation of 18 wiring services
 */

type JurexioOrchestrationRequestInput = Record<string, any>;
type OrchestrationResult = { success: boolean; result?: any; error?: string; metadata?: Record<string, any> };

/**
 * Orchestration phase enum
 */
export enum OrchestrationPhase {
  PRE = 'pre',
  DURING = 'during',
  POST = 'post',
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Priority level (higher = executes first) */
  priority: number;
  
  /** Whether plugin is enabled */
  enabled: boolean;
  
  /** Plugin-specific configuration */
  config?: Record<string, unknown>;
  
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Plugin context passed to all plugin hooks
 */
export interface PluginContext {
  /** Unique request ID */
  requestId: string;
  
  /** Startup ID for context */
  startupId?: number;
  
  /** User ID for attribution */
  userId?: number;
  
  /** Studio ID for routing */
  studioId?: string;
  
  /** Workflow name */
  workflowName?: string;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Plugin execution result
 */
export interface PluginExecutionResult {
  /** Plugin ID */
  pluginId: string;
  
  /** Whether plugin modified the request/result */
  modified: boolean;
  
  /** Execution time in milliseconds */
  executionTimeMs: number;
  
  /** Any logs or notes from plugin */
  logs?: string[];
  
  /** Plugin-specific metrics */
  metrics?: Record<string, unknown>;
}

/**
 * Routing plugin interface
 * All wiring services implement this interface
 */
export interface IRoutingPlugin {
  /**
   * Plugin identifier
   */
  readonly id: string;
  
  /**
   * Plugin name
   */
  readonly name: string;
  
  /**
   * Plugin description
   */
  readonly description: string;
  
  /**
   * Hook: Pre-orchestration (before Jurexio Core executes)
   * Modify orchestration request before execution
   */
  onPreOrchestration?(
    request: JurexioOrchestrationRequestInput,
    context: PluginContext
  ): Promise<JurexioOrchestrationRequestInput>;
  
  /**
   * Hook: During-orchestration (while Jurexio Core executes)
   * Monitor and modify execution in real-time
   */
  onDuringOrchestration?(
    request: JurexioOrchestrationRequestInput,
    context: PluginContext
  ): Promise<void>;
  
  /**
   * Hook: Post-orchestration (after Jurexio Core executes)
   * Analyze results, update metrics, log analytics
   */
  onPostOrchestration?(
    request: JurexioOrchestrationRequestInput,
    result: OrchestrationResult,
    context: PluginContext
  ): Promise<OrchestrationResult>;
  
  /**
   * Initialize plugin (called once at startup)
   */
  initialize?(): Promise<void>;
  
  /**
   * Cleanup plugin resources
   */
  cleanup?(): Promise<void>;
}

/**
 * Registered plugin with config
 */
interface RegisteredPlugin {
  plugin: IRoutingPlugin;
  config: PluginConfig;
  executionCount: number;
  totalExecutionTime: number;
  lastExecutedAt?: Date;
}

/**
 * Unified Routing Registry
 * 
 * Central registry for all orchestration enhancement plugins
 */
export class UnifiedRoutingRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private globalEnabled: boolean = true;

  constructor() {
    logger.info('🌐 Unified Routing Registry initialized');
    logger.info('🔌 Plugin system ready for wiring service consolidation');
  }

  /**
   * Register a routing plugin
   * 
   * @param pluginId - Unique plugin identifier
   * @param plugin - Plugin implementation
   * @param config - Plugin configuration
   * 
   * @example
   * ```typescript
   * registry.registerPlugin('parlant', parlantPlugin, {
   *   priority: 10,
   *   enabled: true,
   *   config: { strictMode: true }
   * });
   * ```
   */
  registerPlugin(
    pluginId: string,
    plugin: IRoutingPlugin,
    config: Partial<PluginConfig> = {}
  ): void {
    if (this.plugins.has(pluginId)) {
      logger.warn(`⚠️  Plugin '${pluginId}' already registered - overwriting`);
    }

    const fullConfig: PluginConfig = {
      priority: config.priority ?? 50,
      enabled: config.enabled ?? true,
      config: config.config ?? {},
      tags: config.tags ?? [],
    };

    this.plugins.set(pluginId, {
      plugin,
      config: fullConfig,
      executionCount: 0,
      totalExecutionTime: 0,
    });

    logger.info(`✅ Registered plugin: ${plugin.name} [id=${pluginId}, priority=${fullConfig.priority}]`);
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      logger.warn(`⚠️  Plugin '${pluginId}' not found`);
      return;
    }

    // Cleanup plugin resources
    if (registered.plugin.cleanup) {
      await registered.plugin.cleanup();
    }

    this.plugins.delete(pluginId);
    logger.info(`🗑️  Unregistered plugin: ${pluginId}`);
  }

  /**
   * Enable/disable a specific plugin
   */
  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    registered.config.enabled = enabled;
    logger.info(`${enabled ? '✅' : '⏸️'} Plugin '${pluginId}' ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable/disable all plugins globally
   */
  setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled;
    logger.info(`${enabled ? '✅' : '⏸️'} Global plugin system ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get plugins sorted by priority (highest first)
   */
  private getSortedPlugins(): RegisteredPlugin[] {
    return Array.from(this.plugins.values())
      .filter(p => p.config.enabled && this.globalEnabled)
      .sort((a, b) => b.config.priority - a.config.priority);
  }

  /**
   * Apply all pre-orchestration plugins
   * Modifies request before Jurexio Core execution
   */
  async applyPreOrchestrationPlugins(
    request: JurexioOrchestrationRequestInput,
    context: PluginContext
  ): Promise<{
    modifiedRequest: JurexioOrchestrationRequestInput;
    pluginResults: PluginExecutionResult[];
  }> {
    if (!this.globalEnabled) {
      return { modifiedRequest: request, pluginResults: [] };
    }

    let modifiedRequest = { ...request };
    const pluginResults: PluginExecutionResult[] = [];
    const sortedPlugins = this.getSortedPlugins();

    logger.info(`🔌 Applying ${sortedPlugins.length} pre-orchestration plugins...`);

    for (const registered of sortedPlugins) {
      const { plugin, config } = registered;
      
      if (!plugin.onPreOrchestration) {
        continue; // Skip plugins without pre-hook
      }

      const startTime = Date.now();
      const originalRequest = JSON.stringify(modifiedRequest);

      try {
        modifiedRequest = await plugin.onPreOrchestration(modifiedRequest, context);
        
        const executionTime = Date.now() - startTime;
        const modified = originalRequest !== JSON.stringify(modifiedRequest);

        // Update plugin metrics
        registered.executionCount++;
        registered.totalExecutionTime += executionTime;
        registered.lastExecutedAt = new Date();

        pluginResults.push({
          pluginId: plugin.id,
          modified,
          executionTimeMs: executionTime,
          logs: modified ? [`Modified request in ${executionTime}ms`] : [],
        });

        if (modified) {
          logger.info(`  ✏️  ${plugin.name}: Modified request (${executionTime}ms)`);
        }
      } catch (error: any) {
        logger.error(`❌ Plugin '${plugin.id}' failed in pre-orchestration:`, error);
        // Continue with other plugins despite failure
      }
    }

    return { modifiedRequest, pluginResults };
  }

  /**
   * Apply all during-orchestration plugins
   * Monitor and modify execution in real-time
   */
  async applyDuringOrchestrationPlugins(
    request: JurexioOrchestrationRequestInput,
    context: PluginContext
  ): Promise<PluginExecutionResult[]> {
    if (!this.globalEnabled) {
      return [];
    }

    const pluginResults: PluginExecutionResult[] = [];
    const sortedPlugins = this.getSortedPlugins();

    for (const registered of sortedPlugins) {
      const { plugin } = registered;
      
      if (!plugin.onDuringOrchestration) {
        continue;
      }

      const startTime = Date.now();

      try {
        await plugin.onDuringOrchestration(request, context);
        
        const executionTime = Date.now() - startTime;

        pluginResults.push({
          pluginId: plugin.id,
          modified: false,
          executionTimeMs: executionTime,
        });
      } catch (error: any) {
        logger.error(`❌ Plugin '${plugin.id}' failed in during-orchestration:`, error);
      }
    }

    return pluginResults;
  }

  /**
   * Apply all post-orchestration plugins
   * Analyze results, update metrics, log analytics
   */
  async applyPostOrchestrationPlugins(
    request: JurexioOrchestrationRequestInput,
    result: OrchestrationResult,
    context: PluginContext
  ): Promise<{
    modifiedResult: OrchestrationResult;
    pluginResults: PluginExecutionResult[];
  }> {
    if (!this.globalEnabled) {
      return { modifiedResult: result, pluginResults: [] };
    }

    let modifiedResult = { ...result };
    const pluginResults: PluginExecutionResult[] = [];
    const sortedPlugins = this.getSortedPlugins();

    logger.info(`🔌 Applying ${sortedPlugins.length} post-orchestration plugins...`);

    for (const registered of sortedPlugins) {
      const { plugin } = registered;
      
      if (!plugin.onPostOrchestration) {
        continue;
      }

      const startTime = Date.now();
      const originalResult = JSON.stringify(modifiedResult);

      try {
        modifiedResult = await plugin.onPostOrchestration(request, modifiedResult, context);
        
        const executionTime = Date.now() - startTime;
        const modified = originalResult !== JSON.stringify(modifiedResult);

        pluginResults.push({
          pluginId: plugin.id,
          modified,
          executionTimeMs: executionTime,
        });

        if (modified) {
          logger.info(`  ✏️  ${plugin.name}: Modified result (${executionTime}ms)`);
        }
      } catch (error: any) {
        logger.error(`❌ Plugin '${plugin.id}' failed in post-orchestration:`, error);
      }
    }

    return { modifiedResult, pluginResults };
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAllPlugins(): Promise<void> {
    logger.info('🚀 Initializing all registered plugins...');
    
    for (const [pluginId, registered] of this.plugins.entries()) {
      if (registered.plugin.initialize) {
        try {
          await registered.plugin.initialize();
          logger.info(`  ✅ Initialized: ${registered.plugin.name}`);
        } catch (error: any) {
          logger.error(`  ❌ Failed to initialize '${pluginId}':`, error);
        }
      }
    }
    
    logger.info(`✅ Initialized ${this.plugins.size} plugins`);
  }

  /**
   * Get plugin statistics
   */
  getPluginStats(): Record<string, {
    name: string;
    enabled: boolean;
    priority: number;
    executionCount: number;
    totalExecutionTimeMs: number;
    avgExecutionTimeMs: number;
    lastExecutedAt?: string;
  }> {
    const stats: Record<string, any> = {};

    for (const [pluginId, registered] of this.plugins.entries()) {
      stats[pluginId] = {
        name: registered.plugin.name,
        enabled: registered.config.enabled,
        priority: registered.config.priority,
        executionCount: registered.executionCount,
        totalExecutionTimeMs: registered.totalExecutionTime,
        avgExecutionTimeMs: registered.executionCount > 0
          ? registered.totalExecutionTime / registered.executionCount
          : 0,
        lastExecutedAt: registered.lastExecutedAt?.toISOString(),
      };
    }

    return stats;
  }

  /**
   * Get count of registered plugins
   */
  getPluginCount(): { total: number; enabled: number; disabled: number } {
    const total = this.plugins.size;
    const enabled = Array.from(this.plugins.values()).filter(p => p.config.enabled).length;
    const disabled = total - enabled;

    return { total, enabled, disabled };
  }

  /**
   * Get plugins by tag
   */
  getPluginsByTag(tag: string): IRoutingPlugin[] {
    return Array.from(this.plugins.values())
      .filter(p => p.config.tags?.includes(tag))
      .map(p => p.plugin);
  }

  /**
   * List all registered plugins
   */
  listPlugins(): Array<{
    id: string;
    name: string;
    description: string;
    priority: number;
    enabled: boolean;
  }> {
    return Array.from(this.plugins.entries()).map(([id, registered]) => ({
      id,
      name: registered.plugin.name,
      description: registered.plugin.description,
      priority: registered.config.priority,
      enabled: registered.config.enabled,
    }));
  }
}

/**
 * Global unified routing registry instance
 */
export const unifiedRoutingRegistry = new UnifiedRoutingRegistry();

logger.info('🌐 Global Unified Routing Registry created');
