import crypto from 'crypto';

export const NYV_SDK_VERSION = '5.0.0';

export type NyvPlatformVariant = 'nyayamitra' | 'nys-professional' | 'nys-institutional' | 'nys-academy' | 'nys-ministry';

export interface NyvSDKVariantConfig {
  platformCode: NyvPlatformVariant;
  displayName: string;
  fullName: string;
  audience: string;
  description: string;
  appType: string;
  sdkClientId: string;
  apiPrefix: string;
  dbPrefix: string;
  tier: string;
  defaultJurisdiction: string;
  supportedJurisdictions: string[];
  defaultLLM: string;
  fallbackLLM: string;
  llmTier: 'minimal' | 'balanced' | 'premium' | 'sovereign';
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyRequestLimit: number;
  dailyTokenBudget: number;
  monthlyTokenBudget: number;
  defaultAgentTokenLimit: number;
  storageQuotaGb: number;
  maxDocSizeMb: number;
  temperature: number;
  allocatedAgentCategories: string[];
  allocatedPatterns: string[];
  features: NyvSDKFeatureSet;
  scopes: string[];
  webhookSupport: boolean;
  sandboxMode: boolean;
  complianceLevel: 'standard' | 'enhanced' | 'sovereign';
}

export interface NyvSDKFeatureSet {
  orchestration: boolean;
  streaming: boolean;
  rag: boolean;
  documentAnalysis: boolean;
  voiceSTT: boolean;
  voiceTTS: boolean;
  memoryTiers: number[];
  digitalTwin: boolean;
  mcpTools: boolean;
  caseManagement: boolean;
  clientManagement: boolean;
  billing: boolean;
  compliance: boolean;
  auditLog: boolean;
  piiVault: boolean;
  halluccinationCheck: boolean;
  multiJurisdiction: boolean;
  a2aCollaboration: boolean;
  grpoOptimization: boolean;
  bmadClusters: boolean;
  customAgents: boolean;
  whatsappIntegration: boolean;
  emailAutomation: boolean;
  analytics: boolean;
  creditSystem: boolean;
}

