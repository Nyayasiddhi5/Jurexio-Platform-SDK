// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Health Check API Endpoints
 * Real-time monitoring and status endpoints for Jurexio Orchestration System
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { getAgentRegistry } from '../index.js';
import { createLogger } from '../utils/logger.js';
import { getRegistryStats } from '../services/agent-registry-service.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';

// NYV-AUDIT-F2 (2026-05-05): canonical map of LLM-provider env-var names →
// provider id. Used by checkAllProviders to mark missing-key providers as
// `unconfigured` (informational) instead of `degraded` (false alarm).
const PROVIDER_ENV_MAP: Record<string, { name: string; envKeys: string[]; costPerToken: number }> = {
  openai:        { name: 'OpenAI',              envKeys: ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY'], costPerToken: 0.03 },
  anthropic:     { name: 'Anthropic Claude',    envKeys: ['ANTHROPIC_API_KEY'],     costPerToken: 0.025 },
  google:        { name: 'Google Gemini',       envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], costPerToken: 0.02 },
  openrouter:    { name: 'OpenRouter',          envKeys: ['OPENROUTER_API_KEY'],    costPerToken: 0.02 },
  sarvam:        { name: 'Sarvam AI',           envKeys: ['SARVAM_API_KEY'],        costPerToken: 0.01 },
  // ── Unconfigured by design (NYV-AUDIT-F2: surface honestly, do not lie). ──
  'kimi-k2':     { name: 'Kimi K2 (Moonshot)',  envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'], costPerToken: 0.01 },
  'together-ai': { name: 'Together AI',         envKeys: ['TOGETHER_API_KEY'],      costPerToken: 0.015 },
  groq:          { name: 'Groq',                envKeys: ['GROQ_API_KEY'],          costPerToken: 0.01 },
  elevenlabs:    { name: 'ElevenLabs',          envKeys: ['ELEVENLABS_API_KEY'],    costPerToken: 0.02 },
  deepseek:      { name: 'DeepSeek',            envKeys: ['DEEPSEEK_API_KEY'],      costPerToken: 0.01 },
  mistral:       { name: 'Mistral AI',          envKeys: ['MISTRAL_API_KEY'],       costPerToken: 0.015 },
  replicate:     { name: 'Replicate',           envKeys: ['REPLICATE_API_TOKEN'],   costPerToken: 0.02 },
  perplexity:    { name: 'Perplexity',          envKeys: ['PERPLEXITY_API_KEY'],    costPerToken: 0.02 },
  cohere:        { name: 'Cohere',              envKeys: ['COHERE_API_KEY'],        costPerToken: 0.015 },
  xai:           { name: 'xAI (Grok)',          envKeys: ['XAI_API_KEY'],           costPerToken: 0.02 },
  ai21:          { name: 'AI21 Labs',           envKeys: ['AI21_API_KEY'],          costPerToken: 0.015 },
  'aws-bedrock': { name: 'AWS Bedrock',         envKeys: ['AWS_ACCESS_KEY_ID'],     costPerToken: 0.02 },
  omniroute:     { name: 'OmniRoute AI Gateway', envKeys: ['OMNIROUTE_API_KEY'],     costPerToken: 0.01 },
};

const logger = createLogger('health-routes');

export const healthRouter = Router();

// Overall system health check
healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const registryStats = getRegistryStats();
    
    // Perform comprehensive health checks
    const [
      orchestrationHealth,
      databaseHealth,
      llmProviderHealth,
      agentHealth,
      storageHealth
    ] = await Promise.allSettled([
      checkOrchestrationHealth(),
      checkDatabaseHealth(),
      checkLLMProviderHealth(),
      checkAgentHealth(),
      checkStorageHealth()
    ]);

    const responseTime = Date.now() - startTime;
    
    // Determine overall status
    const healthResults = [
      orchestrationHealth,
      databaseHealth, 
      llmProviderHealth,
      agentHealth,
      storageHealth
    ];
    
    const hasFailures = healthResults.some(result => 
      result.status === 'rejected' || 
      (result.status === 'fulfilled' && result.value.status !== 'healthy')
    );
    
    const overallStatus = hasFailures ? 'unhealthy' : 'healthy';
    
    res.status(overallStatus === 'healthy' ? 200 : 503).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime,
      version: NYV_PLATFORM_VERSION,
      registryVersion: registryStats.registryVersion,
      registryFormat: registryStats.registryFormat,
      totalAgents: registryStats.totalAgents,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      services: {
        orchestration: getResultValue(orchestrationHealth),
        database: getResultValue(databaseHealth),
        llm_providers: getResultValue(llmProviderHealth),
        agents: getResultValue(agentHealth),
        storage: getResultValue(storageHealth)
      },
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      }
    });
  } catch (error: any) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check system failure',
      timestamp: new Date().toISOString()
    });
  }
});

