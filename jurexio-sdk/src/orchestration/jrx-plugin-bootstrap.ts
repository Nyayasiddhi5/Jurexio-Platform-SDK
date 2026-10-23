/**
 * Plugin Bootstrap
 * 
 * Registers all routing plugins with Unified Routing Registry at application startup
 * Consolidates 18 wiring services into unified plugin system
 * 
 * Phase 2A Stage 0 - Plugin Registration
 */

import { unifiedRoutingRegistry, type IRoutingPlugin } from './jrx-unified-routing-registry.js';
import { createLogger } from '../utils/logger.js';
import { NvParlantService, NvBMADService } from '../services/jrx-orchestration-services.js';
import { LLMPriorityManager } from '../services/llm-priority-manager/llm-priority-manager.js';


const logger = createLogger('plugin-bootstrap');

class ParlantPlugin implements IRoutingPlugin {
  readonly id = 'parlant';
  readonly name = 'Parlant Standards';
  readonly description = 'Parlant prompt-engineering and anti-hallucination standards plugin';
  private readonly parlantService = new NvParlantService();

  async initialize() {
    await this.parlantService.ensureTables();
    logger.info('[PluginBootstrap] Parlant plugin bound to NvParlantService');
  }
}

class BMADPlugin implements IRoutingPlugin {
  readonly id = 'bmad';
  readonly name = 'BMAD Behavioral Design';
  readonly description = 'BMAD behavioral / personality design plugin';
  private readonly bmadService = new NvBMADService();

  async initialize() {
    const templates = this.bmadService.getTemplates();
    logger.info('[PluginBootstrap] BMAD plugin bound to NvBMADService', { templates: templates.length });
  }
}

class IntelligentRoutingPlugin implements IRoutingPlugin {
  readonly id = 'intelligent-routing';
  readonly name = 'Intelligent Routing';
  readonly description = 'Intelligent provider routing and optimization plugin';
  private readonly llmPriorityManager = LLMPriorityManager.getInstance();

  async initialize() {
    const providerHealth = this.llmPriorityManager.getProviderHealth();
    logger.info('[PluginBootstrap] Intelligent routing plugin bound to LLMPriorityManager', {
      providers: providerHealth.length,
      healthy: providerHealth.filter((provider) => provider.isAvailable).length,
    });
  }
}

/**
 * Initialize and register all plugins
 * Called once at application startup
 */
export async function bootstrapPlugins(): Promise<void> {
  logger.info('🚀 Bootstrapping routing plugins...');

  try {
    // Register Parlant Standards Plugin
    unifiedRoutingRegistry.registerPlugin('parlant', new ParlantPlugin(), {
      priority: 100, // Highest priority - applies first
      enabled: true,
      tags: ['prompt-engineering', 'standards', 'core'],
      config: {
        strictMode: true,
        antiHallucination: true,
      },
    });

    // Register BMAD Behavioral Design Plugin
    unifiedRoutingRegistry.registerPlugin('bmad', new BMADPlugin(), {
      priority: 90,
      enabled: true,
      tags: ['behavioral', 'personality', 'core'],
      config: {
        enablePersonality: true,
        adaptToContext: true,
      },
    });

    // Register Intelligent Provider Routing Plugin
    unifiedRoutingRegistry.registerPlugin('intelligent-routing', new IntelligentRoutingPlugin(), {
      priority: 80,
      enabled: true,
      tags: ['routing', 'optimization', 'core'],
      config: {
        costOptimization: true,
        loadBalancing: true,
      },
    });

    // Additional plugins (Context Engineering, Multi-Clock Coordination, A2A Collaboration,
    // Real-Time Optimization, Semantic Caching, Provider Arbitrage, Dynamic Model Selection,
    // Error Recovery, Cost Optimization, Agent Collaboration Network, Continuous Learning,
    // Claude Extended Thinking, Quantum Security, Parallel Processing) are registered
    // dynamically by their respective service modules when loaded via dependency injection.

    // Initialize all registered plugins
    await unifiedRoutingRegistry.initializeAllPlugins();

    // Log registration summary
    const stats = unifiedRoutingRegistry.getPluginCount();
    logger.info(`✅ Plugin bootstrap complete: ${stats.enabled}/${stats.total} plugins enabled`);

    // List all plugins
    const plugins = unifiedRoutingRegistry.listPlugins();
    logger.info('📋 Registered plugins:');
    plugins
      .sort((a, b) => b.priority - a.priority) // Sort by priority
      .forEach(plugin => {
        logger.info(`  ${plugin.enabled ? '✅' : '⏸️'} [${plugin.priority}] ${plugin.name} (${plugin.id})`);
      });
  } catch (error: any) {
    logger.error('❌ Plugin bootstrap failed:', error);
    throw error;
  }
}

/**
 * Shutdown all plugins
 * Called during application graceful shutdown
 */
export async function shutdownPlugins(): Promise<void> {
  logger.info('🛑 Shutting down routing plugins...');
  
  // Cleanup is handled by registry when plugins are unregistered
  // For now, just disable globally
  unifiedRoutingRegistry.setGlobalEnabled(false);
  
  logger.info('✅ Plugin shutdown complete');
}
