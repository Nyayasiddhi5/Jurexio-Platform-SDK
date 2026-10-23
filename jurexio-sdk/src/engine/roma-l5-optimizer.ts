import type { AgentV3 } from '../schemas/agent-schema-v3-roma5.js';

interface OptimizationReport {
  totalInput: number;
  duplicatesRemoved: number;
  hierarchyLoopsFix: string[];
  complianceFlagsSet: number;
  agentsUpgradedToL5: number;
  finalCount: number;
  valid: boolean;
}

export class RomaL5Optimizer {
  deduplicateAgents(agents: AgentV3[]): { agents: AgentV3[]; removed: string[] } {
    const seen = new Map<string, boolean>();
    const deduped: AgentV3[] = [];
    const removed: string[] = [];

    for (const agent of agents) {
      const key = `${agent.module}::${agent.roleDelta}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        deduped.push(agent);
      } else {
        removed.push(agent.id);
      }
    }

    return { agents: deduped, removed };
  }

  fixHierarchyLoops(agents: AgentV3[]): { agents: AgentV3[]; fixes: string[] } {
    const fixes: string[] = [];
    const agentIds = new Set(agents.map(a => a.id));

    const fixed = agents.map(agent => {
      if (agent.escalationPath === agent.id) {
        fixes.push(`${agent.id}: self-reference -> BOARD_HUMAN_OVERSIGHT`);
        return { ...agent, escalationPath: 'BOARD_HUMAN_OVERSIGHT' };
      }

      if (
        agent.escalationPath !== 'BOARD_HUMAN_OVERSIGHT' &&
        agent.escalationPath !== 'ns-queen' &&
        !agentIds.has(agent.escalationPath)
      ) {
        fixes.push(`${agent.id}: broken escalation -> execution-orchestrator`);
        return { ...agent, escalationPath: 'execution-orchestrator' };
      }

      return agent;
    });

    return { agents: fixed, fixes };
  }

  injectComplianceFlags(agents: AgentV3[], jurisdiction: string): { agents: AgentV3[]; count: number } {
    let count = 0;
    const fixed = agents.map(agent => {
      const primaryJur = agent.jurisdictionScope.primary;
      let updated = false;
      const compliance = { ...agent.compliance };

      if (primaryJur.includes('India') && !compliance.dpdpApplicable) {
        compliance.dpdpApplicable = true;
        updated = true;
      }
      if ((primaryJur.includes('UK') || primaryJur.includes('EU')) && !compliance.gdprApplicable) {
        compliance.gdprApplicable = true;
        updated = true;
      }
      if (primaryJur.includes('US') && !compliance.hipaaApplicable) {
        compliance.hipaaApplicable = true;
        updated = true;
      }
      if (primaryJur.includes('Singapore') && !compliance.pdpaApplicable) {
        compliance.pdpaApplicable = true;
        updated = true;
      }

      if (updated) {
        count++;
        return { ...agent, compliance };
      }
      return agent;
    });
    return { agents: fixed, count };
  }

  optimize(agents: AgentV3[], jurisdiction: string): OptimizationReport & { optimizedAgents: AgentV3[] } {
    const report: OptimizationReport = {
      totalInput: agents.length,
      duplicatesRemoved: 0,
      hierarchyLoopsFix: [],
      complianceFlagsSet: 0,
      agentsUpgradedToL5: 0,
      finalCount: 0,
      valid: false,
    };

    let current = [...agents];

    const deduped = this.deduplicateAgents(current);
    current = deduped.agents;
    report.duplicatesRemoved = deduped.removed.length;

    const hierarchy = this.fixHierarchyLoops(current);
    current = hierarchy.agents;
    report.hierarchyLoopsFix = hierarchy.fixes;

    const compliance = this.injectComplianceFlags(current, jurisdiction);
    current = compliance.agents;
    report.complianceFlagsSet = compliance.count;

    report.agentsUpgradedToL5 = current.filter(a => a.romaLevel === 'L5').length;
    report.finalCount = current.length;
    report.valid = current.length === 149;

    return { ...report, optimizedAgents: current };
  }
}

export const romaOptimizer = new RomaL5Optimizer();
