/**
 * ROMA L5 Engine — Sovereign Adaptive Governance
 * Chairman Approved | SDK v2 | Production
 *
 * Three Mandatory Sub-Systems:
 * 1. Registry Optimizer (Self-Healing)
 * 2. Policy Enforcement Engine
 * 3. Adaptive Learning Loop
 */

import {
  RomaL5AgentSchema,
  RomaL5RegistryOptimizer,
  RomaL5PolicyEngine,
  RomaL5AdaptiveLearning,
  AgentMetrics,
  AgentOutcome,
  PerformanceMetrics,
  DuplicateReport,
  ComplianceReport,
  PolicyResult,
  OptimizationReport,
} from './types.js';
import { mergeRomaStoreIfMissing } from './jrx-roma-performance-codec.js';
import {
  loadRomaPerformanceStore,
  saveRomaPerformanceStore,
} from './jrx-roma-performance-persist.js';

const MAX_AGENTS = 150;
const SIMILARITY_THRESHOLD = 0.7;
const DEPRECATION_DAYS = 30;
const HALLUCINATION_QUARANTINE_THRESHOLD = 5;

const DEFAULT_AGENT_FIELDS: Partial<RomaL5AgentSchema> = {
  promptMode: 'delta',
  basePrompt: 'legal-base-v1',
  romaLevel: 'L5',
  version: '3.0.0',
  slmBinding: {
    primarySLM: 'NS-SLM-IND',
    fallbackSLM: ['NS-SLM-USA', 'NS-SLM-EUR'],
    requiresLRM: true,
  },
  compliance: {
    dpdpApplicable: true,
    gdprApplicable: true,
    hipaaApplicable: false,
    ukGdprApplicable: false,
    gccRegionalCompliance: false,
  },
  audit: { logLevel: 'standard' },
  riskControl: { requiresHumanApproval: false, riskTier: 'low' },
  security: { zeroTrustAccess: true, encryptionRequired: true },
  quantumReady: { mlKemLevel: '512', mlDsaLevel: '44', zkpCircuit: 'PLONK' },
  guardrails: {
    parlantCompliant: true,
    bmadCompliant: true,
    antiHallucination: true,
    piiProtection: true,
    requiresCitation: true,
  },
  supportedLanguages: [
    'en', 'hi', 'te', 'ta', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'ur',
    'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 'pt', 'ru', 'it', 'nl', 'tr', 'th',
    'vi', 'id', 'ms', 'pl',
  ],
  status: 'production-ready',
};

const HIGH_RISK_ROLES = [
  'chief-legal-officer', 'general-counsel', 'litigation-specialist', 'criminal-specialist',
  'banking-specialist', 'compliance-lead', 'data-protection-agent', 'analytics-agent',
  'mergers-acquisitions', 'arbitration-specialist', 'pleading-draft', 'bail-applications',
  'criminal-appeals', 'debt-restructuring',
];

const performanceStore: PerformanceMetrics = {};
const auditTrail: Array<{ timestamp: Date; action: string; agentId: string; details: string }> = [];

function logAudit(action: string, agentId: string, details: string) {
  auditTrail.push({ timestamp: new Date(), action, agentId, details });
}

function computeSimilarity(a: RomaL5AgentSchema, b: RomaL5AgentSchema): number {
  let score = 0;
  if (a.module === b.module) score += 0.5;
  if (a.roleDelta === b.roleDelta) score += 0.5;
  return score;
}

function computeCompletenessScore(agent: RomaL5AgentSchema): number {
  const fields = ['id', 'tier', 'module', 'promptMode', 'roleDelta', 'romaLevel',
    'jurisdictionScope', 'slmBinding', 'compliance', 'audit', 'riskControl',
    'security', 'quantumReady', 'guardrails', 'supportedLanguages', 'status'];
  return fields.filter(f => (agent as any)[f] !== undefined).length / fields.length;
}

