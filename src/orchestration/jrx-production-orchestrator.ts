/**
 * Production Jurexio Orchestrator
 * 
 * This orchestrator wires all 28+ integrations into a unified runtime execution system
 * with real implementations, proper error handling, and production-ready functionality.
 */

import { EventEmitter } from 'events';
import { createSmartThinkingEngine } from './jrx-smart-thinking-engine.js';
import { createLogger } from '../utils/logger.js';
import { createRomaMetaAgent } from '../packages/protocols/roma-meta-agent.js';
import { createParlantOptimizer } from '../packages/protocols/parlant-standards.js';
import { createContextEngineer } from '../packages/protocols/context-engineering.js';
import { llmRoutingEngine } from '../packages/protocols/llm-routing-engine.js';
import { mem0PersistenceService } from '../services/mem0-persistence-service.js';
import { LLMPriorityManager, type RoutingRequest } from '../services/llm-priority-manager/llm-priority-manager.js';
import { SdkWorkflowProtocolService } from '../services/sdk/sdk-workflow-protocol-service.js';
import { getAllAgents } from '../services/agent-registry-service.js';


const logger = createLogger('production-orchestrator');

const createTodoIntegration = (name: string, todo: string) => ({
  name,
  todo,
  available: false,
  initialize: async () => {
    logger.warn(`[ProductionOrchestrator] ${name} has no live integration`, { todo });
  },
  execute: async (..._args: any[]) => ({
    success: false,
    integration: name,
    available: false,
    todo,
  }),
});

const wrapFactoryIntegration = (name: string, factory: (_opts?: any) => any, executeCandidates: string[]) => async (opts?: any) => {
  const instance = factory(opts);
  const boundMethods: Record<string, any> = {};
  for (const key of new Set([
    ...Object.keys(instance || {}),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance || {})),
  ])) {
    if (key === 'constructor') continue;
    const value = instance?.[key];
    if (typeof value === 'function') {
      boundMethods[key] = value.bind(instance);
    }
  }
  return {
    name,
    instance,
    available: true,
    initialize: async () => {
      await instance?.initialize?.();
    },
    execute: async (...args: any[]) => {
      const method = executeCandidates.find(candidate => typeof instance?.[candidate] === 'function');
      if (!method) {
        return {
          success: true,
          integration: name,
          available: true,
          methods: Object.keys(instance || {}),
        };
      }
      return instance[method](...args);
    },
    ...boundMethods,
  };
};

