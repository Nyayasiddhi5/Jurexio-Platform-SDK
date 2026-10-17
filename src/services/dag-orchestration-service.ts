/**
 * DAG-Based Orchestration Service
 * 
 * Implements parallel processing with:
 * - Directed Acyclic Graph task dependency management
 * - Context window budgeting across parallel agents
 * - Topological sorting for execution order
 * - Parallel execution with shared context propagation
 */

import { EventEmitter } from 'events';
import { hierarchicalTaskAllocator, type TaskAllocation, type Coalition } from './hierarchical-task-allocator.js';
import { createLogger } from '../utils/logger.js';
import { capabilityManifest, type CapabilityContext, type CapabilityTier } from '../orchestration/capability-manifest.js';
import {
  getPolicyForTier,
  runWithConcurrency,
  evaluateFailures,
  distributeContextBudget,
  defaultSynthesize,
  type ExecutionPolicy,
} from '../orchestration/orchestration-policy.js';


const logger = createLogger('dag-orchestration-service');

/**
 * Pluggable executor signature. When bound, replaces the simulated
 * executeNode body. Returns the per-node output + token usage so the
 * service can keep its existing aggregation contract.
 */
export type DAGNodeExecutor = (
  node: DAGNode,
  ctx: { previousResults: Map<string, any>; planId: string; planName: string; capabilityCtx: CapabilityContext },
) => Promise<{ output: any; tokensUsed?: { input: number; output: number } }>;

/**
 * Default executor: invoke a capability via the manifest. Node `name` is
 * interpreted as `<capabilityId>` (e.g. `rag.search`) when it matches a
 * registered id; otherwise falls back to the simulated behavior.
 */
export const capabilityManifestExecutor: DAGNodeExecutor = async (node, ctx) => {
  const candidate = capabilityManifest.get(node.name);
  if (candidate) {
    const result = await capabilityManifest.invoke(node.name, { fromDAG: true, deps: Array.from(ctx.previousResults.entries()) }, ctx.capabilityCtx);
    return {
      output: result,
      tokensUsed: { input: node.contextBudget.inputTokens, output: node.contextBudget.outputTokens },
    };
  }
  // JRX-DAG-FAIL-LOUD-001 (Task #32): unknown capability id is a structured
  // failure. In production, fail loud (throw) so the branch fan-in records
  // a real error rather than silently masking it with a synthetic success.
  // In non-prod, surface a structured error object (no `fallback: true`) so
  // tests can assert on it and developers see the misconfiguration.
  const message = `[capabilityManifestExecutor] no capability registered for node.name="${node.name}" (nodeId=${node.id}). ` +
    `Either register the capability or set node.name to a registered manifest id.`;
  if (process.env.NODE_ENV === 'production') {
    logger.error({
      msg: 'unknown capability id in PROD — refusing synthetic placeholder',
      nodeId: node.id, nodeName: node.name, planId: ctx.planId,
    });
    throw new Error(message);
  }
  logger.warn({ msg: 'unknown capability id (non-prod) — returning structured failure', nodeId: node.id, nodeName: node.name });
  return {
    output: { nodeId: node.id, error: 'capability-not-registered', capability: node.name, success: false },
    tokensUsed: { input: 0, output: 0 },
  };
};

export interface DAGNode {
  id: string;
  taskId: string;
  name: string;
  dependencies: string[];
  allocation?: TaskAllocation;
  status: 'pending' | 'ready' | 'executing' | 'completed' | 'failed';
  result?: any;
  startTime?: Date;
  endTime?: Date;
  contextBudget: {
    inputTokens: number;
    outputTokens: number;
    maxTokens: number;
  };
}

export interface DAGExecutionPlan {
  id: string;
  name: string;
  nodes: Map<string, DAGNode>;
  edges: Map<string, string[]>;
  executionLevels: string[][];
  totalContextBudget: number;
  estimatedDuration: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ContextBudget {
  totalTokens: number;
  usedTokens: number;
  reservedTokens: number;
  availableTokens: number;
  budgetPerAgent: Map<string, number>;
}

export interface ParallelExecutionResult {
  planId: string;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  parallelizationFactor: number;
  totalDuration: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  nodeResults: Map<string, any>;
}

class DAGOrchestrationService extends EventEmitter {
  private executionPlans: Map<string, DAGExecutionPlan> = new Map();
  private contextBudgets: Map<string, ContextBudget> = new Map();
  private maxConcurrentNodes = 5;
  private executor: DAGNodeExecutor | null = null;
  private tier: CapabilityTier = 'lite';
  private capabilityCtxDefaults: CapabilityContext = {};