export class RomaL5RegistryOptimizerImpl implements RomaL5RegistryOptimizer {
  detectDuplicates(agents: RomaL5AgentSchema[]): DuplicateReport {
    const merged: RomaL5AgentSchema[] = [];
    const usedIndices = new Set<number>();
    const duplicates: DuplicateReport['duplicates'] = [];

    for (let i = 0; i < agents.length; i++) {
      if (usedIndices.has(i)) continue;
      let base = agents[i];

      for (let j = i + 1; j < agents.length; j++) {
        if (usedIndices.has(j)) continue;
        const sim = computeSimilarity(base, agents[j]);
        if (sim >= SIMILARITY_THRESHOLD) {
          const mergedAgent = this.mergeCapabilities(base, agents[j]);
          duplicates.push({
            agents: [base.id, agents[j].id],
            mergedId: base.id,
            reason: `module+roleDelta similarity ${(sim * 100).toFixed(0)}%`,
          });
          logAudit('MERGE', base.id, `Merged with ${agents[j].id} — similarity ${sim}`);
          base = mergedAgent;
          usedIndices.add(j);
        }
      }

      merged.push(base);
      usedIndices.add(i);
    }

    return { duplicates, cleaned: merged, totalMerged: duplicates.length };
  }

  enforceSchemaCompliance(agents: RomaL5AgentSchema[]): ComplianceReport {
    let compliant = 0;
    let autoRepaired = 0;
    let failed = 0;
    const issues: ComplianceReport['issues'] = [];

    const repaired = agents.map(agent => {
      let changed = false;

      for (const [key, value] of Object.entries(DEFAULT_AGENT_FIELDS)) {
        if ((agent as any)[key] === undefined) {
          (agent as any)[key] = value;
          issues.push({ agentId: agent.id, field: key, action: 'injected' });
          changed = true;
        }
      }

      if (!agent.id || !agent.tier || !agent.module || !agent.roleDelta) {
        failed++;
        issues.push({ agentId: agent.id || 'UNKNOWN', field: 'required-fields', action: 'failed' });
        return agent;
      }

      if (changed) {
        autoRepaired++;
        logAudit('SCHEMA_REPAIR', agent.id, 'Auto-injected missing fields');
      } else {
        compliant++;
      }

      return agent;
    });

    return { compliant, autoRepaired, failed, issues };
  }

  capAgentCount(agents: RomaL5AgentSchema[], max: number = MAX_AGENTS): RomaL5AgentSchema[] {
    if (agents.length <= max) return agents;

    const sorted = [...agents].sort((a, b) => {
      const tierPriority: Record<string, number> = { executive: 4, senior: 3, specialist: 2, associate: 1 };
      const statusPriority: Record<string, number> = { 'production-ready': 3, staging: 2, deprecated: 1 };
      const tA = tierPriority[a.tier] ?? 0;
      const tB = tierPriority[b.tier] ?? 0;
      if (tA !== tB) return tB - tA;
      const sA = statusPriority[a.status] ?? 0;
      const sB = statusPriority[b.status] ?? 0;
      if (sA !== sB) return sB - sA;
      return computeCompletenessScore(b) - computeCompletenessScore(a);
    });

    logAudit('CAP_AGENTS', 'REGISTRY', `Capped ${agents.length} → ${max} agents`);
    return sorted.slice(0, max);
  }

  mergeCapabilities(a: RomaL5AgentSchema, b: RomaL5AgentSchema): RomaL5AgentSchema {
    const aScore = computeCompletenessScore(a);
    const bScore = computeCompletenessScore(b);
    const base = aScore >= bScore ? { ...a } : { ...b };
    return base;
  }
}