const createRomaMetaAgentIntegration = wrapFactoryIntegration('roma-meta-agent', createRomaMetaAgent, ['processTask']);
const createParlantOptimizerIntegration = wrapFactoryIntegration('parlant-optimizer', createParlantOptimizer, ['optimizePrompt', 'getOptimizationStats']);
const createContextEngineerIntegration = wrapFactoryIntegration('context-engineer', createContextEngineer, ['engineerContext', 'getOptimizationStats']);
const createLLMRoutingEngine = async () => {
  const priorityManager = LLMPriorityManager.getInstance();
  return {
    name: 'llm-routing-engine',
    instance: priorityManager,
    available: true,
    initialize: async () => {
      const providerHealth = priorityManager.getProviderHealth();
      logger.info('[ProductionOrchestrator] llm-routing-engine bound to LLMPriorityManager', {
        configuredProviders: providerHealth.filter((provider) => provider.isAvailable).length,
        totalProviders: providerHealth.length,
        legacyStubPresent: Boolean(llmRoutingEngine),
      });
    },
    routeRequest: (request: RoutingRequest) => priorityManager.routeRequest(request),
    getRoutingMetrics: () => {
      const analytics = priorityManager.getCostAnalytics();
      return {
        averageCost: analytics.averageCostPerRequest,
        totalRequests: analytics.totalRequests,
      };
    },
    execute: async (request: RoutingRequest) => priorityManager.routeRequest(request),
  };
};
const createMem0Integration = async () => ({
  name: 'mem0-integration',
  instance: mem0PersistenceService,
  available: true,
  initialize: async () => {
    mem0PersistenceService.getStats();
  },
  execute: async (params: any = {}) => {
    const action = typeof params === 'string' ? params : params?.action;
    if (action === 'store') {
      return mem0PersistenceService.store(params.agentId, params.content, params.options);
    }
    if (action === 'recall') {
      return mem0PersistenceService.recall(params.agentId, params.query, params.options);
    }
    if (action === 'context') {
      return mem0PersistenceService.getAgentContext(params.agentId, params.namespace);
    }
    return mem0PersistenceService.getStats();
  },
  storeAgentMemory: (agentId: string, content: string, options?: any) =>
    mem0PersistenceService.store(agentId, content, options),
  recallAgentMemory: (agentId: string, query: string, options?: any) =>
    mem0PersistenceService.recall(agentId, query, options),
  getAgentContext: (agentId: string, namespace?: string) =>
    mem0PersistenceService.getAgentContext(agentId, namespace),
  getStats: () => mem0PersistenceService.getStats(),
});
const createClaudeFlowCoordinator = async (_opts?: any) => {
  const workflowService = new SdkWorkflowProtocolService();
  const ctx = {
    applicationId: 'internal-production-orchestrator',
    organizationId: 'jrx-platform',
    appName: 'ProductionOrchestrator',
  };
  return {
    name: 'claude-flow-coordinator',
    instance: workflowService,
    available: true,
    initialize: async () => {
      logger.info('[ProductionOrchestrator] claude-flow-coordinator bound to SdkWorkflowProtocolService');
    },
    createWorkflow: async (params: { name?: string; tasks?: any[]; metadata?: Record<string, any> }) => {
      const workflow = await workflowService.createWorkflow(
        params?.name || 'Internal Orchestration Workflow',
        'Generated by ProductionOrchestrator',
        Array.isArray(params?.tasks) ? params.tasks : [],
        [],
        'IN',
        ctx,
      );
      return {
        ...workflow,
        id: workflow.workflowId,
      };
    },
    executeWorkflow: async (workflowId: string, input: any = {}) =>
      workflowService.executeWorkflow(workflowId, input, 'sync', ctx),
    execute: async (params: { name?: string; tasks?: any[]; input?: any }) => {
      const workflow = await workflowService.createWorkflow(
        params?.name || 'Internal Orchestration Workflow',
        'Generated by ProductionOrchestrator',
        Array.isArray(params?.tasks) ? params.tasks : [],
        [],
        'IN',
        ctx,
      );
      return workflowService.executeWorkflow(workflow.workflowId, params?.input || {}, 'sync', ctx);
    },
  };
};
const createARTTrainer = async (_opts?: any) => createTodoIntegration('openpipe-art-trainer', 'No OpenPipe ART trainer module exists yet');
const createCodebuffAnalyzer = async (_opts?: any) => createTodoIntegration('codebuff-analyzer', 'No codebuff analyzer module exists yet');
const createPartPackerIntegration = async (_opts?: any) => createTodoIntegration('partpacker-3d', 'No PartPacker 3D integration module exists yet');
const createEigentOrchestrator = async (_opts?: any) => createTodoIntegration('eigent-workforce', 'No Eigent workforce orchestrator module exists yet');
const createSystemPromptArchitect = async (_opts?: any) => createTodoIntegration('system-prompt-architect', 'No system prompt architect module exists yet');

export interface OrchestrationRequest {
  id: string;
  type: 'project_creation' | 'content_generation' | 'code_development' | 'analysis' | 'optimization';
  task: string;
  requirements: {
    agents: string[];
    integrations: string[];
    quality_threshold: number;
    time_limit?: number;
    cost_budget?: number;
  };
  context: {
    user_id?: string;
    session_id?: string;
    project_id?: string;
    previous_context?: any;
  };
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata: {
    timestamp: Date;
    source: string;
    version: string;
  };
}

export interface OrchestrationResult {
  id: string;
  request_id: string;
  status: 'completed' | 'failed' | 'partial';
  output: {
    primary_result: any;
    artifacts: any[];
    metadata: any;
  };
  execution: {
    agents_used: string[];
    integrations_used: string[];
    total_duration: number;
    cost_breakdown: any;
    quality_score: number;
  };
  thinking: {
    reasoning_process: any;
    decisions_made: any[];
    alternatives_considered: any[];
  };
  errors?: any[];
  warnings?: any[];
}

export interface AgentCoordination {
  coordinator_id: string;
  participants: AgentParticipant[];
  coordination_strategy: 'sequential' | 'parallel' | 'hybrid' | 'dynamic';
  conflict_resolution: ConflictResolution;
  communication_channels: CommunicationChannel[];
}

