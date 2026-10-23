/**
 * Type definitions for ROMA Meta-Agent Framework integration
 * ROMA Level 5 — Sovereign Adaptive Governance (Self-Healing, Self-Optimizing)
 */

export interface RomaConfiguration {
  maxDepth: number;
  maxParallel: number;
  timeoutMs: number;
  retryAttempts: number;
  enableParallelization: boolean;
  costOptimization: boolean;
  qualityThreshold: number;
}

export interface RomaAgent {
  id: string;
  type: string;
  capabilities: string[];
  availability: boolean;
  performance: {
    successRate: number;
    averageQuality: number;
    averageSpeed: number;
  };
}

export interface RomaContext {
  projectId?: string;
  userId?: string;
  sessionId?: string;
  preferences?: Record<string, any>;
  constraints?: {
    timeLimit?: number;
    budgetLimit?: number;
    qualityMinimum?: number;
  };
  resources?: {
    agents: RomaAgent[];
    tools: string[];
    data: Record<string, any>;
  };
}

export interface RomaTaskMetrics {
  startTime: Date;
  endTime?: Date;
  duration?: number;
  cost?: number;
  quality?: number;
  agentsUsed?: string[];
  resourcesConsumed?: Record<string, number>;
}

export interface RomaDecompositionStrategy {
  type: 'parallel' | 'sequential' | 'hybrid';
  maxSubtasks: number;
  dependencyAnalysis: boolean;
  resourceOptimization: boolean;
}

export interface RomaExecutionPlan {
  tasks: Array<{
    id: string;
    task: string;
    dependencies: string[];
    estimatedDuration: number;
    requiredResources: string[];
    priority: 'high' | 'medium' | 'low';
  }>;
  executionOrder: string[][];
  criticalPath: string[];
  estimatedTotalDuration: number;
  resourceAllocation: Record<string, string[]>;
}

export interface RomaQualityMetrics {
  accuracy: number;
  completeness: number;
  consistency: number;
  usability: number;
  performance: number;
  overall: number;
}

/**
 * ROMA Autonomy Levels (Replit Orchestration Maturity Architecture)
 *
 * L1: Guided Execution — Task-level assistance with explicit instructions
 * L2: Autonomous Execution — Feature-level autonomy with minimal guidance
 * L3: Strategic Self-Direction — Complex multi-step workflows with strategic planning
 * L4: Adaptive Innovation — Self-improving systems with continuous learning
 * L5: Sovereign Adaptive Governance — Self-healing, self-optimizing, self-governing legal AI infrastructure
 *     Introduced: 2026-Q1 | Status: Chairman Approved | Classification: Production
 */
export type RomaAutonomyLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface RomaAutonomyCapabilities {
  level: RomaAutonomyLevel;
  canPlan: boolean;
  canAdapt: boolean;
  canLearn: boolean;
  canInnovate: boolean;
  canSelfHeal: boolean;
  canOptimize: boolean;
  canGovern: boolean;
  requiresApproval: boolean;
  complexityLimit: number;
}

export const ROMA_LEVEL_CAPABILITIES: Record<RomaAutonomyLevel, RomaAutonomyCapabilities> = {
  L1: {
    level: 'L1', canPlan: false, canAdapt: false, canLearn: false, canInnovate: false,
    canSelfHeal: false, canOptimize: false, canGovern: false, requiresApproval: true, complexityLimit: 2,
  },
  L2: {
    level: 'L2', canPlan: true, canAdapt: false, canLearn: false, canInnovate: false,
    canSelfHeal: false, canOptimize: false, canGovern: false, requiresApproval: true, complexityLimit: 4,
  },
  L3: {
    level: 'L3', canPlan: true, canAdapt: true, canLearn: false, canInnovate: false,
    canSelfHeal: false, canOptimize: false, canGovern: false, requiresApproval: true, complexityLimit: 6,
  },
  L4: {
    level: 'L4', canPlan: true, canAdapt: true, canLearn: true, canInnovate: true,
    canSelfHeal: false, canOptimize: true, canGovern: false, requiresApproval: false, complexityLimit: 8,
  },
  L5: {
    level: 'L5', canPlan: true, canAdapt: true, canLearn: true, canInnovate: true,
    canSelfHeal: true, canOptimize: true, canGovern: true, requiresApproval: false, complexityLimit: 10,
  },
};

export interface RomaL3Strategy {
  goal: string;
  approach: string;
  contingencyPlans: string[];
  resourceRequirements: Record<string, any>;
  expectedOutcomes: string[];
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
    mitigation: string[];
  };
}

