export type AgentTier = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type CoordinationMode = 'sequential' | 'parallel' | 'hierarchical';
export type CommunicationProtocol = 'direct' | 'broadcast' | 'pipeline';
export type HierarchyAgent = { id: string; tier: AgentTier; capabilities: string[] };
export type HierarchyNode = { agent: HierarchyAgent; children: HierarchyNode[] };
export type TaskDelegation = { fromAgentId: string; toAgentId: string; task: string };
export type CoordinationRequest = { rootTask: string; agents: HierarchyAgent[]; mode: CoordinationMode };
export type CoordinationResult = { success: boolean; delegations: TaskDelegation[]; latencyMs: number };
export class AgentHierarchyCoordinator {
  async coordinate(req: CoordinationRequest): Promise<CoordinationResult> {
    return { success: true, delegations: [], latencyMs: 0 };
  }
}
export const agentHierarchyCoordinator = new AgentHierarchyCoordinator();