export const SDK_VARIANTS: Record<NyvPlatformVariant, NyvSDKVariantConfig> = {
  'nyayamitra': {
    platformCode: 'nyayamitra',
    displayName: 'Nyayamitra',
    fullName: 'Nyayamitra™ — Citizen Legal Intake',
    audience: 'Citizens seeking legal assistance',
    description: 'Consumer-facing legal intake platform. Simplified AI interactions for citizens navigating the Indian legal system. Supports 22 Indian languages via Sarvam AI.',
    appType: 'consumer_intake',
    sdkClientId: 'nyv_app_nyayamitra_consumer_intake_v1',
    apiPrefix: '/api/nys/nym',
    dbPrefix: 'nym_',
    tier: 'plus',
    defaultJurisdiction: 'IN',
    supportedJurisdictions: ['IN'],
    defaultLLM: 'gemini-2.5-flash',
    fallbackLLM: 'gpt-4.1-nano',
    llmTier: 'minimal',
    maxTokensPerRequest: 2048,
    rateLimitPerMinute: 100,
    dailyRequestLimit: 5000,
    dailyTokenBudget: 500_000,
    monthlyTokenBudget: 15_000_000,
    defaultAgentTokenLimit: 50_000,
    storageQuotaGb: 5,
    maxDocSizeMb: 25,
    temperature: 0.5,
    allocatedAgentCategories: [
      'legal-intake', 'citizen-guidance', 'document-assistant',
      'fir-drafting', 'complaint-drafting', 'rti-assistant',
      'consumer-protection', 'family-law', 'property-law',
      'labour-law', 'criminal-law-basics', 'nyayamitra-bot',
    ],
    allocatedPatterns: [
      'NyayaRAG', 'HumanInTheLoop', 'MultiModalLegal',
      'ConversationalAgent', 'DocumentAnalysis',
    ],
    features: {
      orchestration: true,
      streaming: true,
      rag: true,
      documentAnalysis: true,
      voiceSTT: true,
      voiceTTS: true,
      memoryTiers: [1, 2],
      digitalTwin: false,
      mcpTools: false,
      caseManagement: false,
      clientManagement: false,
      billing: false,
      compliance: true,
      auditLog: true,
      piiVault: true,
      halluccinationCheck: true,
      multiJurisdiction: false,
      a2aCollaboration: false,
      grpoOptimization: false,
      bmadClusters: false,
      customAgents: false,
      whatsappIntegration: true,
      emailAutomation: false,
      analytics: false,
      creditSystem: true,
    },
    // v5.0.1 (B2 fix 2026-05-06): added documents:write + translate:write so NYM
    // citizens can upload identity docs (FIR, complaints, RTI) and translate
    // legal text into 22 Indian languages. Smoke harness expectations updated.
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'translate:write'],
    webhookSupport: false,
    sandboxMode: false,
    complianceLevel: 'standard',
  },

  'nys-professional': {
    platformCode: 'nys-professional',
    displayName: 'Jurexio Professional',
    fullName: 'Jurexio Professional™ — Practice Management OS',
    audience: 'Solo lawyers, small and mid-size law firms',
    description: 'Full-featured legal practice management platform. Case management, client billing, document automation, AI-powered research, and court calendar integration.',
    appType: 'lawyer_platform',
    sdkClientId: 'nyv_app_nyayasiddhi_professional_v1',
    apiPrefix: '/api/nys/pro',
    dbPrefix: 'nys_pro_',
    tier: 'pro',
    defaultJurisdiction: 'IN',
    supportedJurisdictions: ['IN', 'UK', 'US', 'GC', 'SG', 'EU'],
    defaultLLM: 'claude-sonnet-4-6',
    fallbackLLM: 'gpt-4.1',
    llmTier: 'balanced',
    maxTokensPerRequest: 16384,
    rateLimitPerMinute: 60,
    dailyRequestLimit: 20_000,
    dailyTokenBudget: 200_000,
    monthlyTokenBudget: 6_000_000,
    defaultAgentTokenLimit: 25_000,
    storageQuotaGb: 150,
    maxDocSizeMb: 100,
    temperature: 0.7,
    allocatedAgentCategories: [
      'contract-review', 'contract-review-deep', 'legal-research', 'case-analysis',
      'document-drafting', 'compliance-check', 'due-diligence',
      'court-filing', 'brief-generation', 'deposition-prep',
      'client-communication', 'billing-automation', 'calendar-management',
      'ip-analysis', 'trademark-search', 'litigation-strategy',
      'mediation-support', 'arbitration-prep', 'legal-translation',
    ],
    allocatedPatterns: [
      'NyayaRAG', 'HumanInTheLoop', 'MultiModalLegal',
      'ConversationalAgent', 'DocumentAnalysis', 'JudgeSimulator',
      'ParallelResearch', 'IterativeRefinement', 'ChainOfLegalThought',
      'AdversarialReview', 'PrecedentMining', 'ContractNegotiation',
    ],
    features: {
      orchestration: true,
      streaming: true,
      rag: true,
      documentAnalysis: true,
      voiceSTT: true,
      voiceTTS: true,
      memoryTiers: [1, 2, 3],
      digitalTwin: true,
      mcpTools: true,
      caseManagement: true,
      clientManagement: true,
      billing: true,
      compliance: true,
      auditLog: true,
      piiVault: true,
      halluccinationCheck: true,
      multiJurisdiction: true,
      a2aCollaboration: true,
      grpoOptimization: false,
      bmadClusters: false,
      customAgents: true,
      whatsappIntegration: true,
      emailAutomation: true,
      analytics: true,
      creditSystem: true,
    },
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
    webhookSupport: true,
    sandboxMode: false,
    complianceLevel: 'enhanced',
  },

  'nys-institutional': {
    platformCode: 'nys-institutional',
    displayName: 'Jurexio Institutional',
    fullName: 'Jurexio Institutional™ — Enterprise Legal Governance',
    audience: 'Large law firms, multinational corporations, conglomerates',
    description: 'Enterprise-grade legal governance platform. Multi-tenant architecture, advanced compliance, federated privacy, GRPO optimization, BMAD clusters, and sovereign AI deployment.',
    appType: 'institutional',
    sdkClientId: 'nyv_app_nyayasiddhi_institutional_v1',
    apiPrefix: '/api/nys/ins',
    dbPrefix: 'nys_ins_',
    tier: 'enterprise',
    defaultJurisdiction: 'IN',
    supportedJurisdictions: ['IN', 'UK', 'US', 'GC', 'SG', 'EU'],
    defaultLLM: 'claude-opus-4-6',
    fallbackLLM: 'o3',
    llmTier: 'premium',
    maxTokensPerRequest: 32768,
    rateLimitPerMinute: 600,
    dailyRequestLimit: 200_000,
    dailyTokenBudget: 1_000_000,
    monthlyTokenBudget: 30_000_000,
    defaultAgentTokenLimit: 100_000,
    storageQuotaGb: 1000,
    maxDocSizeMb: 500,
    temperature: 0.7,
    allocatedAgentCategories: [
      'contract-review', 'contract-review-deep', 'legal-research', 'case-analysis',
      'document-drafting', 'compliance-check', 'due-diligence',
      'court-filing', 'brief-generation', 'deposition-prep',
      'client-communication', 'billing-automation', 'calendar-management',
      'ip-analysis', 'trademark-search', 'litigation-strategy',
      'mediation-support', 'arbitration-prep', 'legal-translation',
      'regulatory-analysis', 'risk-assessment', 'esg-compliance',
      'cross-border-advisory', 'ma-due-diligence', 'board-governance',
      'whistleblower-management', 'sanctions-screening', 'aml-kyc',
      'data-privacy-audit', 'eu-ai-act-compliance',
    ],
    allocatedPatterns: [
      'NyayaRAG', 'HumanInTheLoop', 'MultiModalLegal',
      'ConversationalAgent', 'DocumentAnalysis', 'JudgeSimulator',
      'ParallelResearch', 'IterativeRefinement', 'ChainOfLegalThought',
      'AdversarialReview', 'PrecedentMining', 'ContractNegotiation',
      'HierarchicalOrchestration', 'FederatedPrivacy', 'BatchProcessing',
      'RealTimeMonitoring', 'SelfHealingPipeline', 'AutonomousExecution',
      'MultiAgentDebate', 'ConsensusBuilding', 'EscalationChain',
      'GRPOOptimization',
    ],
    features: {
      orchestration: true,
      streaming: true,
      rag: true,
      documentAnalysis: true,
      voiceSTT: true,
      voiceTTS: true,
      memoryTiers: [1, 2, 3, 4, 5],
      digitalTwin: true,
      mcpTools: true,
      caseManagement: true,
      clientManagement: true,
      billing: true,
      compliance: true,
      auditLog: true,
      piiVault: true,
      halluccinationCheck: true,
      multiJurisdiction: true,
      a2aCollaboration: true,
      grpoOptimization: true,
      bmadClusters: true,
      customAgents: true,
      whatsappIntegration: true,
      emailAutomation: true,
      analytics: true,
      creditSystem: true,
    },
    scopes: ['*'],
    webhookSupport: true,
    sandboxMode: false,
    complianceLevel: 'sovereign',
  },

  'nys-academy': {
    platformCode: 'nys-academy',
    displayName: 'Jurexio Academy',
    fullName: 'Jurexio Academy™ — Legal Intelligence Training',
    audience: 'Law students, legal professionals, bar associations',
    description: 'Legal education and training platform. Moot court simulation, exam preparation, case study analysis, and professional development with AI tutoring.',
    appType: 'education',
    sdkClientId: 'nyv_app_nyayasiddhi_academy_v1',
    apiPrefix: '/api/nys/ace',
    dbPrefix: 'nys_ace_',
    tier: 'pro',
    defaultJurisdiction: 'IN',
    supportedJurisdictions: ['IN', 'UK', 'US'],
    defaultLLM: 'gpt-4.1',
    fallbackLLM: 'gemini-2.5-flash',
    llmTier: 'balanced',
    maxTokensPerRequest: 8192,
    rateLimitPerMinute: 80,
    dailyRequestLimit: 5000,
    dailyTokenBudget: 300_000,
    monthlyTokenBudget: 9_000_000,
    defaultAgentTokenLimit: 30_000,
    storageQuotaGb: 50,
    maxDocSizeMb: 50,
    temperature: 0.6,
    allocatedAgentCategories: [
      'legal-research', 'case-analysis', 'moot-court-judge',
      'exam-tutor', 'legal-writing-coach', 'citation-checker',
      'statute-explainer', 'precedent-analyzer', 'quiz-generator',
      'legal-reasoning-trainer', 'argument-evaluator', 'curriculum-planner',
    ],
    allocatedPatterns: [
      'NyayaRAG', 'HumanInTheLoop', 'ConversationalAgent',
      'DocumentAnalysis', 'JudgeSimulator', 'ParallelResearch',
      'ChainOfLegalThought', 'AdversarialReview', 'PrecedentMining',
      'IterativeRefinement',
    ],
    features: {
      orchestration: true,
      streaming: true,
      rag: true,
      documentAnalysis: true,
      voiceSTT: true,
      voiceTTS: false,
      memoryTiers: [1, 2],
      digitalTwin: false,
      mcpTools: true,
      caseManagement: false,
      clientManagement: false,
      billing: false,
      compliance: true,
      auditLog: true,
      piiVault: false,
      halluccinationCheck: true,
      multiJurisdiction: true,
      a2aCollaboration: false,
      grpoOptimization: false,
      bmadClusters: false,
      customAgents: false,
      whatsappIntegration: false,
      emailAutomation: false,
      analytics: true,
      creditSystem: true,
    },
    // v5.0.1 (B2 fix 2026-05-06): added translate:write so academy users can
    // translate case-law and judgments into Indian languages for study.
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'research:read', 'translate:write'],
    webhookSupport: false,
    sandboxMode: true,
    complianceLevel: 'standard',
  },

  'nys-ministry': {
    platformCode: 'nys-ministry',
    displayName: 'Jurexio Ministry',
    fullName: 'Jurexio Ministry™ — Sovereign Regulatory Governance',
    audience: 'Government ministries, regulatory bodies, judiciary',
    description: 'Sovereign government infrastructure platform. PQC-ready encryption, air-gapped deployment option, regulatory compliance automation, and judicial analytics.',
    appType: 'government',
    sdkClientId: 'nyv_app_nyayasiddhi_governance_v1',
    apiPrefix: '/api/nys/gov',
    dbPrefix: 'nys_min_',
    tier: 'government',
    defaultJurisdiction: 'IN',
    supportedJurisdictions: ['IN'],
    defaultLLM: 'o3',
    fallbackLLM: 'claude-opus-4-6',
    llmTier: 'sovereign',
    maxTokensPerRequest: 32768,
    rateLimitPerMinute: 200,
    dailyRequestLimit: 200_000,
    dailyTokenBudget: 2_000_000,
    monthlyTokenBudget: 60_000_000,
    defaultAgentTokenLimit: 200_000,
    storageQuotaGb: -1,
    maxDocSizeMb: 1000,
    temperature: 0.3,
    allocatedAgentCategories: [
      'regulatory-analysis', 'policy-drafting', 'legislative-review',
      'judicial-analytics', 'case-backlog-management', 'statute-harmonization',
      'inter-ministry-coordination', 'public-grievance', 'rti-processing',
      'sanctions-screening', 'aml-kyc', 'data-privacy-audit',
      'court-efficiency', 'prison-reform-analytics', 'legal-aid-allocation',
      'election-law', 'constitutional-analysis', 'international-treaty',
      'diplomatic-advisory', 'sovereign-compliance',
    ],
    allocatedPatterns: [
      'NyayaRAG', 'HumanInTheLoop', 'MultiModalLegal',
      'ConversationalAgent', 'DocumentAnalysis', 'JudgeSimulator',
      'ParallelResearch', 'IterativeRefinement', 'ChainOfLegalThought',
      'AdversarialReview', 'PrecedentMining', 'HierarchicalOrchestration',
      'FederatedPrivacy', 'BatchProcessing', 'RealTimeMonitoring',
      'SelfHealingPipeline', 'AutonomousExecution', 'MultiAgentDebate',
      'ConsensusBuilding', 'EscalationChain', 'GRPOOptimization',
      'SovereignDeployment',
    ],
    features: {
      orchestration: true,
      streaming: true,
      rag: true,
      documentAnalysis: true,
      voiceSTT: true,
      voiceTTS: true,
      memoryTiers: [1, 2, 3, 4, 5],
      digitalTwin: true,
      mcpTools: true,
      caseManagement: true,
      clientManagement: false,
      billing: false,
      compliance: true,
      auditLog: true,
      piiVault: true,
      halluccinationCheck: true,
      multiJurisdiction: false,
      a2aCollaboration: true,
      grpoOptimization: true,
      bmadClusters: true,
      customAgents: true,
      whatsappIntegration: false,
      emailAutomation: true,
      analytics: true,
      creditSystem: false,
    },
    scopes: ['*'],
    webhookSupport: true,
    sandboxMode: false,
    complianceLevel: 'sovereign',
  },
};

