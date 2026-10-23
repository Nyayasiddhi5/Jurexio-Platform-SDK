import { Router } from 'express';
export type AgentTeam = { id: string; name: string; agents: string[] };
export type AgentTeamMember = { agentId: string; role: string };
export type TeamSelectionCriteria = { task: string; jurisdiction?: string; language?: string };
export type TeamSelectionResult = { team: AgentTeam; confidence: number };
export const PREDEFINED_TEAMS: AgentTeam[] = [];
export class TeamSelector {
  async select(criteria: TeamSelectionCriteria): Promise<TeamSelectionResult> {
    return { team: { id: 'default', name: 'Default Team', agents: [] }, confidence: 1.0 };
  }
}
export const teamSelector = new TeamSelector();