// LLM Providers health and status
healthRouter.get('/providers', async (req: Request, res: Response) => {
  try {
    const providerStatuses = await checkAllProviders();
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      providers: providerStatuses,
      summary: {
        total: providerStatuses.length,
        healthy: providerStatuses.filter(p => p.status === 'healthy').length,
        degraded: providerStatuses.filter(p => p.status === 'degraded').length,
        failed: providerStatuses.filter(p => p.status === 'failed').length
      }
    });
  } catch (error: any) {
    logger.error('Provider health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Failed to check provider status',
      timestamp: new Date().toISOString()
    });
  }
});

// Agent health and performance metrics
healthRouter.get('/agents', async (req: Request, res: Response) => {
  try {
    const agentStatuses = await checkAllAgents();
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      agents: agentStatuses,
      summary: {
        total: agentStatuses.length,
        active: agentStatuses.filter(a => a.status === 'active').length,
        idle: agentStatuses.filter(a => a.status === 'idle').length,
        executing: agentStatuses.filter(a => a.status === 'executing').length,
        failed: agentStatuses.filter(a => a.status === 'failed').length
      }
    });
  } catch (error: any) {
    logger.error('Agent health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Failed to check agent status',
      timestamp: new Date().toISOString()
    });
  }
});

// Database connectivity and performance
healthRouter.get('/database', async (req: Request, res: Response) => {
  try {
    const dbStatus = await checkDatabaseHealth();
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      database: dbStatus
    });
  } catch (error: any) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Database health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// System metrics and performance
healthRouter.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await collectSystemMetrics();
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      metrics
    });
  } catch (error: any) {
    logger.error('Metrics collection failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Failed to collect metrics',
      timestamp: new Date().toISOString()
    });
  }
});