export class RomaL5PolicyEngineImpl implements RomaL5PolicyEngine {
  enforceJurisdictionRouting(agent: RomaL5AgentSchema): PolicyResult {
    const violations: string[] = [];
    let autoFixed = false;

    if (!agent.slmBinding) {
      agent.slmBinding = { primarySLM: 'NS-SLM-IND', fallbackSLM: ['NS-SLM-USA', 'NS-SLM-EUR'], requiresLRM: true };
      violations.push('slmBinding missing — auto-injected');
      autoFixed = true;
    }

    if (!agent.slmBinding.requiresLRM) {
      agent.slmBinding.requiresLRM = true;
      violations.push('requiresLRM was false — forced to true');
      autoFixed = true;
    }

    if (!agent.slmBinding.primarySLM?.startsWith('NS-SLM-')) {
      agent.slmBinding.primarySLM = 'NS-SLM-IND';
      violations.push('invalid primarySLM — reset to NS-SLM-IND');
      autoFixed = true;
    }

    if (!agent.slmBinding.fallbackSLM || agent.slmBinding.fallbackSLM.length === 0) {
      agent.slmBinding.fallbackSLM = ['NS-SLM-USA', 'NS-SLM-EUR'];
      violations.push('fallbackSLM empty — auto-populated');
      autoFixed = true;
    }

    if (autoFixed) logAudit('POLICY_FIX', agent.id, violations.join('; '));

    return { agentId: agent.id, compliant: violations.length === 0, violations, autoFixed };
  }

  enforceComplianceFlags(agent: RomaL5AgentSchema, jurisdictions: string[]): PolicyResult {
    const violations: string[] = [];
    let autoFixed = false;

    if (!agent.compliance) {
      agent.compliance = { dpdpApplicable: false, gdprApplicable: false };
    }

    if (jurisdictions.includes('India') || agent.jurisdictionScope?.primary?.includes('India')) {
      if (!agent.compliance.dpdpApplicable) {
        agent.compliance.dpdpApplicable = true;
        violations.push('dpdpApplicable forced true for India deployment');
        autoFixed = true;
      }
    }

    if (jurisdictions.includes('Europe') || agent.jurisdictionScope?.primary?.includes('EU') ||
        agent.jurisdictionScope?.secondary?.includes('EU')) {
      if (!agent.compliance.gdprApplicable) {
        agent.compliance.gdprApplicable = true;
        violations.push('gdprApplicable forced true for EU deployment');
        autoFixed = true;
      }
    }

    if (jurisdictions.includes('UK') || agent.jurisdictionScope?.primary?.includes('UK')) {
      if (!agent.compliance.ukGdprApplicable) {
        agent.compliance.ukGdprApplicable = true;
        violations.push('ukGdprApplicable forced true for UK deployment');
        autoFixed = true;
      }
    }

    if (jurisdictions.includes('GCC') || agent.jurisdictionScope?.primary?.includes('GCC')) {
      if (!agent.compliance.gccRegionalCompliance) {
        agent.compliance.gccRegionalCompliance = true;
        violations.push('gccRegionalCompliance forced true for GCC deployment');
        autoFixed = true;
      }
    }

    if (jurisdictions.includes('Singapore') || agent.jurisdictionScope?.primary?.includes('Singapore')) {
      if (!agent.compliance.pdpaApplicable) {
        agent.compliance.pdpaApplicable = true;
        violations.push('pdpaApplicable forced true for Singapore deployment');
        autoFixed = true;
      }
    }

    if (autoFixed) logAudit('COMPLIANCE_FIX', agent.id, violations.join('; '));
    return { agentId: agent.id, compliant: violations.length === 0, violations, autoFixed };
  }

  enforceAuditLogging(agent: RomaL5AgentSchema): PolicyResult {
    const violations: string[] = [];
    let autoFixed = false;

    const required = agent.tier === 'executive' ? 'legal-grade'
      : agent.tier === 'senior' ? 'regulatory'
      : 'standard';

    if (!agent.audit) {
      agent.audit = { logLevel: required };
      violations.push(`audit missing — set to ${required}`);
      autoFixed = true;
    } else if (agent.tier === 'executive' && agent.audit.logLevel !== 'legal-grade') {
      agent.audit.logLevel = 'legal-grade';
      violations.push('executive tier must use legal-grade logging — corrected');
      autoFixed = true;
    }

    if (autoFixed) logAudit('AUDIT_FIX', agent.id, violations.join('; '));
    return { agentId: agent.id, compliant: violations.length === 0, violations, autoFixed };
  }

