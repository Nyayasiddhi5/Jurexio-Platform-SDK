export type OrchestrationSession = {
  id: string;
  userId: string;
  agentId: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
};
export type AgentExecution = {
  id: string;
  sessionId: string;
  input: unknown;
  output: unknown;
  tokensUsed: number;
  latencyMs: number;
};