export function getVariant(platform: NyvPlatformVariant): NyvSDKVariantConfig {
  return SDK_VARIANTS[platform];
}

export function getAllVariants(): NyvSDKVariantConfig[] {
  return Object.values(SDK_VARIANTS);
}

export function generateDemoApiKey(platform: NyvPlatformVariant, environment: 'live' | 'test'): string {
  const prefix = environment === 'live' ? 'nyv_live_sk_' : 'nyv_test_sk_';
  const platformShort = {
    'nyayamitra': 'nym',
    'nys-professional': 'nsp',
    'nys-institutional': 'nsi',
    'nys-academy': 'nsa',
    'nys-ministry': 'nsm',
  }[platform];
  const random = crypto.randomBytes(24).toString('hex');
  return `${prefix}${platformShort}_${random}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function getKeyPrefix(key: string): string {
  return key.substring(0, key.indexOf('_', key.indexOf('_', 4) + 1) + 5) + '...';
}

export const SDK_VARIANT_SUMMARY = Object.entries(SDK_VARIANTS).map(([code, v]) => ({
  platform: code,
  name: v.displayName,
  tier: v.tier,
  llm: v.defaultLLM,
  rateLimit: `${v.rateLimitPerMinute} rpm / ${v.dailyRequestLimit.toLocaleString()} rpd`,
  agents: v.allocatedAgentCategories.length,
  patterns: v.allocatedPatterns.length,
  features: Object.entries(v.features).filter(([, enabled]) => enabled === true || (Array.isArray(enabled) && enabled.length > 0)).length,
}));