  enforceRiskEscalation(agent: RomaL5AgentSchema): PolicyResult {
    const violations: string[] = [];
    let autoFixed = false;

    const isHighRisk = agent.tier === 'executive' || HIGH_RISK_ROLES.includes(agent.id);

    if (!agent.riskControl) {
      agent.riskControl = { requiresHumanApproval: isHighRisk, riskTier: isHighRisk ? 'high' : 'low' };
      violations.push(`riskControl missing — set requiresHumanApproval=${isHighRisk}`);
      autoFixed = true;
    } else if (isHighRisk && !agent.riskControl.requiresHumanApproval) {
      agent.riskControl.requiresHumanApproval = true;
      agent.riskControl.riskTier = 'high';
      violations.push('high-risk role requires human approval — forced true');
      autoFixed = true;
    }

    if (autoFixed) logAudit('RISK_FIX', agent.id, violations.join('; '));
    return { agentId: agent.id, compliant: violations.length === 0, violations, autoFixed };
  }
}

export class RomaL5AdaptiveLearningImpl implements RomaL5AdaptiveLearning {
  trackPerformanceMetrics(agentId: string, outcome: AgentOutcome): void {
    if (!performanceStore[agentId]) {
      performanceStore[agentId] = {
        usageCount: 0,
        successRate: 1.0,
        fallbackRate: 0.0,
        averageLatencyMs: 0,
        hallucinationFlags: 0,
        lastUsed: new Date(),
      };
    }

    const m = performanceStore[agentId];
    m.usageCount++;
    m.lastUsed = new Date();

    const alpha = 0.1;
    m.successRate = m.successRate * (1 - alpha) + (outcome.success ? 1 : 0) * alpha;
    m.fallbackRate = m.fallbackRate * (1 - alpha) + (outcome.usedFallback ? 1 : 0) * alpha;
    m.averageLatencyMs = m.averageLatencyMs * (1 - alpha) + outcome.latencyMs * alpha;

    if (outcome.hallucinationDetected) {
      m.hallucinationFlags++;
      logAudit('HALLUCINATION_FLAG', agentId, `Total flags: ${m.hallucinationFlags}`);
    }

    if (m.hallucinationFlags >= HALLUCINATION_QUARANTINE_THRESHOLD) {
      logAudit('QUARANTINE', agentId, `Quarantined — ${m.hallucinationFlags} hallucination flags`);
    }
  }

  optimizeFromMetrics(agents: RomaL5AgentSchema[], metrics: PerformanceMetrics): OptimizationReport {
    const flaggedForReview: string[] = [];
    const escalatedSLM: string[] = [];
    const deprecationCandidates: string[] = [];
    const quarantined: string[] = [];
    const recommendations: string[] = [];

    const now = new Date();

    for (const agent of agents) {
      const m = metrics[agent.id];
      if (!m) continue;

      if (m.successRate < 0.7) {
        flaggedForReview.push(agent.id);
        recommendations.push(`${agent.id}: successRate ${(m.successRate * 100).toFixed(1)}% — review required`);
      }

      if (m.fallbackRate > 0.3) {
        escalatedSLM.push(agent.id);
        recommendations.push(`${agent.id}: fallbackRate ${(m.fallbackRate * 100).toFixed(1)}% — SLM escalation needed`);
      }

      const daysSinceUsed = m.lastUsed
        ? (now.getTime() - new Date(m.lastUsed).getTime()) / (1000 * 60 * 60 * 24)
        : DEPRECATION_DAYS + 1;

      if (m.usageCount === 0 || daysSinceUsed > DEPRECATION_DAYS) {
        deprecationCandidates.push(agent.id);
        recommendations.push(`${agent.id}: unused for ${Math.floor(daysSinceUsed)} days — deprecation candidate`);
      }

      if (m.hallucinationFlags >= HALLUCINATION_QUARANTINE_THRESHOLD) {
        quarantined.push(agent.id);
        recommendations.push(`${agent.id}: ${m.hallucinationFlags} hallucination flags — QUARANTINED`);
      }
    }

    return { flaggedForReview, escalatedSLM, deprecationCandidates, quarantined, recommendations };
  }

