export type Provider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'together'
  | 'cohere'
  | 'xai'         // xAI Grok 4.x (May 2026: grok-4.20 / grok-4.20-reasoning, 2M ctx)
  | 'perplexity'  // Perplexity Sonar family — web-grounded answers
  | 'sarvam'      // Indic-language rail (May 2026: sarvam-105b / sarvam-30b / sarvam-m)
  | 'bedrock'     // AWS Bedrock — VPC-only Claude/Llama/Nova, SOC2/DPDPA-friendly
  | 'vertex'      // Google Vertex AI — EU/India residency Gemini
  | 'omniroute'   // OmniRoute AI gateway — last-mile cost/fallback provider pool
  | 'agentzero'
  | 'simulation';

export type TierLevel = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'superadmin';

export type AgentClass =
  | 'executive'
  | 'senior'
  | 'specialist'
  | 'standard'
  | 'support'
  | 'utility';

export type TaskKind =
  | 'legal_drafting'
  | 'legal_research'
  | 'contract_analysis'
  | 'litigation_strategy'
  | 'compliance_review'
  | 'chain_of_thought'
  | 'summarization'
  | 'classification'
  | 'extraction'
  | 'generic_chat'
  | 'vision'
  | 'json_structured';

// Canonical jurisdiction code is 'GC' (matches agent registry filenames
// `Jurexio-Legal-registry-GC.json`). The legacy 'GCC' alias is kept
// for back-compat in older callers and is normalized to 'GC' inside
// `pickSequence` (see intelligent-router.ts).
export type JurisdictionCode = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'GCC' | 'SG' | 'GLOBAL';

export interface ModelEntry {
  id: string;
  provider: Provider;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  costInPer1M: number;
  costOutPer1M: number;
  capabilities: {
    vision?: boolean;
    json?: boolean;
    streaming?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
    longContext?: boolean;
  };
  legalQuality: number;
  generalQuality: number;
  speedScore: number;
  isFree: boolean;
  isLatest?: boolean;
  jurisdictionFit?: Partial<Record<JurisdictionCode, number>>;
  preferredFor?: TaskKind[];
  notes?: string;
}

export interface RouterRequest {
  agentId?: string;
  agentClass?: AgentClass;
  userId?: string;
  userType?: string;
  tier?: TierLevel | string;
  plan?: string;
  organizationId?: string;
  jurisdiction?: JurisdictionCode | string;
  taskKind?: TaskKind;
  promptTokens?: number;
  expectedOutputTokens?: number;
  requireJson?: boolean;
  requireVision?: boolean;
  requireStreaming?: boolean;
  requireReasoning?: boolean;
  maxCostUsd?: number;
  /** Data sensitivity tier for governance routing (e.g., OmniRoute exclusion). */
  sensitivity?: 'low' | 'medium' | 'high' | 'critical';
  preferCheaper?: boolean;
  preferredModels?: string[];
  fallbackModels?: string[];
  forbiddenModels?: string[];
  patternKey?: string;
  app?: string;
  /** Partner DraftDocumentType slug — Sonnet-first drafting vs Opus litigation (R-DRAFT-NSP-QUALITY P0). */
  draftDocumentType?: string;
}

export interface ScoredCandidate {
  model: ModelEntry;
  score: number;
  reasons: string[];
}

export interface RouterDecision {
  primary: ModelEntry;
  sequence: ModelEntry[];
  reasonsByModel: Record<string, string[]>;
  inputs: Sanitized;
}

export interface Sanitized {
  tier: TierLevel;
  agentClass: AgentClass;
  taskKind: TaskKind;
  jurisdiction: JurisdictionCode;
  preferCheaper: boolean;
  promptTokens: number;
  expectedOutputTokens: number;
  hasMissingInputs: boolean;
}

export interface RouterCallOutcome {
  modelId: string;
  provider: Provider;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
}
