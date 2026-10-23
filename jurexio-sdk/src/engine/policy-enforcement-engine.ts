import type { AgentV3 } from '../schemas/agent-schema-v3-roma5.js';

interface PolicyViolation {
  agentId: string;
  policy: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

export class PolicyEnforcementEngine {
  private readonly REQUIRED_PROTOCOLS = ['A2A', 'MCP', 'ROMA-L5', 'AG-UI', 'Parlant', 'BMAD', 'GRPO'];
  private readonly MANDATORY_SKILLS = ['SKILL-PII-VAULT-01', 'SKILL-BIAS-CHECK-01', 'SKILL-CITATION-01'];

  enforceAllPolicies(agents: AgentV3[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const agent of agents) {
      violations.push(
        ...this.checkRomaLevel(agent),
        ...this.checkQuantumSecurity(agent),
        ...this.checkGuardrails(agent),
        ...this.checkMandatorySkills(agent),
        ...this.checkProtocols(agent),
        ...this.checkLanguageSupport(agent),
        ...this.checkJurisdictionCompliance(agent),
        ...this.checkLrmRequired(agent),
        ...this.checkSystemPrompt(agent),
      );
    }

    return violations;
  }

  private checkRomaLevel(a: AgentV3): PolicyViolation[] {
    if (a.romaLevel !== 'L5') return [{
      agentId: a.id, policy: 'ROMA-LEVEL', severity: 'critical',
      message: `Agent ${a.id} is at ${a.romaLevel} — must be L5`,
    }];
    return [];
  }

  private checkQuantumSecurity(a: AgentV3): PolicyViolation[] {
    const v: PolicyViolation[] = [];
    if (!a.quantumReady?.mlKemLevel) v.push({ agentId: a.id, policy: 'QUANTUM-KEM', severity: 'critical', message: 'ML-KEM not configured' });
    if (!a.quantumReady?.mlDsaLevel) v.push({ agentId: a.id, policy: 'QUANTUM-DSA', severity: 'critical', message: 'ML-DSA not configured' });
    return v;
  }

  private checkGuardrails(a: AgentV3): PolicyViolation[] {
    const v: PolicyViolation[] = [];
    if (!a.guardrails?.antiHallucination) v.push({ agentId: a.id, policy: 'GUARDRAIL-HALLUCINATION', severity: 'critical', message: 'Anti-hallucination guardrail not set' });
    if (!a.guardrails?.piiProtection) v.push({ agentId: a.id, policy: 'GUARDRAIL-PII', severity: 'critical', message: 'PII protection not set' });
    if (!a.guardrails?.requiresCitation) v.push({ agentId: a.id, policy: 'GUARDRAIL-CITATION', severity: 'high', message: 'Citation requirement not set' });
    if (!a.guardrails?.biasDetection) v.push({ agentId: a.id, policy: 'GUARDRAIL-BIAS', severity: 'high', message: 'Bias detection not set' });
    return v;
  }

  private checkMandatorySkills(a: AgentV3): PolicyViolation[] {
    return this.MANDATORY_SKILLS
      .filter(s => !a.skills?.includes(s))
      .map(s => ({ agentId: a.id, policy: 'MANDATORY-SKILL', severity: 'high' as const, message: `Missing mandatory skill: ${s}` }));
  }

  private checkProtocols(a: AgentV3): PolicyViolation[] {
    return this.REQUIRED_PROTOCOLS
      .filter(p => !a.protocols?.includes(p))
      .map(p => ({ agentId: a.id, policy: 'PROTOCOL', severity: 'medium' as const, message: `Missing protocol: ${p}` }));
  }

  private checkLanguageSupport(a: AgentV3): PolicyViolation[] {
    if (!a.supportedLanguages || a.supportedLanguages.length < 5) return [{
      agentId: a.id, policy: 'LANGUAGE-SUPPORT', severity: 'high',
      message: `Only ${a.supportedLanguages?.length || 0} languages — min 5 required`,
    }];
    return [];
  }

  private checkJurisdictionCompliance(a: AgentV3): PolicyViolation[] {
    const v: PolicyViolation[] = [];
    const primary = a.jurisdictionScope?.primary || [];
    if (primary.includes('India') && !a.compliance?.dpdpApplicable) {
      v.push({ agentId: a.id, policy: 'DPDPA-FLAG', severity: 'critical', message: 'India agent missing DPDPA compliance flag' });
    }
    if ((primary.includes('UK') || primary.includes('EU')) && !a.compliance?.gdprApplicable) {
      v.push({ agentId: a.id, policy: 'GDPR-FLAG', severity: 'critical', message: 'UK/EU agent missing GDPR compliance flag' });
    }
    return v;
  }

  private checkLrmRequired(a: AgentV3): PolicyViolation[] {
    if (!a.slmBinding?.requiresLRM) return [{
      agentId: a.id, policy: 'LRM-REQUIRED', severity: 'critical',
      message: 'requiresLRM must be true',
    }];
    return [];
  }

  private checkSystemPrompt(a: AgentV3): PolicyViolation[] {
    if (!a.systemPrompt || a.systemPrompt.length < 200) return [{
      agentId: a.id, policy: 'SYSTEM-PROMPT', severity: 'critical',
      message: `System prompt too short: ${a.systemPrompt?.length || 0} chars (min 200)`,
    }];
    return [];
  }

  generateReport(violations: PolicyViolation[]): string {
    const critical = violations.filter(v => v.severity === 'critical');
    const high = violations.filter(v => v.severity === 'high');
    const medium = violations.filter(v => v.severity === 'medium');

    return [
      `POLICY ENFORCEMENT REPORT`,
      `Total violations: ${violations.length}`,
      `Critical: ${critical.length} | High: ${high.length} | Medium: ${medium.length}`,
      ``,
      critical.length > 0 ? `CRITICAL:\n${critical.map(v => `  [${v.agentId}] ${v.policy}: ${v.message}`).join('\n')}` : 'No critical violations.',
      high.length > 0 ? `HIGH:\n${high.map(v => `  [${v.agentId}] ${v.policy}: ${v.message}`).join('\n')}` : '',
      ``,
      `Deployment gate: ${critical.length === 0 ? 'PASS' : 'BLOCKED'}`,
    ].filter(Boolean).join('\n');
  }
}

export const policyEngine = new PolicyEnforcementEngine();