  constructor() {
    super();
    logger.info('🔗 DAG Orchestration Service initialized with parallel execution support');
  }

  /** Bind a real executor (Queen does this on init). Falls back to simulation otherwise. */
  bindExecutor(fn: DAGNodeExecutor | null): void {
    this.executor = fn;
  }

  /** Use the manifest-based executor — single call from Queen / SDK auto-init. */
  bindCapabilityManifestExecutor(): void {
    this.executor = capabilityManifestExecutor;
  }

  /** Set the tier driving the policy (concurrency cap, partial-failure tolerance). */
  setTier(tier: CapabilityTier): void {
    this.tier = tier;
    const policy = getPolicyForTier(tier);
    this.maxConcurrentNodes = policy.maxConcurrentNodes;
  }

  /** Provide default context (userId/tenantId/jurisdiction) used by the manifest. */
  setCapabilityContextDefaults(ctx: CapabilityContext): void {
    this.capabilityCtxDefaults = ctx;
  }

  async createExecutionPlan(
    planId: string,
    planName: string,
    tasks: Array<{
      id: string;
      name: string;
      dependencies: string[];
      estimatedTokens?: number;
    }>,
    totalContextBudget: number = 500000
  ): Promise<DAGExecutionPlan> {
    const nodes = new Map<string, DAGNode>();
    const edges = new Map<string, string[]>();
    
    if (!this.validateDAG(tasks)) {
      throw new Error('Invalid DAG: Cycle detected in task dependencies');
    }
    
    const tokenBudgetPerTask = Math.floor(totalContextBudget / tasks.length);
    
    for (const task of tasks) {
      const node: DAGNode = {
        id: task.id,
        taskId: task.id,
        name: task.name,
        dependencies: task.dependencies,
        status: 'pending',
        contextBudget: {
          inputTokens: task.estimatedTokens || tokenBudgetPerTask * 0.4,
          outputTokens: task.estimatedTokens || tokenBudgetPerTask * 0.6,
          maxTokens: tokenBudgetPerTask
        }
      };
      nodes.set(task.id, node);
      edges.set(task.id, task.dependencies);
    }
    
    const executionLevels = this.computeExecutionLevels(nodes, edges);
    
    const plan: DAGExecutionPlan = {
      id: planId,
      name: planName,
      nodes,
      edges,
      executionLevels,
      totalContextBudget,
      estimatedDuration: this.estimateDuration(executionLevels, nodes),
      status: 'planning',
      createdAt: new Date()
    };
    
    this.executionPlans.set(planId, plan);
    
    this.initializeContextBudget(planId, totalContextBudget, nodes);
    
    logger.info(`📋 Created DAG execution plan: ${planName}`);
    logger.info(`   Nodes: ${nodes.size}, Levels: ${executionLevels.length}`);
    logger.info(`   Parallelization: ${Math.max(...executionLevels.map(l => l.length))} concurrent tasks`);
    
    this.emit('plan:created', plan);
    
    return plan;
  }

  private validateDAG(tasks: Array<{ id: string; dependencies: string[] }>): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    
    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      
      visited.add(nodeId);
      recursionStack.add(nodeId);
      
      const task = taskMap.get(nodeId);
      if (task) {
        for (const dep of task.dependencies) {
          if (hasCycle(dep)) return true;
        }
      }
      
      recursionStack.delete(nodeId);
      return false;
    };
    
    for (const task of tasks) {
      if (hasCycle(task.id)) return false;
    }
    