  adaptiveSLMUpgrade(agent: RomaL5AgentSchema, metrics: AgentMetrics): RomaL5AgentSchema {
    if (!agent.slmBinding) return agent;

    if (metrics.fallbackRate > 0.3 && agent.slmBinding.fallbackSLM?.length) {
      const promoted = agent.slmBinding.fallbackSLM[0];
      logAudit('SLM_UPGRADE', agent.id, `Promoted ${promoted} to primarySLM (fallbackRate ${(metrics.fallbackRate * 100).toFixed(1)}%)`);
      agent.slmBinding = {
        ...agent.slmBinding,
        primarySLM: promoted,
        fallbackSLM: [agent.slmBinding.primarySLM, ...agent.slmBinding.fallbackSLM.slice(1)],
      };
    }

    return agent;
  }
}

export class RomaL5Engine {
  private optimizer: RomaL5RegistryOptimizerImpl;
  private policy: RomaL5PolicyEngineImpl;
  private learning: RomaL5AdaptiveLearningImpl;
  private hydrated = false;
  private hydratePromise: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.optimizer = new RomaL5RegistryOptimizerImpl();
    this.policy = new RomaL5PolicyEngineImpl();
    this.learning = new RomaL5AdaptiveLearningImpl();
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydratePromise) return this.hydratePromise;
    this.hydratePromise = this.doHydrate();
    return this.hydratePromise;
  }

  private async doHydrate(): Promise<void> {
    try {
      const loaded = await loadRomaPerformanceStore();
      if (loaded) mergeRomaStoreIfMissing(performanceStore, loaded);
    } catch {
      /* fail-soft */
    } finally {
      this.hydrated = true;
    }
  }

  seedIfMissing(agentId: string, metrics: AgentMetrics): boolean {
    if (!agentId || performanceStore[agentId]) return false;
    performanceStore[agentId] = { ...metrics };
    this.schedulePersist();
    return true;
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      await saveRomaPerformanceStore(performanceStore);
    } catch {
      /* fail-soft */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void saveRomaPerformanceStore(performanceStore);
    }, 400);
  }

  /**
   * Full L5 governance pipeline — runs all 3 sub-systems in sequence
   */
  async runGovernancePipeline(
    agents: RomaL5AgentSchema[],
    deploymentJurisdictions: string[] = ['India', 'UK', 'GCC', 'Europe', 'USA', 'Singapore'],
  ): Promise<{
    agents: RomaL5AgentSchema[];
    duplicateReport: DuplicateReport;
    complianceReport: ComplianceReport;
    optimizationReport: OptimizationReport;
    auditTrail: typeof auditTrail;
  }> {
    logAudit('PIPELINE_START', 'REGISTRY', `Starting L5 governance — ${agents.length} agents, jurisdictions: ${deploymentJurisdictions.join(', ')}`);

    // Sub-system 1: Registry Optimizer
    const { cleaned: deduped, duplicates, totalMerged } = this.optimizer.detectDuplicates(agents);
    const complianceReport = this.optimizer.enforceSchemaCompliance(deduped);
    const capped = this.optimizer.capAgentCount(deduped, MAX_AGENTS);

    // Sub-system 2: Policy Enforcement
    for (const agent of capped) {
      this.policy.enforceJurisdictionRouting(agent);
      this.policy.enforceComplianceFlags(agent, deploymentJurisdictions);
      this.policy.enforceAuditLogging(agent);
      this.policy.enforceRiskEscalation(agent);
    }

    // Sub-system 3: Adaptive Learning
    const optimizationReport = this.learning.optimizeFromMetrics(capped, performanceStore);

    logAudit('PIPELINE_COMPLETE', 'REGISTRY', `Final count: ${capped.length}, merged: ${totalMerged}`);

    return {
      agents: capped,
      duplicateReport: { duplicates, cleaned: capped, totalMerged },
      complianceReport,
      optimizationReport,
      auditTrail: [...auditTrail],
    };
  }

  trackOutcome(agentId: string, outcome: AgentOutcome): void {
    this.learning.trackPerformanceMetrics(agentId, outcome);
    this.schedulePersist();
  }

  getAuditTrail() { return [...auditTrail]; }
  getPerformanceStore() { return { ...performanceStore }; }
}

export const romaL5Engine = new RomaL5Engine();
