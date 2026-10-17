/**
 * Agent Configuration — Jurexio Global Legal SDK v5.1
 *
 * ALL agent-related hardcoded values live here:
 *  - Tier capability maps + token budgets
 *  - ROMA (Regulatory Orchestration & Management Architecture) levels
 *  - Jurisdiction codes + practice-area catalogue
 *  - Feature flags per tier
 *  - Platform registry (inter-service rate limits)
 *  - Agent execution defaults
 *
 * Import from here instead of scattering magic numbers through routes/middleware.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TIER DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export type AgentTier = 'solo' | 'plus' | 'pro' | 'enterprise';
export type RomaLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type Jurisdiction = 'IN' | 'GCC' | 'UK' | 'EU' | 'US' | 'SG' | 'AU' | 'CA' | 'GLOBAL';

export const TIER_CONFIG: Record<AgentTier, {
  label: string;
  maxTokens: number;
  creditsPerMonth: number;
  rateLimit: { windowMs: number; maxRequests: number };
  features: string[];
  romaLevel: RomaLevel;
}> = {
  solo: {
    label: 'Solo',
    maxTokens: 1024,
    creditsPerMonth: 50,
    rateLimit: { windowMs: 60_000, maxRequests: 30 },
    features: ['hallucination_check'],
    romaLevel: 'L1',
  },
  plus: {
    label: 'Plus',
    maxTokens: 2048,
    creditsPerMonth: 200,
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    features: ['hallucination_check', 'rag', 'memory', 'citation_verify'],
    romaLevel: 'L2',
  },
  pro: {
    label: 'Pro',
    maxTokens: 4096,
    creditsPerMonth: 500,
    rateLimit: { windowMs: 60_000, maxRequests: 120 },
    features: ['hallucination_check', 'rag', 'memory', 'citation_verify', 'hitl', 'explainability', 'bias_audit'],
    romaLevel: 'L3',
  },
  enterprise: {
    label: 'Enterprise',
    maxTokens: 8192,
    creditsPerMonth: -1, // unlimited
    rateLimit: { windowMs: 60_000, maxRequests: 500 },
    features: [
      'hallucination_check', 'rag', 'memory', 'citation_verify',
      'hitl', 'explainability', 'bias_audit',
      'pii_redact', 'quantum_audit', 'cross_jurisdictional',
    ],
    romaLevel: 'L5',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ROMA LEVEL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export const ROMA_LEVELS: Record<RomaLevel, {
  name: string;
  description: string;
  auditRequired: boolean;
  hitlThreshold: number; // confidence below this triggers HITL
  explainabilityRequired: boolean;
}> = {
  L1: {
    name: 'Basic',
    description: 'Single-agent, no audit trail',
    auditRequired: false,
    hitlThreshold: 0,
    explainabilityRequired: false,
  },
  L2: {
    name: 'Standard',
    description: 'Audit log + basic explainability',
    auditRequired: true,
    hitlThreshold: 0,
    explainabilityRequired: false,
  },
  L3: {
    name: 'Professional',
    description: 'Full HITL + bias audit + citation verify',
    auditRequired: true,
    hitlThreshold: 0.75,
    explainabilityRequired: true,
  },
  L4: {
    name: 'Institutional',
    description: 'Cross-agent consensus + immutable audit',
    auditRequired: true,
    hitlThreshold: 0.85,
    explainabilityRequired: true,
  },
  L5: {
    name: 'Sovereign',
    description: 'Quantum-grade audit + regulatory attestation',
    auditRequired: true,
    hitlThreshold: 0.90,
    explainabilityRequired: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION CATALOGUE
// ─────────────────────────────────────────────────────────────────────────────

export const JURISDICTION_CONFIG: Record<Jurisdiction, {
  name: string;
  agentJsonFile: string;
  privacyLaw: string;
  currency: string;
  dateFormat: string;
  enabled: boolean;
}> = {
  IN: {
    name: 'India',
    agentJsonFile: 'agents-india.json',
    privacyLaw: 'DPDPA 2023',
    currency: 'INR',
    dateFormat: 'DD/MM/YYYY',
    enabled: true,
  },
  GCC: {
    name: 'GCC Region',
    agentJsonFile: 'agents-uae.json',
    privacyLaw: 'PDPL 2021',
    currency: 'AED',
    dateFormat: 'DD/MM/YYYY',
    enabled: true,
  },
  UK: {
    name: 'United Kingdom',
    agentJsonFile: 'agents-uk.json',
    privacyLaw: 'UK GDPR',
    currency: 'GBP',
    dateFormat: 'DD/MM/YYYY',
    enabled: true,
  },
  EU: {
    name: 'European Union',
    agentJsonFile: 'agents-eu.json',
    privacyLaw: 'GDPR',
    currency: 'EUR',
    dateFormat: 'DD/MM/YYYY',
    enabled: true,
  },
  US: {
    name: 'United States',
    agentJsonFile: 'agents-us.json',
    privacyLaw: 'CCPA / State Laws',
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    enabled: true,
  },
  SG: {
    name: 'Singapore',
    agentJsonFile: 'agents-sg.json',
    privacyLaw: 'PDPA 2012',
    currency: 'SGD',
    dateFormat: 'DD/MM/YYYY',
    enabled: true,
  },
  AU: {
    name: 'Australia',
    agentJsonFile: 'agents-au.json',
    privacyLaw: 'Privacy Act 1988',
    currency: 'AUD',
    dateFormat: 'DD/MM/YYYY',
    enabled: false, // planned
  },
  CA: {
    name: 'Canada',
    agentJsonFile: 'agents-ca.json',
    privacyLaw: 'PIPEDA / Bill C-27',
    currency: 'CAD',
    dateFormat: 'YYYY-MM-DD',
    enabled: false, // planned
  },
  GLOBAL: {
    name: 'Global',
    agentJsonFile: 'agents-global.json',
    privacyLaw: 'Multi-jurisdictional',
    currency: 'USD',
    dateFormat: 'ISO 8601',
    enabled: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM INTER-SERVICE REGISTRY
// Consolidates the hardcoded map from inter-service-auth.ts
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformId = string;

export const PLATFORM_REGISTRY: Record<PlatformId, {
  tier: AgentTier;
  defaultRateLimit: number; // requests per minute
  description: string;
}> = {
  'Nyayamitra': { tier: 'plus', defaultRateLimit: 200, description: 'Citizen Legal Aid' },
  'NS Professional': { tier: 'pro', defaultRateLimit: 300, description: 'Practice OS (basic plan)' },
  'NS Professional Pro': { tier: 'enterprise', defaultRateLimit: 500, description: 'Practice OS (pro plan)' },
  'NI Institutional': { tier: 'enterprise', defaultRateLimit: 800, description: 'Legal Governance' },
  'NMIN Ministry': { tier: 'enterprise', defaultRateLimit: 300, description: 'Regulatory Infrastructure' },
  'NACAD Academy': { tier: 'enterprise', defaultRateLimit: 300, description: 'Legal Training Platform' },
  'SDK Automation': { tier: 'enterprise', defaultRateLimit: 1500, description: 'Programmatic API access' },
};

// ─────────────────────────────────────────────────────────────────────────────
// PRACTICE AREA CATALOGUE (29 areas)
// ─────────────────────────────────────────────────────────────────────────────

export const PRACTICE_AREAS = [
  'Constitutional Law', 'Criminal Law', 'Civil Law', 'Corporate Law',
  'Contract Law', 'Intellectual Property', 'Tax Law', 'Labour Law',
  'Family Law', 'Property Law', 'Banking & Finance', 'Insurance Law',
  'Environmental Law', 'International Trade', 'Human Rights', 'Arbitration',
  'Competition Law', 'Data Privacy', 'Immigration Law', 'Maritime Law',
  'Energy Law', 'Healthcare Law', 'Technology Law', 'Media Law',
  'Securities Law', 'Real Estate Law', 'Administrative Law',
  'Cyber Law', 'General Practice',
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// AGENT EXECUTION DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_EXECUTION = {
  defaultTimeout: parseInt(process.env.AGENT_TIMEOUT_MS || '30000', 10),
  maxRetries: parseInt(process.env.AGENT_MAX_RETRIES || '3', 10),
  retryDelayMs: 1000,
  defaultTemperature: 0.7,
  defaultMaxTokens: TIER_CONFIG.pro.maxTokens,
  batchSize: 50, // DB upsert batch size for agent registry sync
  confidenceThreshold: 0.75, // below this, flag for HITL review
  hallucination: {
    enabled: true,
    threshold: 0.8,
    maxChecksPerRequest: 3,
  },
  memory: {
    maxEntriesPerSession: 50,
    ttlHours: 24,
    similarityThreshold: 0.85,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS
// ─────────────────────────────────────────────────────────────────────────────

export const FEATURE_FLAGS = {
  agentRegistrySync: process.env.AGENT_REGISTRY_SYNC !== 'false',
  hitlEnabled: process.env.HITL_ENABLED !== 'false',
  ragEnabled: process.env.RAG_ENABLED !== 'false',
  memoryEnabled: process.env.MEMORY_ENABLED !== 'false',
  hallucinationCheck: process.env.HALLUCINATION_CHECK !== 'false',
  biasAudit: process.env.BIAS_AUDIT !== 'false',
  piiRedaction: process.env.PII_REDACTION !== 'false',
  quantumAudit: process.env.QUANTUM_AUDIT === 'true',
  crossJurisdictional: process.env.CROSS_JURISDICTIONAL !== 'false',
  agentMarketplace: process.env.AGENT_MARKETPLACE === 'true',
  predictiveAI: process.env.PREDICTIVE_AI === 'true',
  redTeam: process.env.RED_TEAM === 'true',
  vectorSearch: process.env.VECTOR_SEARCH !== 'false',
  dpdpaConsentCheck: process.env.DPDPA_CONSENT_CHECK !== 'false',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATION PATTERN DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

export const ORCHESTRATION_PATTERNS = {
  single: { maxAgents: 1, timeoutMs: 30_000 },
  sequential: { maxAgents: 10, timeoutMs: 120_000, delayBetweenMs: 500 },
  parallel: { maxAgents: 20, timeoutMs: 60_000, concurrencyLimit: 5 },
  dag: { maxNodes: 30, maxEdges: 50, timeoutMs: 180_000 },
  swarm: { minAgents: 3, maxAgents: 50, consensusThreshold: 0.67, timeoutMs: 300_000 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Get tier config for a subscription plan string (handles legacy names) */
export function getTierConfig(plan: string): typeof TIER_CONFIG[AgentTier] {
  const normalized = plan?.toLowerCase().replace(/[^a-z]/g, '') as AgentTier;
  return TIER_CONFIG[normalized] ?? TIER_CONFIG.solo;
}

/** Check if a feature is available for a given tier */
export function tierHasFeature(tier: AgentTier, feature: string): boolean {
  return TIER_CONFIG[tier]?.features.includes(feature) ?? false;
}

/** Get platform tier from platform ID (for inter-service auth) */
export function getPlatformTier(platformId: string): AgentTier {
  return PLATFORM_REGISTRY[platformId]?.tier ?? 'solo';
}

/** Get max tokens for a tier */
export function getMaxTokensForTier(tier: AgentTier): number {
  return TIER_CONFIG[tier]?.maxTokens ?? TIER_CONFIG.solo.maxTokens;
}