export interface RomaL4Innovation {
  problemAnalysis: string;
  novelApproaches: string[];
  experimentalStrategies: Array<{
    name: string;
    hypothesis: string;
    expectedBenefit: string;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
  learningObjectives: string[];
  improvementMetrics: Record<string, number>;
}

/**
 * ROMA L5 — Sovereign Adaptive Governance
 * The three mandatory sub-systems per Chairman directive
 */

export interface RomaL5RegistryOptimizer {
  detectDuplicates(agents: RomaL5AgentSchema[]): DuplicateReport;
  enforceSchemaCompliance(agents: RomaL5AgentSchema[]): ComplianceReport;
  capAgentCount(agents: RomaL5AgentSchema[], max: number): RomaL5AgentSchema[];
  mergeCapabilities(a: RomaL5AgentSchema, b: RomaL5AgentSchema): RomaL5AgentSchema;
}

export interface RomaL5PolicyEngine {
  enforceJurisdictionRouting(agent: RomaL5AgentSchema): PolicyResult;
  enforceComplianceFlags(agent: RomaL5AgentSchema, jurisdictions: string[]): PolicyResult;
  enforceAuditLogging(agent: RomaL5AgentSchema): PolicyResult;
  enforceRiskEscalation(agent: RomaL5AgentSchema): PolicyResult;
}

export interface RomaL5AdaptiveLearning {
  trackPerformanceMetrics(agentId: string, outcome: AgentOutcome): void;
  optimizeFromMetrics(agents: RomaL5AgentSchema[], metrics: PerformanceMetrics): OptimizationReport;
  adaptiveSLMUpgrade(agent: RomaL5AgentSchema, metrics: AgentMetrics): RomaL5AgentSchema;
}

export interface RomaL5AgentSchema {
  id: string;
  tier: 'executive' | 'senior' | 'specialist' | 'associate';
  module: 'matter' | 'draft' | 'timeline' | 'mentor' | 'ledger' | 'insight' | 'connect' | 'assurance';
  promptMode: 'delta' | 'full' | 'base';
  basePrompt: string;
  roleDelta: string;
  romaLevel: RomaAutonomyLevel;
  version: string;
  jurisdictionScope: {
    primary: string[];
    secondary?: string[];
    crossBorderEnabled: boolean;
  };
  slmBinding: {
    primarySLM: string;
    fallbackSLM?: string[];
    requiresLRM: boolean;
  };
  matterContext?: {
    matterIdRequired: boolean;
    clientPrivilege?: boolean;
    conflictCheck?: boolean;
  };
  privilege?: { enabled: boolean };
  compliance: {
    dpdpApplicable: boolean;
    gdprApplicable: boolean;
    hipaaApplicable?: boolean;
    ukGdprApplicable?: boolean;
    gccRegionalCompliance?: boolean;
    pdpaApplicable?: boolean;
  };
  audit: {
    logLevel: 'legal-grade' | 'regulatory' | 'standard';
  };
  riskControl: {
    requiresHumanApproval: boolean;
    riskTier?: 'high' | 'medium' | 'low';
  };
  security: {
    zeroTrustAccess: boolean;
    encryptionRequired: boolean;
  };
  quantumReady: {
    mlKemLevel: string;
    mlDsaLevel: string;
    zkpCircuit: string;
  };
  guardrails: {
    parlantCompliant: boolean;
    bmadCompliant: boolean;
    antiHallucination: boolean;
    piiProtection: boolean;
    requiresCitation: boolean;
  };
  supportedLanguages: string[];
  status: 'production-ready' | 'staging' | 'deprecated';
  metrics?: AgentMetrics;
}

export interface AgentMetrics {
  usageCount: number;
  successRate: number;
  fallbackRate: number;
  averageLatencyMs: number;
  hallucinationFlags: number;
  lastUsed?: Date;
}

export interface AgentOutcome {
  success: boolean;
  latencyMs: number;
  usedFallback: boolean;
  hallucinationDetected: boolean;
  errorCode?: string;
}

export interface PerformanceMetrics {
  [agentId: string]: AgentMetrics;
}

export interface DuplicateReport {
  duplicates: Array<{ agents: string[]; mergedId: string; reason: string }>;
  cleaned: RomaL5AgentSchema[];
  totalMerged: number;
}

export interface ComplianceReport {
  compliant: number;
  autoRepaired: number;
  failed: number;
  issues: Array<{ agentId: string; field: string; action: 'injected' | 'failed' }>;
}

export interface PolicyResult {
  agentId: string;
  compliant: boolean;
  violations: string[];
  autoFixed: boolean;
}

export interface OptimizationReport {
  flaggedForReview: string[];
  escalatedSLM: string[];
  deprecationCandidates: string[];
  quarantined: string[];
  recommendations: string[];
}
