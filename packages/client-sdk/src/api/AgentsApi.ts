/**
 * AgentsApi — ROMA L5 agent management and execution for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/skills/*, /api/jrx/digital-twin/*, /api/jrx/agents/*
 */

import type {
  NyvAgent,
  NyvAgentExecution,
  NyvListResponse,
  NyvPaginationOptions,
  NyvJurisdiction,
  NyvAgentPattern,
} from '../types/index.js';
import type { NyvHttpClient } from '../NyvClient.js';

export interface AgentRunRequest {
  agentId: string;
  task: string;
  jurisdiction?: NyvJurisdiction;
  context?: Record<string, unknown>;
  pattern?: NyvAgentPattern;
  maxIterations?: number;
}

export interface AgentSkillInstallRequest {
  agentId: string;
  skillId: string;
  configuration?: Record<string, unknown>;
}

export type AgentExecuteType = 'code' | 'research' | 'creative' | 'analysis' | 'general';

export interface AgentExecuteRequest {
  task: string;
  /** Optional routing hint; the Queen still enforces capability/tier gating. */
  agentId?: string;
  type?: AgentExecuteType;
  jurisdiction?: NyvJurisdiction;
  format?: string;
  sessionId?: string;
}

export interface AgentRunMetrics {
  duration: number;
  tokensUsed: number;
  tokensIn?: number;
  tokensOut?: number;
  cost: number;
  pattern?: string;
  agentsUsed?: number;
}

export interface AgentExecuteResult {
  executionId?: string;
  agentId: string | null;
  status: 'completed' | 'failed';
  result: {
    task: string;
    output: string;
    agentsUsed: Array<{ agentId: string; agentName: string; status: string }>;
    metrics: AgentRunMetrics;
  };
}

export type OrchestrationStrategy =
  | 'parallel'
  | 'sequential'
  | 'swarm'
  | 'hierarchical'
  | 'dag'
  | 'single';

export interface AgentOrchestrateRequest {
  task: string;
  strategy?: OrchestrationStrategy;
  /** Optional preferred agent ids; length hints max-agents to the Queen. */
  agents?: string[];
  type?: AgentExecuteType;
  jurisdiction?: NyvJurisdiction;
  sessionId?: string;
}

export interface AgentOrchestrateResult {
  orchestrationId?: string;
  task: string;
  strategy: string;
  status: 'completed' | 'failed';
  agents: string[];
  results: Array<{ agentId: string; agentName: string; status: string; output: string }>;
  synthesizedOutput: string;
  metrics: AgentRunMetrics;
}

export class AgentsApi {
  constructor(private readonly http: NyvHttpClient) {}

  /** List all available ROMA L5 agents */
  list(pagination: NyvPaginationOptions = {}): Promise<NyvListResponse<NyvAgent>> {
    const params = new URLSearchParams();
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/agents?${params}`);
  }

  /** Get a specific agent by ID */
  get(agentId: string): Promise<NyvAgent> {
    return this.http.get(`/api/jrx/agents/${agentId}`);
  }

  /** Run an agent with a task (async execution) */
  run(req: AgentRunRequest): Promise<NyvAgentExecution> {
    return this.http.post('/api/jrx/agents/run', req);
  }

  /**
   * NV-AGENT-EXEC-REAL-001 — synchronous single-agent execution through the Queen
   * orchestrator. Returns the actual synthesized output + real token/cost metrics.
   * `POST /api/jrx/agents/execute`.
   */
  execute(req: AgentExecuteRequest): Promise<AgentExecuteResult> {
    return this.http.post('/api/jrx/agents/execute', req);
  }

  /**
   * NV-AGENT-EXEC-REAL-001 — real multi-agent orchestration through the Queen.
   * `strategy` maps to a Queen orchestration mode (parallel / sequential / swarm /
   * hierarchical / dag / single). `POST /api/jrx/agents/orchestrate`.
   */
  orchestrate(req: AgentOrchestrateRequest): Promise<AgentOrchestrateResult> {
    return this.http.post('/api/jrx/agents/orchestrate', req);
  }

  /** Poll execution status */
  getExecution(executionId: string): Promise<NyvAgentExecution> {
    return this.http.get(`/api/jrx/agents/executions/${executionId}`);
  }

  /** Wait for an execution to complete */
  async waitForExecution(
    executionId: string,
    { intervalMs = 1000, timeoutMs = 60_000 } = {}
  ): Promise<NyvAgentExecution> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exec = await this.getExecution(executionId);
      if (exec.status === 'completed' || exec.status === 'failed') return exec;
      await sleep(intervalMs);
    }
    throw new Error(`Execution ${executionId} did not complete within ${timeoutMs}ms`);
  }

  /** List agent executions for the current org */
  listExecutions(
    agentId?: string,
    pagination: NyvPaginationOptions = {}
  ): Promise<NyvListResponse<NyvAgentExecution>> {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/agents/executions?${params}`);
  }

  /** Install a skill on an agent */
  installSkill(req: AgentSkillInstallRequest): Promise<{ success: boolean; message: string }> {
    return this.http.post('/api/jrx/skills/install', req);
  }

  /** Uninstall a skill from an agent */
  uninstallSkill(agentId: string, skillId: string): Promise<{ success: boolean }> {
    return this.http.delete(`/api/jrx/skills/${skillId}/agents/${agentId}`);
  }

  /** Get skills installed on an agent */
  getInstalledSkills(agentId: string): Promise<{ skills: Array<{ skillId: string; name: string; status: string }> }> {
    return this.http.get(`/api/jrx/agents/${agentId}/skills`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