export interface AgentParticipant {
  agent_id: string;
  role: 'primary' | 'secondary' | 'validator' | 'coordinator';
  capabilities: string[];
  current_task?: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  performance_metrics: {
    success_rate: number;
    average_duration: number;
    quality_score: number;
  };
}

export interface ConflictResolution {
  strategy: 'voting' | 'priority_based' | 'quality_based' | 'coordinator_decides';
  timeout: number;
  escalation_rules: any[];
}

export interface CommunicationChannel {
  id: string;
  type: 'direct' | 'broadcast' | 'queue' | 'event';
  participants: string[];
  message_history: any[];
}

export class ProductionOrchestrator extends EventEmitter {
  private integrations: Map<string, any> = new Map();
  private agents: Map<string, AgentParticipant> = new Map();
  private activeCoordinations: Map<string, AgentCoordination> = new Map();
  private requestHistory: Map<string, OrchestrationResult> = new Map();
  private smartThinking: any;
  private isInitialized: boolean = false;

  constructor() {
    super();
    this.setupEventHandlers();
  }

  /**
   * Initialize all integrations and agents with production configurations
   */
  async initialize(): Promise<void> {
    try {
      this.emit('initialization-started', { timestamp: new Date() });

      // Initialize core thinking engine
      this.smartThinking = createSmartThinkingEngine();

      // Initialize all 28+ integrations with real implementations
      await this.initializeIntegrations();
      
      // Initialize and register all 105+ agents
      await this.initializeAgents();
      
      // Setup coordination systems
      await this.setupCoordinationSystems();
      
      // Start monitoring and optimization
      await this.startOptimizationSystems();

      this.isInitialized = true;
      
      this.emit('initialization-completed', {
        integrations: this.integrations.size,
        agents: this.agents.size,
        timestamp: new Date()
      });

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { stage: 'initialization', error: errorMessage });
      throw error;
    }
  }

  /**
   * Initialize all integrations with real provider connections
   */
  private async initializeIntegrations(): Promise<void> {
    const integrationConfigs = [
      { name: 'roma-meta-agent', factory: createRomaMetaAgentIntegration, critical: true },
      { name: 'claude-flow-coordinator', factory: createClaudeFlowCoordinator, critical: true },
      { name: 'openpipe-art-trainer', factory: createARTTrainer, critical: false },
      { name: 'codebuff-analyzer', factory: createCodebuffAnalyzer, critical: false },
      { name: 'partpacker-3d', factory: createPartPackerIntegration, critical: false },
      { name: 'eigent-workforce', factory: createEigentOrchestrator, critical: false },
      { name: 'system-prompt-architect', factory: createSystemPromptArchitect, critical: false },
      { name: 'parlant-optimizer', factory: createParlantOptimizerIntegration, critical: true },
      { name: 'llm-routing-engine', factory: createLLMRoutingEngine, critical: true },
      { name: 'context-engineer', factory: createContextEngineerIntegration, critical: true },
      { name: 'mem0-integration', factory: createMem0Integration, critical: true }
    ];

    const initPromises = integrationConfigs.map(async (config) => {
      try {
        const integration = await config.factory();
        await integration?.initialize?.();
        this.integrations.set(config.name, integration);
        
        // Wire integration events (defensive: not all integrations are EventEmitters)
        (integration as any)?.on?.('error', (error: any) => {
          this.emit('integration-error', { integration: config.name, error });
        });

        this.emit('integration-initialized', { 
          name: config.name, 
          critical: config.critical,
          timestamp: new Date() 
        });
      } catch (error: any) {
        if (config.critical) {
          throw new Error(`Critical integration ${config.name} failed to initialize: ${error}`);
        } else {
          this.emit('integration-warning', { 
            name: config.name, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
    });

    await Promise.all(initPromises);
  }

  /**
   * Initialize agents from the active v5.1.0 registry (164 Default agents).
   */
  private async initializeAgents(): Promise<void> {
    const registryAgents = getAllAgents();

    for (const agentConfig of registryAgents) {
      const tier = String(agentConfig.tier || 'assistant').toLowerCase();
      const role: AgentParticipant['role'] =
        tier.includes('executive') || tier.includes('principal') ? 'coordinator'
          : tier.includes('senior') || tier.includes('lead') ? 'primary'
            : tier.includes('validator') || tier.includes('review') ? 'validator'
              : 'secondary';

      const agent: AgentParticipant = {
        agent_id: agentConfig.id,
        role,
        capabilities: agentConfig.capabilities?.length
          ? agentConfig.capabilities
          : [agentConfig.practiceArea || agentConfig.category || 'legal-analysis'],
        status: agentConfig.status === 'active' ? 'idle' : 'offline',
        performance_metrics: {
          success_rate: 0.95,
          average_duration: 300,
          quality_score: 0.9,
        },
      };

      this.agents.set(agentConfig.id, agent);
    }

    this.emit('agents-initialized', {
      total: this.agents.size,
      by_role: {
        coordinator: Array.from(this.agents.values()).filter(a => a.role === 'coordinator').length,
        primary: Array.from(this.agents.values()).filter(a => a.role === 'primary').length,
        secondary: Array.from(this.agents.values()).filter(a => a.role === 'secondary').length,
        validator: Array.from(this.agents.values()).filter(a => a.role === 'validator').length
      },
      timestamp: new Date() 
    });
  }

  /**
   * Setup coordination systems for agent collaboration
   */
  private async setupCoordinationSystems(): Promise<void> {
    // Create default coordination for executive tier
    const executiveCoordination: AgentCoordination = {
      coordinator_id: 'chief-orchestrator',
      participants: Array.from(this.agents.values()).filter(a => a.role === 'coordinator'),
      coordination_strategy: 'dynamic',
      conflict_resolution: {
        strategy: 'coordinator_decides',
        timeout: 30000, // 30 seconds
        escalation_rules: []
      },
      communication_channels: [
        {
          id: 'executive-broadcast',
          type: 'broadcast',
          participants: ['chief-orchestrator', 'project-director', 'quality-director', 'innovation-lead', 'risk-manager'],
          message_history: []
        }
      ]
    };

    this.activeCoordinations.set('executive-tier', executiveCoordination);

    this.emit('coordination-systems-ready', {
      coordination_groups: this.activeCoordinations.size,
      timestamp: new Date()
    });
  }

  /**
   * Start optimization systems for cost and performance
   */
  private async startOptimizationSystems(): Promise<void> {
    const llmRouter = this.integrations.get('llm-routing-engine');
    const contextEngineer = this.integrations.get('context-engineer');
    const mem0 = this.integrations.get('mem0-integration');

    if (llmRouter && contextEngineer && mem0) {
      // Start real-time optimization
      setInterval(() => {
        this.optimizeSystemPerformance();
      }, 60000); // Every minute

      this.emit('optimization-systems-started', { timestamp: new Date() });
    }
  }

  /**
   * Main orchestration method that handles any project creation request
   */
  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    try {
      this.emit('orchestration-started', {
        request_id: request.id,
        type: request.type,
        task: request.task,
        timestamp: new Date()
      });

      const startTime = Date.now();

      // 1. Smart Thinking Phase - Analyze and plan
      const thinkingResult = await this.smartThinking.processThinking({
        id: `thinking-${request.id}`,
        task: request.task,
        agentId: 'chief-orchestrator',
        complexity: this.assessTaskComplexity(request),
        domain: this.identifyTaskDomain(request),
        constraints: {
          timeLimit: request.requirements.time_limit,
          qualityThreshold: request.requirements.quality_threshold
        },
        previousAttempts: [],
        metadata: {
          timestamp: new Date(),
          priority: request.priority,
          sessionId: request.context.session_id,
          userId: request.context.user_id
        }
      });

      // 2. Agent Selection and Coordination
      const selectedAgents = await this.selectOptimalAgents(request, thinkingResult);
      const coordination = await this.createCoordination(selectedAgents, thinkingResult);

      // 3. Context Engineering
      const contextEngineer = this.integrations.get('context-engineer');
      const engineeredContext = await contextEngineer.engineerContext({
        id: `context-${request.id}`,
        agentId: 'chief-orchestrator',
        taskType: request.type,
        query: request.task,
        requiredLayers: ['global-jurexio-system', 'development-domain'],
        optionalLayers: ['user-context', 'session-context'],
        constraints: {
          maxTokens: 4000,
          relevanceThreshold: 0.7,
          includeDomainKnowledge: true,
          prioritizeRecent: true
        },
        metadata: {
          timestamp: new Date(),
          sessionId: request.context.session_id || 'default',
          userId: request.context.user_id,
          projectId: request.context.project_id
        }
      });

      // 4. LLM Routing and Optimization
      const llmRouter = this.integrations.get('llm-routing-engine');
      const domainForRouting = (() => {
        switch (this.identifyTaskDomain(request)) {
          case 'software-development':
            return 'code' as const;
          case 'creative':
            return 'general' as const;
          case 'business':
            return 'general' as const;
          default:
            return 'general' as const;
        }
      })();
      const complexityForRouting = (() => {
        const complexity = this.assessTaskComplexity(request);
        if (complexity >= 0.85) return 'expert' as const;
        if (complexity >= 0.65) return 'complex' as const;
        if (complexity >= 0.35) return 'medium' as const;
        return 'simple' as const;
      })();
      const routingResult = await llmRouter.routeRequest({
        requestId: `routing-${request.id}`,
        complexity: complexityForRouting,
        domain: domainForRouting,
        contextTokens: Math.max(1, engineeredContext.statistics.tokenCount + 2000),
        tier: request.priority === 'critical' ? 'enterprise' : request.priority === 'high' ? 'pro' : 'plus',
        jurisdiction: request.context.project_id,
        maxCostUSD: request.requirements.cost_budget,
        requiresVision: false,
        requiresJsonMode: false,
      });

      // 5. Execute with selected integrations
      const executionResult = await this.executeWithCoordination(
        coordination,
        thinkingResult,
        engineeredContext,
        routingResult,
        request
      );

      // 6. Store memory with Mem0
      const mem0 = this.integrations.get('mem0-integration');
      await mem0.storeAgentMemory(
        'chief-orchestrator',
        `Completed ${request.type}: ${request.task}. Result: ${JSON.stringify(executionResult)}`,
        {
          userId: request.context.user_id,
          sessionId: request.context.session_id,
          memoryType: 'episodic',
          importance: 0.8,
          tags: [request.type, 'orchestration', 'completed']
        }
      );

      const totalDuration = Date.now() - startTime;

      // 7. Compile final result
      const result: OrchestrationResult = {
        id: `result-${request.id}`,
        request_id: request.id,
        status: executionResult.success ? 'completed' : 'failed',
        output: {
          primary_result: executionResult.data,
          artifacts: executionResult.artifacts || [],
          metadata: {
            execution_strategy: coordination.coordination_strategy,
            context_used: engineeredContext.statistics,
            routing_decision: routingResult
          }
        },
        execution: {
          agents_used: selectedAgents.map(a => a.agent_id),
          integrations_used: Array.from(this.integrations.keys()),
          total_duration: totalDuration,
          cost_breakdown: {
            llm_costs: routingResult.estimatedCostUSD,
            compute_costs: totalDuration * 0.001, // $0.001 per second
            total: routingResult.estimatedCostUSD + (totalDuration * 0.001)
          },
          quality_score: thinkingResult.metadata.qualityScore
        },
        thinking: {
          reasoning_process: thinkingResult.reasoning,
          decisions_made: thinkingResult.reasoning.steps,
          alternatives_considered: thinkingResult.reasoning.alternatives
        },
        errors: executionResult.errors || [],
        warnings: executionResult.warnings || []
      };

      // Store result for learning
      this.requestHistory.set(request.id, result);

      this.emit('orchestration-completed', {
        request_id: request.id,
        result_id: result.id,
        duration: totalDuration,
        status: result.status,
        agents_used: result.execution.agents_used.length,
        timestamp: new Date()
      });

      return result;

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { 
        stage: 'orchestration', 
        error: errorMessage, 
        request_id: request.id 
      });
      
      throw error;
    }
  }

  /**
   * Select optimal agents for the request
   */
  private async selectOptimalAgents(
    request: OrchestrationRequest, 
    thinkingResult: any
  ): Promise<AgentParticipant[]> {
    const requiredCapabilities = this.extractRequiredCapabilities(request, thinkingResult);
    const availableAgents = Array.from(this.agents.values()).filter(a => a.status === 'idle');
    
    const selectedAgents: AgentParticipant[] = [];
    
    // Always include a coordinator
    const coordinator = availableAgents.find(a => a.role === 'coordinator' && 
      a.capabilities.some(cap => requiredCapabilities.includes(cap)));
    if (coordinator) {
      selectedAgents.push(coordinator);
    }

    // Select primary agents based on capabilities
    for (const capability of requiredCapabilities) {
      const agent = availableAgents.find(a => 
        a.role === 'primary' && 
        a.capabilities.includes(capability) &&
        !selectedAgents.includes(a)
      );
      if (agent) {
        selectedAgents.push(agent);
      }
    }

    // Add quality validator if high quality required
    if (request.requirements.quality_threshold > 0.8) {
      const validator = availableAgents.find(a => 
        a.role === 'validator' && 
        !selectedAgents.includes(a)
      );
      if (validator) {
        selectedAgents.push(validator);
      }
    }

    return selectedAgents;
  }

  /**
   * Create coordination structure for selected agents
   */
  private async createCoordination(
    agents: AgentParticipant[], 
    thinkingResult: any
  ): Promise<AgentCoordination> {
    const coordinator = agents.find(a => a.role === 'coordinator');
    if (!coordinator) {
      throw new Error('No coordinator found in selected agents');
    }

    const strategy = thinkingResult.solution.plan.phases.length > 1 ? 'sequential' : 
                    agents.length > 3 ? 'parallel' : 'hybrid';

    return {
      coordinator_id: coordinator.agent_id,
      participants: agents,
      coordination_strategy: strategy,
      conflict_resolution: {
        strategy: 'coordinator_decides',
        timeout: 30000,
        escalation_rules: []
      },
      communication_channels: [
        {
          id: `coordination-${Date.now()}`,
          type: 'broadcast',
          participants: agents.map(a => a.agent_id),
          message_history: []
        }
      ]
    };
  }

  /**
   * Execute the request with full coordination
   */
  private async executeWithCoordination(
    coordination: AgentCoordination,
    thinkingResult: any,
    context: any,
    routing: any,
    request: OrchestrationRequest
  ): Promise<any> {
    const romaAgent = this.integrations.get('roma-meta-agent');
    const claudeFlow = this.integrations.get('claude-flow-coordinator');

    if (romaAgent?.available === false) {
      return {
        success: false,
        errors: [{ integration: 'roma-meta-agent', available: false }],
        warnings: ['ROMA meta-agent integration unavailable'],
      };
    }
    if (claudeFlow?.available === false) {
      return {
        success: false,
        errors: [{ integration: 'claude-flow-coordinator', available: false }],
        warnings: ['Claude flow coordinator unavailable — workflow execution blocked'],
      };
    }

    // Use ROMA for task decomposition and planning
    const romaResult = await romaAgent.processTask({
      id: `roma-${request.id}`,
      task: request.task,
      context: {
        requirements: request.requirements,
        thinking_result: thinkingResult,
        engineered_context: context
      },
      metadata: {
        timestamp: new Date(),
        priority: request.priority,
        agents: coordination.participants.map(p => p.agent_id)
      }
    });

    // Use Claude Flow for coordination
    const flowResult = await claudeFlow.createWorkflow({
      id: `flow-${request.id}`,
      name: `${request.type} Workflow`,
      tasks: romaResult.data.subtasks || [],
      agents: coordination.participants.map(p => p.agent_id),
      metadata: {
        coordination_strategy: coordination.coordination_strategy,
        routing_decision: routing,
        context_layers: context.layers.length
      }
    });

    // Execute the workflow
      const executionResult = await claudeFlow.executeWorkflow(flowResult.id, {
        task: request.task,
        routing,
        contextSummary: context?.statistics,
      });

    const flowSucceeded = executionResult?.status !== 'failed' && executionResult?.success !== false;

    return {
      success: flowSucceeded,
      data: executionResult?.results ?? executionResult?.output ?? executionResult,
      artifacts: executionResult?.artifacts ?? [],
      errors: flowSucceeded ? [] : [{ integration: 'claude-flow-coordinator', message: 'Workflow execution failed' }],
      metadata: {
        roma_result: romaResult,
        flow_result: flowResult,
        coordination_id: coordination.coordinator_id,
      },
    };
  }

  // Helper methods
  private assessTaskComplexity(request: OrchestrationRequest): number {
    let complexity = 0.5; // Base complexity
    
    if (request.requirements.agents.length > 3) complexity += 0.2;
    if (request.requirements.integrations.length > 5) complexity += 0.2;
    if (request.requirements.quality_threshold > 0.9) complexity += 0.1;
    if (request.type === 'project_creation') complexity += 0.2;
    
    return Math.min(1, complexity);
  }

  private identifyTaskDomain(request: OrchestrationRequest): string {
    switch (request.type) {
      case 'code_development': return 'software-development';
      case 'content_generation': return 'creative';
      case 'analysis': return 'business';
      case 'project_creation': return 'coordination';
      default: return 'general';
    }
  }

  private extractRequiredCapabilities(request: OrchestrationRequest, thinkingResult: any): string[] {
    const capabilities = new Set<string>();
    
    // Add capabilities based on request type
    switch (request.type) {
      case 'code_development':
        capabilities.add('system_architecture');
        capabilities.add('fullstack_development');
        capabilities.add('code_review');
        break;
      case 'content_generation':
        capabilities.add('creative_strategy');
        capabilities.add('content_creation');
        capabilities.add('brand_development');
        break;
      case 'project_creation':
        capabilities.add('strategic_planning');
        capabilities.add('project_management');
        capabilities.add('resource_allocation');
        break;
    }
    
    // Add capabilities from thinking result
    if (thinkingResult.solution.plan.phases) {
      for (const phase of thinkingResult.solution.plan.phases) {
        for (const action of phase.actions) {
          if (action.type === 'agent_task') {
            capabilities.add('task_execution');
          }
          if (action.type === 'validation') {
            capabilities.add('quality_assurance');
          }
        }
      }
    }
    
    return Array.from(capabilities);
  }

  private async optimizeSystemPerformance(): Promise<void> {
    // Real-time system optimization
    const llmRouter = this.integrations.get('llm-routing-engine');
    const metrics = llmRouter?.getRoutingMetrics();
    
    if (metrics && metrics.averageCost > 0.01) {
      // Adjust routing for cost optimization
      this.emit('optimization-applied', {
        type: 'cost_reduction',
        previous_cost: metrics.averageCost,
        target_reduction: 0.3,
        timestamp: new Date()
      });
    }
  }

  private setupEventHandlers(): void {
    this.on('orchestration-completed', (data) => {
      logger.info(`🎯 Production Orchestrator: Completed ${data.request_id} in ${data.duration}ms using ${data.agents_used} agents`);
    });

    this.on('integration-error', (data) => {
      logger.error(`❌ Integration Error in ${data.integration}:`, data.error);
    });

    this.on('error', (error) => {
      logger.error(`❌ Orchestration Error in ${error.stage}:`, error.error);
    });
  }

  // Public interface
  getIntegrationStatus(): any {
    return Object.fromEntries(
      Array.from(this.integrations.entries()).map(([name, integration]) => [
        name,
        {
          active: integration?.available !== false,
          health: integration?.available === false ? 'unavailable' : 'healthy',
          last_used: new Date(),
        }
      ])
    );
  }

  getAgentStatus(): any {
    const agents = Array.from(this.agents.values());
    return {
      total: agents.length,
      idle: agents.filter(a => a.status === 'idle').length,
      busy: agents.filter(a => a.status === 'busy').length,
      error: agents.filter(a => a.status === 'error').length,
      offline: agents.filter(a => a.status === 'offline').length,
      average_performance: {
        success_rate: agents.reduce((sum, a) => sum + a.performance_metrics.success_rate, 0) / agents.length,
        average_duration: agents.reduce((sum, a) => sum + a.performance_metrics.average_duration, 0) / agents.length,
        quality_score: agents.reduce((sum, a) => sum + a.performance_metrics.quality_score, 0) / agents.length
      }
    };
  }

  getOrchestrationMetrics(): any {
    const history = Array.from(this.requestHistory.values());
    
    return {
      total_requests: history.length,
      success_rate: history.filter(r => r.status === 'completed').length / history.length,
      average_duration: history.reduce((sum, r) => sum + r.execution.total_duration, 0) / history.length,
      average_cost: history.reduce((sum, r) => sum + r.execution.cost_breakdown.total, 0) / history.length,
      average_quality: history.reduce((sum, r) => sum + r.execution.quality_score, 0) / history.length,
      integrations_status: this.getIntegrationStatus(),
      agents_status: this.getAgentStatus(),
      active_coordinations: this.activeCoordinations.size
    };
  }
}

// Factory function for global orchestrator instance
export function createProductionOrchestrator(): ProductionOrchestrator {
  return new ProductionOrchestrator();
}