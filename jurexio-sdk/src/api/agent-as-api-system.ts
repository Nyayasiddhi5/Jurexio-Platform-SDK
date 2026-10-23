export class AgentAsAPISystem {
  constructor(private orchestrator: any, private llmService: any) {}
  async expose(agentId: string): Promise<{ endpoint: string }> {
    return { endpoint: `/api/jrx/agents/${agentId}` };
  }
}