    return true;
  }

  private computeExecutionLevels(
    nodes: Map<string, DAGNode>,
    edges: Map<string, string[]>
  ): string[][] {
    const levels: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(nodes.keys());
    
    while (remaining.size > 0) {
      const currentLevel: string[] = [];
      
      for (const nodeId of remaining) {
        const node = nodes.get(nodeId)!;
        const allDepsCompleted = node.dependencies.every(dep => completed.has(dep));
        
        if (allDepsCompleted) {
          currentLevel.push(nodeId);
        }
      }
      
      if (currentLevel.length === 0 && remaining.size > 0) {
        throw new Error('Unable to compute execution levels: possible cycle or missing dependency');
      }
      
      levels.push(currentLevel);
      currentLevel.forEach(id => {
        remaining.delete(id);
        completed.add(id);
      });
    }
    
    return levels;
  }

  private estimateDuration(levels: string[][], nodes: Map<string, DAGNode>): number {
    let totalDuration = 0;
    
    for (const level of levels) {
      const maxLevelDuration = Math.max(
        ...level.map(nodeId => {
          const node = nodes.get(nodeId)!;
          return (node.contextBudget.inputTokens + node.contextBudget.outputTokens) / 1000 * 100;
        })
      );
      totalDuration += maxLevelDuration;
    }
    
    return totalDuration;
  }

  private initializeContextBudget(
    planId: string,
    totalTokens: number,
    nodes: Map<string, DAGNode>
  ): void {
    const budgetPerAgent = new Map<string, number>();
    const tokensPerNode = Math.floor(totalTokens / nodes.size);
    
    nodes.forEach((node, id) => {
      budgetPerAgent.set(id, tokensPerNode);
    });
    
    const budget: ContextBudget = {
      totalTokens,
      usedTokens: 0,
      reservedTokens: 0,
      availableTokens: totalTokens,
      budgetPerAgent
    };
    
    this.contextBudgets.set(planId, budget);
  }

  async executePlan(planId: string): Promise<ParallelExecutionResult> {
    const plan = this.executionPlans.get(planId);
    if (!plan) {
      throw new Error(`Execution plan ${planId} not found`);
    }
    
    plan.status = 'executing';
    plan.startedAt = new Date();
    this.emit('plan:started', plan);
    
    const nodeResults = new Map<string, any>();
    let completedNodes = 0;
    let failedNodes = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Policy-driven parallelism + failure handling + budget redistribution
    const policy: ExecutionPolicy = getPolicyForTier(this.tier);
    const allNodeIds = Array.from(plan.nodes.keys());
    const distributedBudget = distributeContextBudget(policy, allNodeIds);
    for (const [nodeId, share] of distributedBudget) {
      const node = plan.nodes.get(nodeId);
      if (node) node.contextBudget.maxTokens = Math.max(node.contextBudget.maxTokens, share);
    }
    
    let halted = false;
    try {
      for (const level of plan.executionLevels) {
        if (halted) break;
        logger.info(`⚡ Executing level with ${level.length} parallel tasks (cap=${policy.maxConcurrentNodes}, tier=${this.tier})`);
        
        const levelOutcomes = await runWithConcurrency(
          level,
          async (nodeId) => {
            const node = plan.nodes.get(nodeId)!;
            node.status = 'executing';
            node.startTime = new Date();
            try {
              const result = await this.executeNode(node, nodeResults, plan);
              node.status = 'completed';
              node.result = result;
              node.endTime = new Date();
              nodeResults.set(nodeId, result);
              completedNodes++;
              totalInputTokens += result.tokensUsed?.input || 0;
              totalOutputTokens += result.tokensUsed?.output || 0;
              this.emit('node:completed', { planId, nodeId, result });
              return { nodeId, success: true, result };
            } catch (error: any) {
              node.status = 'failed';
              node.endTime = new Date();
              failedNodes++;
              this.emit('node:failed', { planId, nodeId, error });
              return { nodeId, success: false, error };
            }
          },
          { concurrency: Math.min(policy.maxConcurrentNodes, level.length), timeoutMs: policy.perNodeTimeoutMs },
        );
        
        // Account for runner-level errors (timeouts) as failures too
        for (const outcome of levelOutcomes) {
          if (outcome.error) failedNodes++;
        }

        const decision = evaluateFailures(policy, failedNodes, completedNodes + failedNodes);
        if (decision.halt) {
          halted = true;
          logger.warn(`🛑 DAG halted by policy: ${decision.reason}`);
          this.emit('plan:halted', { planId, reason: decision.reason, completedNodes, failedNodes });
          break;
        }
      }
      
      plan.status = (failedNodes === 0) ? 'completed' : (halted ? 'failed' : 'completed');
    } catch (error: any) {
      plan.status = 'failed';
      throw error;
    } finally {
      plan.completedAt = new Date();
      this.emit('plan:completed', plan);
    }

    // Optional fan-in synthesis — non-fatal, attached to nodeResults
    if (policy.enableSynthesis && completedNodes > 0) {
      try {
        const parts: Array<{ key: string; output: string }> = [];
        for (const [k, v] of nodeResults) parts.push({ key: k, output: typeof v?.output === 'string' ? v.output : JSON.stringify(v?.output ?? v) });
        const synth = defaultSynthesize(parts);
        nodeResults.set('__synthesis__', { output: synth, synthesized: true });
      } catch (e: any) {
        logger.warn('[DAG] synthesis skipped', { error: e?.message });
      }
    }
    
    const totalDuration = plan.completedAt.getTime() - plan.startedAt.getTime();
    const parallelizationFactor = Math.max(...plan.executionLevels.map(l => l.length));
    
    return {
      planId,
      totalNodes: plan.nodes.size,
      completedNodes,
      failedNodes,
      parallelizationFactor,
      totalDuration,
      tokenUsage: {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens
      },
      nodeResults
    };
  }

  private async executeNode(
    node: DAGNode,
    previousResults: Map<string, any>,
    plan: DAGExecutionPlan
  ): Promise<any> {
    const dependencyResults = node.dependencies.map(depId => ({
      id: depId,
      result: previousResults.get(depId)
    }));
    
    const contextWindow = this.buildContextWindow(node, dependencyResults);
    
    const budget = this.contextBudgets.get(plan.id);
    if (budget) {
      const nodeBudget = budget.budgetPerAgent.get(node.id) || 0;
      if (contextWindow.length > nodeBudget) {
        logger.warn(`⚠️ Node ${node.id} context exceeds budget, truncating`);
      }
    }
    
    let outOutput: any;
    let outTokens: { input: number; output: number } | undefined;
    if (this.executor) {
      const r = await this.executor(node, {
        previousResults: previousResults,
        planId: plan.id,
        planName: plan.name,
        capabilityCtx: { ...this.capabilityCtxDefaults, tier: this.tier, agentKey: node.allocation?.assignedAgent },
      });
      outOutput = r.output;
      outTokens = r.tokensUsed;
    } else {
      // Simulated default — kept so legacy callers without a bound executor work
      await new Promise(resolve => setTimeout(resolve, 120));
      outOutput = `Processed ${node.name} with ${dependencyResults.length} dependencies`;
    }
    
    const result = {
      nodeId: node.id,
      output: outOutput,
      tokensUsed: outTokens ?? {
        input: Math.floor(node.contextBudget.inputTokens * 0.92),
        output: Math.floor(node.contextBudget.outputTokens * 0.88)
      },
      completedAt: new Date()
    };
    
    return result;
  }

  private buildContextWindow(
    node: DAGNode,
    dependencyResults: Array<{ id: string; result: any }>
  ): string {
    let context = `Task: ${node.name}\n\n`;
    
    if (dependencyResults.length > 0) {
      context += 'Dependency Results:\n';
      dependencyResults.forEach(dep => {
        context += `- ${dep.id}: ${JSON.stringify(dep.result?.output || 'pending')}\n`;
      });
    }
    
    return context;
  }

  getExecutionPlan(planId: string): DAGExecutionPlan | undefined {
    return this.executionPlans.get(planId);
  }

  getAllPlans(): DAGExecutionPlan[] {
    return Array.from(this.executionPlans.values());
  }

  async cancelPlan(planId: string): Promise<void> {
    const plan = this.executionPlans.get(planId);
    if (plan && plan.status === 'executing') {
      plan.status = 'cancelled';
      plan.completedAt = new Date();
      this.emit('plan:cancelled', plan);
    }
  }

  getContextBudget(planId: string): ContextBudget | undefined {
    return this.contextBudgets.get(planId);
  }

  reallocateContextBudget(planId: string, nodeId: string, additionalTokens: number): boolean {
    const budget = this.contextBudgets.get(planId);
    if (!budget || additionalTokens > budget.availableTokens) {
      return false;
    }
    
    const currentBudget = budget.budgetPerAgent.get(nodeId) || 0;
    budget.budgetPerAgent.set(nodeId, currentBudget + additionalTokens);
    budget.reservedTokens += additionalTokens;
    budget.availableTokens -= additionalTokens;
    
    return true;
  }

  getOrchestrationStats(): {
    totalPlans: number;
    activePlans: number;
    completedPlans: number;
    failedPlans: number;
    averageParallelization: number;
  } {
    const plans = this.getAllPlans();
    
    return {
      totalPlans: plans.length,
      activePlans: plans.filter(p => p.status === 'executing').length,
      completedPlans: plans.filter(p => p.status === 'completed').length,
      failedPlans: plans.filter(p => p.status === 'failed').length,
      averageParallelization: plans.length > 0 
        ? plans.reduce((sum, p) => sum + Math.max(...p.executionLevels.map(l => l.length)), 0) / plans.length
        : 0
    };
  }
}

export const dagOrchestrationService = new DAGOrchestrationService();
export { DAGOrchestrationService };