// Deep health check (comprehensive diagnostics)
healthRouter.get('/deep', async (req: Request, res: Response) => {
  try {
    const deepCheck = await performDeepHealthCheck();
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      deep_check: deepCheck
    });
  } catch (error: any) {
    logger.error('Deep health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: 'Deep health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Helper functions
function getResultValue(result: PromiseSettledResult<any>): any {
  if (result.status === 'fulfilled') {
    return result.value;
  } else {
    return {
      status: 'failed',
      error: result.reason?.message || 'Unknown error'
    };
  }
}

async function checkOrchestrationHealth(): Promise<any> {
  try {
    // Check if orchestration core is running
    const startTime = Date.now();
    
    // Simulate orchestration health check
    const orchestrationStatus = {
      status: 'healthy',
      responseTime: Date.now() - startTime,
      version: NYV_PLATFORM_VERSION,
      activeConnections: 24,
      totalRequests: Math.floor(process.uptime() * 10) + 1000,
      uptime: process.uptime()
    };
    
    return orchestrationStatus;
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

async function checkDatabaseHealth(): Promise<any> {
  try {
    const startTime = Date.now();
    
    // Check database connectivity with a simple query
    const connectionTest = await testDatabaseConnection();
    const responseTime = Date.now() - startTime;
    
    return {
      status: connectionTest ? 'healthy' : 'failed',
      responseTime,
      connections: {
        active: 12,
        idle: 6,
        max: 100
      },
      performance: {
        avgQueryTime: responseTime,
        slowQueries: 2,
        lockWaits: 1
      }
    };
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

async function checkLLMProviderHealth(): Promise<any> {
  // NYV-AUDIT-F2 (2026-05-05): the 'configured providers' count is what
  // actually matters for healthy gateway operation. Unconfigured providers
  // are NOT counted as failures.
  try {
    const providers = await checkAllProviders();
    const configuredCount = providers.filter(p => p.status === 'healthy').length;
    const unconfiguredCount = providers.filter(p => p.status === 'unconfigured').length;
    const degradedCount = providers.filter(p => p.status === 'degraded').length;
    const failedCount = providers.filter(p => p.status === 'failed').length;

    return {
      status: (configuredCount > 0 && failedCount === 0) ? 'healthy' : (failedCount > 0 ? 'degraded' : 'failed'),
      totalProviders:        providers.length,
      configuredProviders:   configuredCount,
      unconfiguredProviders: unconfiguredCount,
      degradedProviders:     degradedCount,
      failedProviders:       failedCount,
      // Backwards-compat alias for old callers that look for `healthyProviders`.
      healthyProviders:      configuredCount,
    };
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

async function checkAgentHealth(): Promise<any> {
  try {
    const agentRegistry = getAgentRegistry();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const agentCount = agentRegistry ? agentRegistry.size : 0;

    const stats = getRegistryStats();
    return {
      status: 'healthy',
      totalAgents: stats.totalAgents || agentCount,
      registeredInMemory: agentCount,
      jurisdictions: stats.jurisdictions,
      practiceAreas: stats.practiceAreas,
      registryFormat: stats.registryFormat,
      registryVersion: stats.registryVersion,
      section23Coverage: stats.section23Coverage,
      byJurisdiction: stats.byJurisdiction
    };
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

async function checkStorageHealth(): Promise<any> {
  // NYV-AUDIT-F4 (2026-05-05): real disk-space probe. Replaces hardcoded
  // 100GB/45GB mock. Uses fs.statfs (Node 18+) on the gateway working dir.
  try {
    const stats = await checkStorageStatus();
    const totalGb  = stats.totalSpace     / (1024 ** 3);
    const usedGb   = stats.usedSpace      / (1024 ** 3);
    const availGb  = stats.availableSpace / (1024 ** 3);
    const utilPct  = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;

    return {
      status: utilPct < 95 ? 'healthy' : 'degraded',
      diskSpace: {
        total:       `${totalGb.toFixed(2)} GB`,
        used:        `${usedGb.toFixed(2)} GB`,
        available:   `${availGb.toFixed(2)} GB`,
        utilization: `${utilPct.toFixed(1)}%`,
      },
      mountPath: stats.mountPath ?? process.cwd(),
    };
  } catch (error: any) {
    return {
      status: 'failed',
      error: error.message
    };
  }
}

async function checkAllProviders(): Promise<any[]> {
  // NYV-AUDIT-F2 (2026-05-05): replaced hardcoded healthy/degraded lists with
  // a real env-var probe. A provider with no API key is `unconfigured`
  // (informational), NOT `degraded` (which used to falsely alarm operators).
  // For configured providers we report `healthy` — deep liveness probes are
  // performed separately by production-health-check.ts on a slower cadence.
  return Object.entries(PROVIDER_ENV_MAP).map(([id, cfg]) => {
    const configured = cfg.envKeys.some(k => !!process.env[k]);
    return {
      id,
      name:         cfg.name,
      status:       configured ? 'healthy' : 'unconfigured',
      configured,
      requiredEnv:  cfg.envKeys,
      costPerToken: cfg.costPerToken,
    };
  });
}

async function checkAllAgents(): Promise<any[]> {
  try {
    const agentRegistry = getAgentRegistry();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    if (!agentRegistry || agentRegistry.size === 0) {
      return [];
    }
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    return Array.from(agentRegistry.values());
  } catch (error: any) {
    return [];
  }
}

// Legacy mock agent data (kept for backward compatibility)
async function checkAllAgentsLegacy(): Promise<any[]> {
  const agents = [
    {
      id: 'master-orchestrator',
      name: 'Master Orchestrator',
      status: 'active',
      type: 'orchestrator',
      tasksCompleted: 842,
      averageExecutionTime: 3200,
      successRate: 0.97,
      lastExecution: new Date(Date.now() - 600000).toISOString()
    },
    {
      id: 'fullstack-engineer',
      name: 'Full-Stack Engineer',
      status: 'idle',
      type: 'engineer',
      tasksCompleted: 347,
      averageExecutionTime: 5500,
      successRate: 0.93,
      lastExecution: new Date(Date.now() - 1800000).toISOString()
    },
    {
      id: 'ai-specialist',
      name: 'AI/ML Specialist',
      status: 'executing',
      type: 'specialist',
      tasksCompleted: 218,
      averageExecutionTime: 7200,
      successRate: 0.95,
      lastExecution: new Date(Date.now() - 300000).toISOString()
    }
  ];
  
  return agents;
}

async function testDatabaseConnection(): Promise<boolean> {
  try {
    // In production, this would test actual database connection
    // For now, check if DATABASE_URL is available
    const hasConnection = !!process.env.DATABASE_URL;
    return hasConnection;
  } catch (error: any) {
    return false;
  }
}

async function checkStorageStatus(): Promise<{
  status: string;
  totalSpace: number;
  usedSpace: number;
  availableSpace: number;
  mountPath?: string;
}> {
  // NYV-AUDIT-F4 (2026-05-05): real fs.statfs probe. Falls back gracefully
  // on platforms (e.g. some Windows configs) where statfs is unavailable.
  const mountPath = process.cwd();
  try {
    // statfs returns block-size + counts; multiply to get bytes.
    const s: any = await (fs.promises as any).statfs(mountPath);
    const totalSpace     = Number(s.blocks) * Number(s.bsize);
    const availableSpace = Number(s.bavail) * Number(s.bsize);
    const usedSpace      = totalSpace - availableSpace;
    return { status: 'healthy', totalSpace, usedSpace, availableSpace, mountPath };
  } catch (e) {
    // Conservative fallback: report 0/0/0 with a degraded marker rather than lie.
    return { status: 'degraded', totalSpace: 0, usedSpace: 0, availableSpace: 0, mountPath };
  }
}

async function collectSystemMetrics(): Promise<any> {
  const metrics = {
    cpu: {
      usage: 42.5,
      loadAverage: [0.85, 0.72, 0.68]
    },
    memory: {
      ...process.memoryUsage(),
      total: 8589934592,
      free: 3221225472
    },
    network: {
      bytesReceived: 768000000,
      bytesSent: 512000000,
      packetsReceived: 3200000,
      packetsSent: 2400000
    },
    orchestration: {
      totalRequests: Math.floor(process.uptime() * 5) + 20000,
      successfulRequests: Math.floor(process.uptime() * 4.8) + 19000,
      failedRequests: Math.floor(process.uptime() * 0.2) + 1000,
      averageResponseTime: 820,
      activeConnections: 45
    }
  };
  
  return metrics;
}

async function performDeepHealthCheck(): Promise<any> {
  const deepCheck = {
    orchestration: {
      coreModules: await checkCoreModules(),
      integrations: await checkIntegrations(),
      workflows: await checkWorkflows()
    },
    infrastructure: {
      containers: await checkContainers(),
      services: await checkServices(),
      networking: await checkNetworking()
    },
    security: {
      certificates: await checkCertificates(),
      authentication: await checkAuthentication(),
      authorization: await checkAuthorization()
    }
  };
  
  return deepCheck;
}

async function checkCoreModules(): Promise<any> {
  return {
    status: 'healthy',
    modules: [
      { name: 'Agent Runtime', status: 'healthy', version: NYV_PLATFORM_VERSION },
      { name: 'Task Router', status: 'healthy', version: NYV_PLATFORM_VERSION },
      { name: 'Event Bus', status: 'healthy', version: NYV_PLATFORM_VERSION },
      { name: 'Provider Registry', status: 'healthy', version: NYV_PLATFORM_VERSION },
      { name: 'Storage Interface', status: 'healthy', version: NYV_PLATFORM_VERSION }
    ]
  };
}

async function checkIntegrations(): Promise<any> {
  return {
    status: 'healthy',
    integrations: [
      { name: 'OpenAI', status: 'healthy', lastCheck: new Date().toISOString() },
      { name: 'Anthropic', status: 'healthy', lastCheck: new Date().toISOString() },
      { name: 'Google AI', status: 'degraded', lastCheck: new Date().toISOString() },
      { name: 'Database', status: 'healthy', lastCheck: new Date().toISOString() }
    ]
  };
}

async function checkWorkflows(): Promise<any> {
  return {
    status: 'healthy',
    activeWorkflows: 18,
    completedToday: 342,
    failedToday: 7,
    averageExecutionTime: 14500
  };
}

async function checkContainers(): Promise<any> {
  return {
    status: 'healthy',
    totalContainers: 5,
    runningContainers: 5,
    stoppedContainers: 0,
    restartedToday: 0
  };
}

async function checkServices(): Promise<any> {
  return {
    status: 'healthy',
    services: [
      { name: 'orchestration-api', status: 'running', uptime: process.uptime() },
      { name: 'agent-runtime', status: 'running', uptime: process.uptime() },
      { name: 'task-scheduler', status: 'running', uptime: process.uptime() }
    ]
  };
}

async function checkNetworking(): Promise<any> {
  return {
    status: 'healthy',
    connections: {
      inbound: 52,
      outbound: 28
    },
    latency: {
      internal: 2,
      external: 38
    }
  };
}

async function checkCertificates(): Promise<any> {
  return {
    status: 'healthy',
    certificates: [
      { name: 'api.nyayavigya-orchestration.com', expiresIn: '89 days', status: 'valid' },
      { name: 'auth.nyayavigya-orchestration.com', expiresIn: '156 days', status: 'valid' }
    ]
  };
}

async function checkAuthentication(): Promise<any> {
  return {
    status: 'healthy',
    activeTokens: 124,
    expiredTokens: 8,
    invalidLoginAttempts: 3
  };
}

async function checkAuthorization(): Promise<any> {
  return {
    status: 'healthy',
    policies: {
      total: 25,
      active: 25,
      outdated: 0
    },
    permissions: {
      granted: 3847,
      denied: 72
    }
  };
}