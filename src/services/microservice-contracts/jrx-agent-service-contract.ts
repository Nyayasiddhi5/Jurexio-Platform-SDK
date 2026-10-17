import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-agent-service-contract');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface AgentExecutionInput {
  agentId: string;
  query: string;
  context?: string;
  jurisdiction: JurisdictionCode;
  userId: string;
  sessionId?: string;
}

interface AgentExecutionResult {
  response: string;
  agentId: string;
  citations: string[];
  confidence: number;
  tokens: { input: number; output: number };
  latencyMs: number;
  traceId: string;
}

interface AgentConfigInput {
  agentId: string;
  config: Record<string, unknown>;
}

interface AgentHealthStatus {
  agentId: string;
  status: 'active' | 'hibernating' | 'error';
  lastExecuted: Date | null;
  totalExecutions: number;
  averageLatencyMs: number;
}

interface AgentScorecard {
  agentId: string;
  accuracy: number;
  citationQuality: number;
  biasScore: number;
  latencyP99: number;
  overallPass: boolean;
}

export interface NvAgentServiceContract {
  executeAgent(input: AgentExecutionInput): Promise<AgentExecutionResult>;
  getAgentHealth(agentId: string): Promise<AgentHealthStatus>;
  updateAgentConfig(input: AgentConfigInput): Promise<void>;
  getAgentScorecard(agentId: string): Promise<AgentScorecard>;
}

export class NvAgentServiceAdapter implements NvAgentServiceContract {
  async executeAgent(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    logger.info({ method: 'executeAgent', agentId: input.agentId, jurisdiction: input.jurisdiction });
    return {
      response: `[Agent ${input.agentId} response placeholder]`,
      agentId: input.agentId,
      citations: [],
      confidence: 0.85,
      tokens: { input: 500, output: 200 },
      latencyMs: 250,
      traceId: `trace-${Date.now()}`,
    };
  }

  async getAgentHealth(agentId: string): Promise<AgentHealthStatus> {
    return {
      agentId,
      status: 'active',
      lastExecuted: null,
      totalExecutions: 0,
      averageLatencyMs: 0,
    };
  }

  async updateAgentConfig(input: AgentConfigInput): Promise<void> {
    logger.info({ method: 'updateAgentConfig', agentId: input.agentId });
  }

  async getAgentScorecard(agentId: string): Promise<AgentScorecard> {
    return {
      agentId,
      accuracy: 0,
      citationQuality: 0,
      biasScore: 0,
      latencyP99: 0,
      overallPass: false,
    };
  }
}

export const HTTP_CONTRACT = {
  serviceName: 'NYV-AGENT-SERVICE',
  baseUrl: '/api/jrx/agent-service',
  endpoints: [
    { method: 'POST', path: '/execute', handler: 'executeAgent' },
    { method: 'GET', path: '/health/:agentId', handler: 'getAgentHealth' },
    { method: 'PUT', path: '/config', handler: 'updateAgentConfig' },
    { method: 'GET', path: '/scorecard/:agentId', handler: 'getAgentScorecard' },
  ],
} as const;

export const GRPC_CONTRACT = {
  serviceName: 'NvAgentService',
  package: 'nyv.agent.v1',
  methods: [
    { name: 'ExecuteAgent', requestType: 'AgentExecutionRequest', responseType: 'AgentExecutionResponse' },
    { name: 'GetAgentHealth', requestType: 'AgentIdRequest', responseType: 'AgentHealthResponse' },
    { name: 'UpdateAgentConfig', requestType: 'AgentConfigRequest', responseType: 'Empty' },
    { name: 'GetAgentScorecard', requestType: 'AgentIdRequest', responseType: 'AgentScorecardResponse' },
  ],
} as const;
