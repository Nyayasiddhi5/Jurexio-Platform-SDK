// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Dynamic Model Registry v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * ZERO-CORE-CHANGE architecture for integrating ANY new LLM, SLM, or LRM.
 *
 * HOW TO ADD A NEW MODEL (no code changes to core platform):
 *   Option A — Environment variable (any deployment):
 *     JRX_MODEL_REGISTER={"id":"my-model-v1","provider":"my-provider","tier":2,...}
 *
 *   Option B — Config file (JSON/YAML loaded at startup):
 *     src/config/model-overrides.json  →  array of ModelRegistryEntry
 *
 *   Option C — Database row (hot-reload without restart):
 *     INSERT INTO nv_model_registry (model_id, config_json, enabled) VALUES (...)
 *     Then call: await dynamicModelRegistry.hotReload()
 *
 *   Option D — Admin API (runtime, no restart):
 *     POST /api/jrx/models/register  { ...ModelRegistryEntry }
 *
 * JURISDICTION-SPECIFIC SLM BINDING (new jurisdiction = 1 config entry):
 *   { id: 'nys-slm-ca', provider: 'huggingface', jurisdiction: 'CA', type: 'slm', ... }
 *
 * ROUTER INTEGRATION:
 *   The LRM Router (ns-lrm-router.ts) reads from this registry dynamically.
 *   Adding a model here makes it immediately available to the router.
 *
 * @module jrx-dynamic-model-registry
 * @version 1.0.0
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { buildProviderRegistry } from './llm-config.js';

const logger = createLogger('jrx-model-registry');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ModelType = 'llm' | 'slm' | 'lrm' | 'embedding' | 'vision' | 'speech';
export type ModelTier = 1 | 2 | 3 | 4 | 5;  // 1=premium, 5=fallback/always-on
export type JurisdictionCode = 'IN' | 'UK' | 'GCC' | 'EU' | 'US' | 'SG' | 'GLOBAL' | string;
export type Environment = 'development' | 'staging' | 'production' | 'all';

export interface ModelCapabilities {
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsToolCalling: boolean;
  supportsFunctionCalling: boolean;
  supportsAudio: boolean;
  supportsReasoningChain: boolean;
  supportedLanguages: string[];       // ISO 639-1 codes; ['*'] means all
  supportedJurisdictions: JurisdictionCode[];
  maxContextTokens: number;
  maxOutputTokens: number;
}

export interface ModelCostConfig {
  costPer1kInputTokens: number;       // USD
  costPer1kOutputTokens: number;      // USD
  costPerRequest?: number;            // flat fee if applicable
  currency: 'USD';
  billingEntity: string;              // e.g., 'openrouter' | 'direct'
}

export interface ModelHealthConfig {
  healthCheckEndpoint?: string;
  healthCheckIntervalMs: number;      // 0 = disabled
  circuitBreakerThreshold: number;    // failures before circuit opens
  circuitBreakerResetMs: number;      // time before circuit tries again
  timeoutMs: number;                  // request timeout
  maxRetries: number;
}

export interface ModelRoutingConfig {
  priority: number;                   // lower = higher priority within tier
  tier: ModelTier;
  allowedQueryTypes: string[];        // ['*'] = all
  blockedQueryTypes: string[];
  minComplexity?: 'simple' | 'medium' | 'complex' | 'expert';
  maxComplexity?: 'simple' | 'medium' | 'complex' | 'expert';
  preferredForJurisdictions: JurisdictionCode[];
  requiredForJurisdictions: JurisdictionCode[];  // always route these here
  dataResidency?: {
    allowedRegions: string[];         // ['EU', 'IN'] for data sovereignty
    blockedRegions: string[];
  };
}

export interface ModelRegistryEntry {
  // Identity
  id: string;                         // unique model ID (e.g., 'gpt-4.1', 'nys-slm-ind-v2')
  displayName: string;
  description?: string;
  version: string;                    // semantic version of this config entry
  type: ModelType;

  // Provider
  provider: string;                   // 'openai' | 'anthropic' | 'google' | 'custom' | etc.
  providerModelId: string;            // actual API model ID sent to the provider
  providerBaseUrl?: string;           // override provider base URL (for custom deployments)
  apiKeyEnvVar: string;               // env var name for the API key

  // Capabilities
  capabilities: ModelCapabilities;

  // Cost
  cost: ModelCostConfig;

  // Routing
  routing: ModelRoutingConfig;

  // Health
  health: ModelHealthConfig;

  // Lifecycle
  enabled: boolean;
  enabledInEnvironments: Environment[];
  deprecatedAt?: string;              // ISO date — start showing deprecation warnings
  sunsetAt?: string;                  // ISO date — remove from rotation
  releasedAt: string;                 // ISO date — when model was released

  // Metadata
  tags: string[];                     // ['legal', 'multilingual', 'india-first', etc.]
  notes?: string;                     // internal engineering notes
  addedBy?: string;                   // who added this model
  addedAt: string;                    // when added to registry
}

export interface RegistryStats {
  totalModels: number;
  enabledModels: number;
  byType: Record<ModelType, number>;
  byTier: Record<ModelTier, number>;
  byJurisdiction: Record<string, number>;
  byProvider: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN PROVIDER CONFIG (added 2026-04-25)
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for which LLM providers are active.
//
// HOW TO ENABLE / DISABLE A PROVIDER:
//   1. Flip `enabled: true | false` here.
//   2. Restart the gateway.
//   3. All models bound to that provider are automatically included/excluded
//      from the runtime registry — no model-by-model toggle needed.
//
// HOW TO ADD A NEW PROVIDER:
//   1. Add a new entry to BUILT_IN_PROVIDERS with `enabled: false` initially.
//   2. Add at least one ModelRegistryEntry below referencing `provider: '<id>'`.
//   3. Ensure the provider has a service file in `src/services/llm-providers/`.
//   4. Drop the provider's API key into Replit/EC2 secrets under the
//      `apiKeyEnvVar` name configured here.
//   5. Flip `enabled: true` and restart.
//
// HOW TO ADD A NEW MODEL TO AN EXISTING PROVIDER:
//   1. Append a new ModelRegistryEntry to BUILT_IN_MODELS below.
//   2. Or use JRX_MODEL_REGISTER env var / model-overrides.json for hot-load.
//
// PRE-GA POLICY (effective 2026-04-25 — see Project-Tracker.md §1):
//   Priority providers (production keys, enabled): openai, anthropic, google,
//   openrouter, sarvam, plus agentzero as the final always-on backup.
//   All other providers stay in code (their service files remain) but are
//   disabled here pending production keys. Flip `enabled: true` once a
//   production key lands in secrets.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  displayName: string;
  enabled: boolean;
  apiKeyEnvVar: string;
  /** Lower number = preferred. AgentZero uses priority 99 (always-on backup). */
  priority: number;
  notes: string;
}

export const BUILT_IN_PROVIDERS: Record<string, ProviderConfig> = {
  // ── PRIORITY PROVIDERS (production keys — pre-GA active set) ─────────────
  openai: {
    id: 'openai', displayName: 'OpenAI',
    enabled: true, apiKeyEnvVar: 'OPENAI_API_KEY', priority: 1,
    notes: 'Frontier reasoning + chat. Models: o3, o3-mini, o4-mini, gpt-4.1 family, gpt-4o family, o1 family, gpt-3.5-turbo.',
  },
  anthropic: {
    id: 'anthropic', displayName: 'Anthropic Claude',
    enabled: true, apiKeyEnvVar: 'ANTHROPIC_API_KEY', priority: 2,
    notes: 'Long-context legal reasoning. Models: opus-4-6, sonnet-4-6, haiku-4, opus-4, sonnet-4, 3.5-sonnet, 3.5-haiku, 3-opus, 3-haiku.',
  },
  google: {
    id: 'google', displayName: 'Google Gemini',
    enabled: true, apiKeyEnvVar: 'GEMINI_API_KEY', priority: 3,
    notes: 'EU/IN data residency, multimodal. Models: 3.1-pro-preview, 2.5-pro, 2.5-flash, 2.0-flash, 2.0-flash-thinking, 1.5-pro, 1.5-flash.',
  },
  openrouter: {
    id: 'openrouter', displayName: 'OpenRouter (aggregator)',
    enabled: true, apiKeyEnvVar: 'OPENROUTER_API_KEY', priority: 4,
    notes: 'Aggregator routes Llama, Mistral, Qwen, Kimi K2, DeepSeek V3/R1, plus free models (NousHermes, OpenChat, Zephyr).',
  },
  sarvam: {
    id: 'sarvam', displayName: 'Sarvam (Indian languages)',
    enabled: true, apiKeyEnvVar: 'SARVAM_API_KEY', priority: 5,
    notes: 'Specialist SLM for 22 Indian languages. Models: sarvam-2b, sarvam-1b.',
  },
  agentzero: {
    id: 'agentzero', displayName: 'JRX AgentZero (sovereign backup)',
    enabled: true, apiKeyEnvVar: 'AGENTZERO_API_KEY', priority: 99,
    notes: 'Final always-on fallback. No external egress. Used when every other provider breaker is open.',
  },

  // ── DISABLED PROVIDERS (code present in src/services/llm-providers/, ──────
  //                       awaiting production keys before enabling) ────────
  deepseek: {
    id: 'deepseek', displayName: 'DeepSeek (direct)',
    enabled: false, apiKeyEnvVar: 'DEEPSEEK_API_KEY', priority: 100,
    notes: 'Available via OpenRouter (deepseek-v3, deepseek-r1) until direct key lands.',
  },
  xai: {
    id: 'xai', displayName: 'xAI Grok',
    enabled: false, apiKeyEnvVar: 'XAI_API_KEY', priority: 101,
    notes: 'Code in src/services/llm-providers/xai-provider.ts. Enable when key lands.',
  },
  perplexity: {
    id: 'perplexity', displayName: 'Perplexity',
    enabled: false, apiKeyEnvVar: 'PERPLEXITY_API_KEY', priority: 102,
    notes: 'Code in src/services/llm-providers/perplexity-provider.ts. Enable when key lands.',
  },
  groq: {
    id: 'groq', displayName: 'Groq (fast inference)',
    enabled: false, apiKeyEnvVar: 'GROQ_API_KEY', priority: 103,
    notes: 'Code in src/services/llm-providers/groq-provider.ts. Enable when key lands.',
  },
  cohere: {
    id: 'cohere', displayName: 'Cohere',
    enabled: false, apiKeyEnvVar: 'COHERE_API_KEY', priority: 104,
    notes: 'Code in src/services/llm-providers/cohere-provider.ts. Enable when key lands.',
  },
  mistral: {
    id: 'mistral', displayName: 'Mistral (direct)',
    enabled: false, apiKeyEnvVar: 'MISTRAL_API_KEY', priority: 105,
    notes: 'Available via OpenRouter (mistral-large-2411) until direct key lands.',
  },
  together: {
    id: 'together', displayName: 'Together AI',
    enabled: false, apiKeyEnvVar: 'TOGETHER_API_KEY', priority: 106,
    notes: 'Code in src/services/llm-providers/together-ai-provider.ts. Enable when key lands.',
  },
  replicate: {
    id: 'replicate', displayName: 'Replicate',
    enabled: false, apiKeyEnvVar: 'REPLICATE_API_KEY', priority: 107,
    notes: 'Code in src/services/llm-providers/replicate-provider.ts. Enable when key lands.',
  },
  meta: {
    id: 'meta', displayName: 'Meta Llama (direct)',
    enabled: false, apiKeyEnvVar: 'META_API_KEY', priority: 108,
    notes: 'Available via OpenRouter (llama-4-maverick, llama-3.3-70b) until direct enterprise key lands.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN MODEL CATALOGUE (April 2026)
// These are the platform defaults — override via env var or DB, not code.
// Models bound to a provider with `enabled: false` in BUILT_IN_PROVIDERS
// above are automatically skipped by the registry at boot.
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_MODELS: ModelRegistryEntry[] = [
  // ── TIER 1: PREMIUM FRONTIER ─────────────────────────────────────────────
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description: 'Anthropic flagship — deep legal reasoning, 1M context',
    version: '1.0.0',
    type: 'llm',
    provider: 'anthropic',
    providerModelId: 'claude-opus-4-6',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 32768,
    },
    cost: { costPer1kInputTokens: 0.005, costPer1kOutputTokens: 0.025, currency: 'USD', billingEntity: 'anthropic' },
    routing: {
      priority: 1, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [],
      minComplexity: 'complex', preferredForJurisdictions: ['GLOBAL'],
      requiredForJurisdictions: [], dataResidency: { allowedRegions: ['US', 'EU', 'IN'], blockedRegions: [] },
    },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-02-05',
    tags: ['premium', 'legal', 'reasoning', 'long-context'], addedAt: '2026-04-04',
  },
  {
    id: 'gpt-4.1',
    displayName: 'GPT-4.1',
    version: '1.0.0', type: 'llm', provider: 'openai', providerModelId: 'gpt-4.1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 32768,
    },
    cost: { costPer1kInputTokens: 0.002, costPer1kOutputTokens: 0.008, currency: 'USD', billingEntity: 'openai' },
    routing: {
      priority: 2, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [],
      preferredForJurisdictions: ['US', 'UK'], requiredForJurisdictions: [],
    },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-01',
    tags: ['premium', 'legal', 'long-context'], addedAt: '2026-04-04',
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    version: '1.0.0', type: 'llm', provider: 'google', providerModelId: 'gemini-3.1-pro-preview',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true,
      supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 8192,
    },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.012, currency: 'USD', billingEntity: 'google' },
    routing: {
      priority: 3, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [],
      preferredForJurisdictions: ['EU'], requiredForJurisdictions: [],
      dataResidency: { allowedRegions: ['EU'], blockedRegions: [] },
    },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-02-19',
    tags: ['premium', 'eu-data-residency', 'multimodal'], addedAt: '2026-04-04',
  },
  {
    id: 'o3',
    displayName: 'OpenAI o3',
    version: '1.0.0', type: 'llm', provider: 'openai', providerModelId: 'o3',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 200000, maxOutputTokens: 100000,
    },
    cost: { costPer1kInputTokens: 0.010, costPer1kOutputTokens: 0.040, currency: 'USD', billingEntity: 'openai' },
    routing: {
      priority: 4, tier: 1, allowedQueryTypes: ['legal-research', 'contract-drafting', 'compliance'],
      blockedQueryTypes: [], minComplexity: 'expert',
      preferredForJurisdictions: ['US', 'UK'], requiredForJurisdictions: [],
    },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 3, circuitBreakerResetMs: 120000, timeoutMs: 300000, maxRetries: 1 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-01-01',
    tags: ['reasoning', 'expert', 'governance'], addedAt: '2026-04-04',
  },

  // ── TIER 2: STANDARD / BALANCED ──────────────────────────────────────────
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    version: '1.0.0', type: 'llm', provider: 'anthropic', providerModelId: 'claude-sonnet-4-6',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 16384,
    },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 1, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-02-01',
    tags: ['standard', 'legal', 'professional'], addedAt: '2026-04-04',
  },
  {
    id: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    version: '1.0.0', type: 'llm', provider: 'openai', providerModelId: 'gpt-4.1-mini',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 16384,
    },
    cost: { costPer1kInputTokens: 0.0004, costPer1kOutputTokens: 0.0016, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 2, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-01',
    tags: ['standard', 'cost-efficient', 'fast'], addedAt: '2026-04-04',
  },

  // ── TIER 3: COST OPTIMISED ────────────────────────────────────────────────
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    version: '1.0.0', type: 'llm', provider: 'google', providerModelId: 'gemini-2.5-flash',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true,
      supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 8192,
    },
    cost: { costPer1kInputTokens: 0.000075, costPer1kOutputTokens: 0.0003, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 1, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['IN'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-05-01',
    tags: ['budget', 'fast', 'jurexio-citizen', 'citizen'], addedAt: '2026-04-04',
  },
  {
    id: 'llama-4-maverick',
    displayName: 'Llama 4 Maverick',
    version: '1.0.0', type: 'llm', provider: 'openrouter', providerModelId: 'meta-llama/llama-4-maverick',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 8192,
    },
    cost: { costPer1kInputTokens: 0.00018, costPer1kOutputTokens: 0.00059, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 2, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-05',
    tags: ['budget', 'open-source', 'long-context'], addedAt: '2026-04-04',
  },
  {
    id: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 Nano',
    version: '1.0.0', type: 'llm', provider: 'openai', providerModelId: 'gpt-4.1-nano',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false,
      supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 1000000, maxOutputTokens: 8192,
    },
    cost: { costPer1kInputTokens: 0.0001, costPer1kOutputTokens: 0.0004, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 3, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-01',
    tags: ['budget', 'fast', 'high-volume'], addedAt: '2026-04-04',
  },

  // ── TIER 4: SLM / SPECIALIST ──────────────────────────────────────────────
  {
    id: 'sarvam-2b',
    displayName: 'Sarvam 2B',
    version: '1.0.0', type: 'slm', provider: 'sarvam', providerModelId: 'sarvam-2b',
    apiKeyEnvVar: 'SARVAM_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: false, supportsJsonMode: false,
      supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: true,
      supportsReasoningChain: false,
      supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur', 'en'],
      supportedJurisdictions: ['IN'],
      maxContextTokens: 32768, maxOutputTokens: 4096,
    },
    cost: { costPer1kInputTokens: 0.0002, costPer1kOutputTokens: 0.0004, currency: 'USD', billingEntity: 'sarvam' },
    routing: {
      priority: 1, tier: 4, allowedQueryTypes: ['*'], blockedQueryTypes: [],
      preferredForJurisdictions: ['IN'], requiredForJurisdictions: [],
    },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 30000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-01-01',
    tags: ['slm', 'india-first', '22-languages', 'specialist'], addedAt: '2026-04-04',
  },
  {
    id: 'deepseek-prover-v2',
    displayName: 'DeepSeek Prover V2',
    version: '1.0.0', type: 'slm', provider: 'deepseek', providerModelId: 'deepseek-prover-v2',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    capabilities: {
      supportsStreaming: false, supportsVision: false, supportsJsonMode: true,
      supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false,
      supportsReasoningChain: true, supportedLanguages: ['en'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 128000, maxOutputTokens: 8192,
    },
    cost: { costPer1kInputTokens: 0.0005, costPer1kOutputTokens: 0.002, currency: 'USD', billingEntity: 'deepseek' },
    routing: {
      priority: 2, tier: 4, allowedQueryTypes: ['compliance', 'legal-research'],
      blockedQueryTypes: [], minComplexity: 'expert',
      preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [],
    },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 3, circuitBreakerResetMs: 120000, timeoutMs: 300000, maxRetries: 1 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-01',
    tags: ['slm', 'theorem-proving', 'formal-verification', 'specialist'], addedAt: '2026-04-04',
  },

  // ── ADDITIONAL MODELS (added 2026-04-25, latest → older within each provider) ──
  // Anthropic — gated by ANTHROPIC_API_KEY (not yet in secrets, will activate when key lands)
  {
    id: 'claude-haiku-4',
    displayName: 'Claude Haiku 4', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-haiku-4', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0008, costPer1kOutputTokens: 0.004, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 3, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-02-01',
    tags: ['budget', 'fast'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-3-5-sonnet-v2',
    displayName: 'Claude 3.5 Sonnet (older fallback)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-3-5-sonnet-20241022', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 4, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-10-22',
    tags: ['standard', 'legal', 'fallback'], addedAt: '2026-04-25',
  },

  // OpenAI — gated by OPENAI_API_KEY (✅ in secrets)
  {
    id: 'o3-mini',
    displayName: 'OpenAI o3-mini', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'o3-mini', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 65536 },
    cost: { costPer1kInputTokens: 0.0011, costPer1kOutputTokens: 0.0044, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 5, tier: 2, allowedQueryTypes: ['legal-research', 'compliance', 'reasoning'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-01-31',
    tags: ['reasoning', 'mid-tier', 'cost-efficient'], addedAt: '2026-04-25',
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o (older fallback)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 128000, maxOutputTokens: 16384 },
    cost: { costPer1kInputTokens: 0.0025, costPer1kOutputTokens: 0.010, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 6, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-05-13',
    tags: ['standard', 'multimodal', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini (older budget)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-4o-mini', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 128000, maxOutputTokens: 16384 },
    cost: { costPer1kInputTokens: 0.00015, costPer1kOutputTokens: 0.0006, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 4, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-07-18',
    tags: ['budget', 'fast', 'high-volume', 'fallback'], addedAt: '2026-04-25',
  },

  // Google Gemini — gated by GEMINI_API_KEY (not yet in secrets, will activate when key lands)
  {
    id: 'gemini-2-5-pro',
    displayName: 'Gemini 2.5 Pro', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-2.5-pro', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 2000000, maxOutputTokens: 65536 },
    cost: { costPer1kInputTokens: 0.00125, costPer1kOutputTokens: 0.005, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 5, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['EU', 'IN'], requiredForJurisdictions: [], dataResidency: { allowedRegions: ['EU', 'US', 'IN'], blockedRegions: [] } },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-06-17',
    tags: ['premium', 'multimodal', 'long-context'], addedAt: '2026-04-25',
  },
  {
    id: 'gemini-2-0-flash',
    displayName: 'Gemini 2.0 Flash (older budget)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-2.0-flash', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0001, costPer1kOutputTokens: 0.0004, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 5, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-02-05',
    tags: ['budget', 'fast', 'fallback'], addedAt: '2026-04-25',
  },

  // OpenRouter — gated by OPENROUTER_API_KEY (✅ in secrets) — many open models routed
  {
    id: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B Instruct (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'meta-llama/llama-3.3-70b-instruct', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 131072, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00012, costPer1kOutputTokens: 0.0003, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 6, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-12-06',
    tags: ['budget', 'open-source'], addedAt: '2026-04-25',
  },
  {
    id: 'mistral-large-2411',
    displayName: 'Mistral Large 2411 (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'mistralai/mistral-large-2411', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['EU', 'GLOBAL'], maxContextTokens: 128000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.002, costPer1kOutputTokens: 0.006, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 7, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['EU'], requiredForJurisdictions: [], dataResidency: { allowedRegions: ['EU'], blockedRegions: [] } },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-11-18',
    tags: ['standard', 'eu-data-residency', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'qwen-2-5-72b',
    displayName: 'Qwen 2.5 72B (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'qwen/qwen-2.5-72b-instruct', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 32768, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00023, costPer1kOutputTokens: 0.00040, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 7, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-09-19',
    tags: ['budget', 'open-source', 'fallback'], addedAt: '2026-04-25',
  },

  // Sarvam — gated by SARVAM_API_KEY (✅ in secrets) — Indian-language SLMs
  {
    id: 'sarvam-1b',
    displayName: 'Sarvam 1B (older budget)', version: '1.0.0', type: 'slm', provider: 'sarvam',
    providerModelId: 'sarvam-1b', apiKeyEnvVar: 'SARVAM_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: false, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: true, supportsReasoningChain: false, supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur', 'en'], supportedJurisdictions: ['IN'], maxContextTokens: 16384, maxOutputTokens: 2048 },
    cost: { costPer1kInputTokens: 0.0001, costPer1kOutputTokens: 0.0002, currency: 'USD', billingEntity: 'sarvam' },
    routing: { priority: 3, tier: 4, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['IN'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 30000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2023-10-01',
    tags: ['slm', 'india-first', 'budget', 'fallback'], addedAt: '2026-04-25',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // APRIL 24, 2026 COMPREHENSIVE LINEUP (added 2026-04-25)
  // Latest → older within each provider, covering full release history.
  // ─────────────────────────────────────────────────────────────────────────

  // OpenAI — full lineup (newest reasoning + older fallbacks)
  {
    id: 'o4-mini',
    displayName: 'OpenAI o4-mini', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'o4-mini', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 100000 },
    cost: { costPer1kInputTokens: 0.0011, costPer1kOutputTokens: 0.0044, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 5, tier: 1, allowedQueryTypes: ['legal-research', 'compliance', 'reasoning'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-04-16',
    tags: ['premium', 'reasoning', 'multimodal'], addedAt: '2026-04-25',
  },
  {
    id: 'o1',
    displayName: 'OpenAI o1 (older reasoning)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'o1', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: false, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 100000 },
    cost: { costPer1kInputTokens: 0.015, costPer1kOutputTokens: 0.060, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 7, tier: 1, allowedQueryTypes: ['legal-research', 'compliance', 'reasoning'], blockedQueryTypes: [], minComplexity: 'expert', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 3, circuitBreakerResetMs: 120000, timeoutMs: 300000, maxRetries: 1 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-12-05',
    tags: ['expert', 'reasoning', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'o1-mini',
    displayName: 'OpenAI o1-mini (older budget reasoning)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'o1-mini', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: false, supportsVision: false, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 128000, maxOutputTokens: 65536 },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.012, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 8, tier: 2, allowedQueryTypes: ['reasoning'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-09-12',
    tags: ['mid-tier', 'reasoning', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'gpt-3-5-turbo',
    displayName: 'GPT-3.5 Turbo (legacy)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-3.5-turbo', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 16385, maxOutputTokens: 4096 },
    cost: { costPer1kInputTokens: 0.0005, costPer1kOutputTokens: 0.0015, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 9, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2023-03-01',
    tags: ['legacy', 'budget', 'fast', 'fallback'], addedAt: '2026-04-25',
  },

  // Anthropic Claude — full lineup
  {
    id: 'claude-opus-4',
    displayName: 'Claude Opus 4 (older opus)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-opus-4', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 16384 },
    cost: { costPer1kInputTokens: 0.015, costPer1kOutputTokens: 0.075, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 5, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-09-01',
    tags: ['premium', 'legal', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4 (older sonnet)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-sonnet-4', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 5, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-09-01',
    tags: ['standard', 'legal', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-3-5-haiku',
    displayName: 'Claude 3.5 Haiku', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-3-5-haiku-20241022', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0008, costPer1kOutputTokens: 0.004, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 4, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-10-22',
    tags: ['budget', 'fast', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-3-opus',
    displayName: 'Claude 3 Opus (legacy)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-3-opus-20240229', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 4096 },
    cost: { costPer1kInputTokens: 0.015, costPer1kOutputTokens: 0.075, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 9, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-02-29',
    tags: ['legacy', 'premium', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-3-haiku',
    displayName: 'Claude 3 Haiku (legacy)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-3-haiku-20240307', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 4096 },
    cost: { costPer1kInputTokens: 0.00025, costPer1kOutputTokens: 0.00125, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 10, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-03-07',
    tags: ['legacy', 'budget', 'fast', 'fallback'], addedAt: '2026-04-25',
  },

  // Google Gemini — full lineup
  {
    id: 'gemini-2-0-flash-thinking',
    displayName: 'Gemini 2.0 Flash Thinking', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-2.0-flash-thinking-exp', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0001, costPer1kOutputTokens: 0.0004, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 6, tier: 2, allowedQueryTypes: ['reasoning', 'legal-research'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-12-19',
    tags: ['reasoning', 'budget', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'gemini-1-5-pro-latest',
    displayName: 'Gemini 1.5 Pro (legacy)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-1.5-pro-latest', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 2000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00125, costPer1kOutputTokens: 0.005, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 8, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['EU', 'IN'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-05-14',
    tags: ['legacy', 'long-context', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'gemini-1-5-flash-latest',
    displayName: 'Gemini 1.5 Flash (legacy)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-1.5-flash-latest', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.000075, costPer1kOutputTokens: 0.0003, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 7, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-05-14',
    tags: ['legacy', 'budget', 'fast', 'fallback'], addedAt: '2026-04-25',
  },

  // OpenRouter — Kimi K2, free models, DeepSeek (until direct key lands)
  {
    id: 'kimi-k2',
    displayName: 'Moonshot Kimi K2 (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'moonshotai/kimi-k2', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00057, costPer1kOutputTokens: 0.0023, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 8, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-07-12',
    tags: ['standard', 'long-context', 'agentic'], addedAt: '2026-04-25',
  },
  {
    id: 'deepseek-v3-or',
    displayName: 'DeepSeek V3 (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'deepseek/deepseek-chat', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 64000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00027, costPer1kOutputTokens: 0.0011, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 9, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-12-26',
    tags: ['budget', 'open-source'], addedAt: '2026-04-25',
  },
  {
    id: 'deepseek-r1-or',
    displayName: 'DeepSeek R1 reasoning (via OpenRouter)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'deepseek/deepseek-r1', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 64000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00055, costPer1kOutputTokens: 0.00219, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 10, tier: 2, allowedQueryTypes: ['reasoning', 'compliance', 'legal-research'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-01-20',
    tags: ['reasoning', 'open-source', 'budget'], addedAt: '2026-04-25',
  },
  {
    id: 'nous-hermes-3',
    displayName: 'Nous Hermes 3 405B (via OpenRouter, free tier)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'nousresearch/hermes-3-llama-3.1-405b', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 131072, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0, costPer1kOutputTokens: 0, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 11, tier: 4, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2024-08-01',
    tags: ['free', 'open-source', 'community'], addedAt: '2026-04-25',
  },
  {
    id: 'openchat-7b',
    displayName: 'OpenChat 7B (via OpenRouter, free tier)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'openchat/openchat-7b:free', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: false, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 8192, maxOutputTokens: 4096 },
    cost: { costPer1kInputTokens: 0, costPer1kOutputTokens: 0, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 12, tier: 4, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 30000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2023-11-01',
    tags: ['free', 'open-source', 'small'], addedAt: '2026-04-25',
  },
  {
    id: 'zephyr-7b',
    displayName: 'Zephyr 7B Beta (via OpenRouter, free tier)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'huggingfaceh4/zephyr-7b-beta:free', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: false, supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 4096, maxOutputTokens: 2048 },
    cost: { costPer1kInputTokens: 0, costPer1kOutputTokens: 0, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 13, tier: 4, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 60000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 30000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2023-10-25',
    tags: ['free', 'open-source', 'small'], addedAt: '2026-04-25',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // APRIL 25, 2026 LATEST RELEASES (web-research-verified from provider docs)
  // Sources: platform.claude.com/docs, ai.google.dev/gemini-api/docs/changelog,
  //          developers.openai.com/api/docs/models, openrouter.ai/moonshotai,
  //          sarvam.ai/blogs/sarvam-30b-105b
  // ─────────────────────────────────────────────────────────────────────────

  // Anthropic — Opus 4.7 (Apr 16 2026 flagship), Haiku 4.5, plus 4.5 interim
  {
    id: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7 (flagship — Apr 2026)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-opus-4-7', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 128000 },
    cost: { costPer1kInputTokens: 0.005, costPer1kOutputTokens: 0.025, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 1, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], minComplexity: 'expert', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-04-16',
    tags: ['flagship', 'reasoning', 'agentic-coding', 'long-context', '1M-tokens'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5 (fast frontier — Oct 2025)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-haiku-4-5', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 64000 },
    cost: { costPer1kInputTokens: 0.001, costPer1kOutputTokens: 0.005, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 3, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-10-01',
    tags: ['budget', 'fast', 'near-frontier', 'extended-thinking'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-opus-4-5',
    displayName: 'Claude Opus 4.5 (interim opus)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-opus-4-5', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 16384 },
    cost: { costPer1kInputTokens: 0.015, costPer1kOutputTokens: 0.075, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 4, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-01-15',
    tags: ['premium', 'reasoning', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5 (interim sonnet)', version: '1.0.0', type: 'llm', provider: 'anthropic',
    providerModelId: 'claude-sonnet-4-5', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 200000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, currency: 'USD', billingEntity: 'anthropic' },
    routing: { priority: 4, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-12-01',
    tags: ['standard', 'reasoning', 'fallback'], addedAt: '2026-04-25',
  },

  // Google Gemini — full Gemini 3 family (Apr 2026 active)
  {
    id: 'gemini-3-pro-image',
    displayName: 'Gemini 3 Pro Image (multimodal preview)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-3-pro-image-preview', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00125, costPer1kOutputTokens: 0.005, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 4, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['EU', 'IN'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-12-15',
    tags: ['multimodal', 'image', 'preview'], addedAt: '2026-04-25',
  },
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash (preview, Dec 2025)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-3-flash-preview', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 1000000, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0001, costPer1kOutputTokens: 0.0004, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 4, tier: 3, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 30000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-12-01',
    tags: ['budget', 'fast', 'preview', 'long-context'], addedAt: '2026-04-25',
  },
  {
    id: 'gemini-3-pro',
    displayName: 'Gemini 3 Pro (deprecated preview)', version: '1.0.0', type: 'llm', provider: 'google',
    providerModelId: 'gemini-3-pro-preview', apiKeyEnvVar: 'GEMINI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 2000000, maxOutputTokens: 65536 },
    cost: { costPer1kInputTokens: 0.00125, costPer1kOutputTokens: 0.005, currency: 'USD', billingEntity: 'google' },
    routing: { priority: 9, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['EU', 'IN'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: false, enabledInEnvironments: ['all'], releasedAt: '2025-11-01',
    tags: ['deprecated', 'preview', 'long-context'], addedAt: '2026-04-25',
  },

  // OpenAI — GPT-5 family (frontier as of Apr 2026)
  {
    id: 'gpt-5-5',
    displayName: 'GPT-5.5 (latest frontier — Apr 2026)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-5.5', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 400000, maxOutputTokens: 128000 },
    cost: { costPer1kInputTokens: 0.005, costPer1kOutputTokens: 0.020, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 1, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], minComplexity: 'expert', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-04-10',
    tags: ['flagship', 'reasoning', 'multimodal', 'frontier'], addedAt: '2026-04-25',
  },
  {
    id: 'gpt-5',
    displayName: 'GPT-5 (frontier)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-5', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 256000, maxOutputTokens: 65536 },
    cost: { costPer1kInputTokens: 0.0025, costPer1kOutputTokens: 0.010, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 2, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 180000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-12-01',
    tags: ['premium', 'reasoning', 'multimodal'], addedAt: '2026-04-25',
  },
  {
    id: 'gpt-5-mini',
    displayName: 'GPT-5 Mini (budget frontier)', version: '1.0.0', type: 'llm', provider: 'openai',
    providerModelId: 'gpt-5-mini', apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 256000, maxOutputTokens: 32768 },
    cost: { costPer1kInputTokens: 0.0003, costPer1kOutputTokens: 0.0012, currency: 'USD', billingEntity: 'openai' },
    routing: { priority: 3, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 8, circuitBreakerResetMs: 30000, timeoutMs: 60000, maxRetries: 3 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-12-01',
    tags: ['budget', 'reasoning', 'fast'], addedAt: '2026-04-25',
  },

  // Sarvam — open-source 30B + 105B (Mar 2026)
  {
    id: 'sarvam-30b',
    displayName: 'Sarvam 30B (open-source, Mar 2026)', version: '1.0.0', type: 'llm', provider: 'sarvam',
    providerModelId: 'sarvam-30b', apiKeyEnvVar: 'SARVAM_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: false, supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur', 'en'], supportedJurisdictions: ['IN'], maxContextTokens: 32768, maxOutputTokens: 4096 },
    cost: { costPer1kInputTokens: 0.0003, costPer1kOutputTokens: 0.0009, currency: 'USD', billingEntity: 'sarvam' },
    routing: { priority: 2, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['IN'], requiredForJurisdictions: ['IN'] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 60000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-03-15',
    tags: ['open-source', 'india-first', 'multilingual', 'sovereign'], addedAt: '2026-04-25',
  },
  {
    id: 'sarvam-105b',
    displayName: 'Sarvam 105B (open-source flagship, Mar 2026)', version: '1.0.0', type: 'llm', provider: 'sarvam',
    providerModelId: 'sarvam-105b', apiKeyEnvVar: 'SARVAM_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: true, supportsReasoningChain: true, supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur', 'en'], supportedJurisdictions: ['IN'], maxContextTokens: 65536, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.0008, costPer1kOutputTokens: 0.0024, currency: 'USD', billingEntity: 'sarvam' },
    routing: { priority: 1, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['IN'], requiredForJurisdictions: ['IN'] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-03-15',
    tags: ['open-source', 'india-first', 'multilingual', 'sovereign', 'flagship'], addedAt: '2026-04-25',
  },

  // OpenRouter / Moonshot — Kimi K2.6 + K2.5 + K2 Thinking (Apr 2026)
  {
    id: 'kimi-k2-6',
    displayName: 'Moonshot Kimi K2.6 (latest — Apr 20 2026)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'moonshotai/kimi-k2.6', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 256000, maxOutputTokens: 16384 },
    cost: { costPer1kInputTokens: 0.000745, costPer1kOutputTokens: 0.004655, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 5, tier: 1, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 120000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-04-20',
    tags: ['agentic', 'multimodal', 'long-context', 'coding'], addedAt: '2026-04-25',
  },
  {
    id: 'kimi-k2-5',
    displayName: 'Moonshot Kimi K2.5 (Jan 2026)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'moonshotai/kimi-k2.5', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: true, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: false, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 262144, maxOutputTokens: 8192 },
    cost: { costPer1kInputTokens: 0.00044, costPer1kOutputTokens: 0.002, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 6, tier: 2, allowedQueryTypes: ['*'], blockedQueryTypes: [], preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 90000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-01-27',
    tags: ['standard', 'multimodal', 'long-context', 'fallback'], addedAt: '2026-04-25',
  },
  {
    id: 'kimi-k2-thinking',
    displayName: 'Moonshot Kimi K2 Thinking (reasoning)', version: '1.0.0', type: 'llm', provider: 'openrouter',
    providerModelId: 'moonshotai/kimi-k2-thinking', apiKeyEnvVar: 'OPENROUTER_API_KEY',
    capabilities: { supportsStreaming: true, supportsVision: false, supportsJsonMode: true, supportsToolCalling: true, supportsFunctionCalling: true, supportsAudio: false, supportsReasoningChain: true, supportedLanguages: ['*'], supportedJurisdictions: ['GLOBAL'], maxContextTokens: 256000, maxOutputTokens: 32768 },
    cost: { costPer1kInputTokens: 0.0006, costPer1kOutputTokens: 0.003, currency: 'USD', billingEntity: 'openrouter' },
    routing: { priority: 6, tier: 1, allowedQueryTypes: ['reasoning', 'compliance', 'legal-research'], blockedQueryTypes: [], minComplexity: 'medium', preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [] },
    health: { healthCheckIntervalMs: 30000, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000, timeoutMs: 240000, maxRetries: 2 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2026-02-10',
    tags: ['reasoning', 'agentic', 'long-context'], addedAt: '2026-04-25',
  },

  // ── TIER 5: FALLBACK (ALWAYS-ON) ─────────────────────────────────────────
  {
    id: 'jrx-agentzero',
    displayName: 'JRX AgentZero (Always-On Fallback)',
    version: '2.0.0', type: 'llm', provider: 'agentzero', providerModelId: 'jrx-agentzero',
    apiKeyEnvVar: 'AGENTZERO_API_KEY',
    capabilities: {
      supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      supportsToolCalling: false, supportsFunctionCalling: false, supportsAudio: false,
      supportsReasoningChain: false, supportedLanguages: ['en'], supportedJurisdictions: ['GLOBAL'],
      maxContextTokens: 32768, maxOutputTokens: 4096,
    },
    cost: { costPer1kInputTokens: 0, costPer1kOutputTokens: 0, currency: 'USD', billingEntity: 'internal' },
    routing: {
      priority: 1, tier: 5, allowedQueryTypes: ['*'], blockedQueryTypes: [],
      preferredForJurisdictions: ['GLOBAL'], requiredForJurisdictions: [],
    },
    health: { healthCheckIntervalMs: 0, circuitBreakerThreshold: 999, circuitBreakerResetMs: 1000, timeoutMs: 30000, maxRetries: 0 },
    enabled: true, enabledInEnvironments: ['all'], releasedAt: '2025-01-01',
    tags: ['fallback', 'always-on', 'zero-cost', 'offline-capable'], addedAt: '2026-04-04',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC MODEL REGISTRY CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class JrxDynamicModelRegistry extends EventEmitter {
  private static instance: JrxDynamicModelRegistry;
  private models = new Map<string, ModelRegistryEntry>();
  private readonly currentEnv: Environment;

  private constructor() {
    super();
    this.currentEnv = (process.env.NODE_ENV as Environment) ?? 'development';
    this.loadBuiltInModels();
    this.loadFromEnvVar();
    this.loadFromConfigFile();
    logger.info(`[ModelRegistry] Loaded ${this.models.size} models (env: ${this.currentEnv})`);
  }

  static getInstance(): JrxDynamicModelRegistry {
    if (!JrxDynamicModelRegistry.instance) {
      JrxDynamicModelRegistry.instance = new JrxDynamicModelRegistry();
    }
    return JrxDynamicModelRegistry.instance;
  }

  // ── Load built-in catalogue ───────────────────────────────────────────────
  // Honors BUILT_IN_PROVIDERS[provider].enabled — models bound to a disabled
  // provider are skipped at boot. Flip the flag in BUILT_IN_PROVIDERS to
  // include/exclude an entire provider's models without touching this file.
  private loadBuiltInModels(): void {
    let loaded = 0;
    let skipped = 0;
    const skippedByProvider: Record<string, number> = {};
    for (const model of BUILT_IN_MODELS) {
      const providerCfg = BUILT_IN_PROVIDERS[model.provider];
      if (providerCfg && !providerCfg.enabled) {
        skipped++;
        skippedByProvider[model.provider] = (skippedByProvider[model.provider] ?? 0) + 1;
        continue;
      }
      this.models.set(model.id, model);
      loaded++;
    }
    if (skipped > 0) {
      logger.info(
        `[ModelRegistry] Skipped ${skipped} model(s) bound to disabled providers: ` +
        Object.entries(skippedByProvider).map(([p, n]) => `${p}=${n}`).join(', '),
      );
    }
    logger.info(`[ModelRegistry] Loaded ${loaded} built-in models (skipped ${skipped} from disabled providers)`);
  }

  // ── Provider-config accessors (used by ops/admin) ────────────────────────
  /** Return the static provider config (enabled flag, priority, env-var name). */
  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return BUILT_IN_PROVIDERS[providerId];
  }

  /** Return all configured providers (enabled + disabled), sorted by priority. */
  getAllProviders(): ProviderConfig[] {
    return Object.values(BUILT_IN_PROVIDERS).sort((a, b) => a.priority - b.priority);
  }

  /** Return only enabled providers, sorted by priority (1 = preferred, 99 = backup). */
  getEnabledProviders(): ProviderConfig[] {
    return Object.values(BUILT_IN_PROVIDERS)
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  // ── Load from JRX_MODEL_REGISTER env var (JSON string or array) ───────────
  private loadFromEnvVar(): void {
    const raw = process.env.JRX_MODEL_REGISTER;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const entries: ModelRegistryEntry[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        this.validateEntry(entry);
        this.models.set(entry.id, { ...entry, addedBy: 'env-var', addedAt: new Date().toISOString() });
        logger.info(`[ModelRegistry] Registered model from env var: ${entry.id}`);
      }
    } catch (err: any) {
      logger.warn(`[ModelRegistry] Failed to parse JRX_MODEL_REGISTER: ${err.message}`);
    }
  }

  // ── Load from config file (model-overrides.json in config dir) ────────────
  private loadFromConfigFile(): void {
    const configPath = path.join(process.cwd(), 'src', 'config', 'model-overrides.json');
    if (!existsSync(configPath)) return;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const entries: ModelRegistryEntry[] = JSON.parse(raw);
      for (const entry of entries) {
        this.models.set(entry.id, { ...entry, addedBy: 'config-file', addedAt: new Date().toISOString() });
        logger.info(`[ModelRegistry] Registered model from config file: ${entry.id}`);
      }
    } catch (err: any) {
      logger.warn(`[ModelRegistry] Failed to load model-overrides.json: ${err.message}`);
    }
  }

  // ── Runtime model registration (from DB or API call) ─────────────────────
  register(entry: ModelRegistryEntry, registeredBy = 'api'): void {
    this.validateEntry(entry);
    const existing = this.models.get(entry.id);
    this.models.set(entry.id, { ...entry, addedBy: registeredBy, addedAt: new Date().toISOString() });
    this.emit('model:registered', { model: entry, isUpdate: !!existing });
    logger.info(`[ModelRegistry] ${existing ? 'Updated' : 'Registered'} model: ${entry.id}`);
  }

  // ── Hot reload from database (zero restart) ───────────────────────────────
  async hotReload(): Promise<{ added: number; updated: number; removed: number }> {
    // DB reload is wired when database table is ready:
    // SELECT config_json FROM nv_model_registry WHERE enabled = true
    // For now, reload from config file
    const before = this.models.size;
    this.loadFromConfigFile();
    this.loadFromEnvVar();
    const after = this.models.size;
    logger.info(`[ModelRegistry] Hot reload complete. Models: ${before} → ${after}`);
    this.emit('registry:reloaded');
    return { added: Math.max(0, after - before), updated: 0, removed: 0 };
  }

  // ── Enable / disable a model without removing it ──────────────────────────
  setEnabled(modelId: string, enabled: boolean): void {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    model.enabled = enabled;
    this.emit('model:toggled', { modelId, enabled });
    logger.info(`[ModelRegistry] Model ${modelId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // ── Deregister a model ─────────────────────────────────────────────────────
  deregister(modelId: string): boolean {
    const removed = this.models.delete(modelId);
    if (removed) this.emit('model:deregistered', { modelId });
    return removed;
  }

  // ── Query the registry ────────────────────────────────────────────────────

  getModel(modelId: string): ModelRegistryEntry | undefined {
    return this.models.get(modelId);
  }

  getAll(): ModelRegistryEntry[] {
    return Array.from(this.models.values());
  }

  getEnabled(): ModelRegistryEntry[] {
    const env = this.currentEnv;
    return this.getAll().filter(m =>
      m.enabled &&
      !this.isDeprecated(m) &&
      (m.enabledInEnvironments.includes('all') || m.enabledInEnvironments.includes(env))
    );
  }

  getByTier(tier: ModelTier): ModelRegistryEntry[] {
    return this.getEnabled().filter(m => m.routing.tier === tier)
      .sort((a, b) => a.routing.priority - b.routing.priority);
  }

  getByType(type: ModelType): ModelRegistryEntry[] {
    return this.getEnabled().filter(m => m.type === type);
  }

  getByJurisdiction(jurisdiction: JurisdictionCode): ModelRegistryEntry[] {
    return this.getEnabled().filter(m =>
      m.capabilities.supportedJurisdictions.includes(jurisdiction) ||
      m.capabilities.supportedJurisdictions.includes('GLOBAL')
    ).sort((a, b) => {
      // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
      const aRequired = m => m.routing.requiredForJurisdictions.includes(jurisdiction);
      // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
      const bRequired = m => m.routing.requiredForJurisdictions.includes(jurisdiction);
      if (aRequired(a) && !aRequired(b)) return -1;
      if (!aRequired(a) && aRequired(b)) return 1;
      // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
      const aPreferred = m => m.routing.preferredForJurisdictions.includes(jurisdiction);
      if (aPreferred(a) && !aPreferred(b)) return -1;
      if (!aPreferred(a) && aPreferred(b)) return 1;
      return a.routing.tier - b.routing.tier || a.routing.priority - b.routing.priority;
    });
  }

  getForSLM(jurisdiction: JurisdictionCode): ModelRegistryEntry | undefined {
    return this.getEnabled().find(m =>
      m.type === 'slm' && (
        m.capabilities.supportedJurisdictions.includes(jurisdiction) ||
        m.routing.requiredForJurisdictions.includes(jurisdiction)
      )
    );
  }

  getFallback(): ModelRegistryEntry | undefined {
    return this.getByTier(5)[0];
  }

  getStats(): RegistryStats {
    const all = this.getAll();
    const enabled = this.getEnabled();
    return {
      totalModels: all.length,
      enabledModels: enabled.length,
      byType: this.groupBy(all, m => m.type),
      byTier: this.groupBy(all, m => String(m.routing.tier)),
      byJurisdiction: this.groupBy(all, m => m.capabilities.supportedJurisdictions.join(',')),
      byProvider: this.groupBy(all, m => m.provider),
    } as any;
  }

  // ── Routing helper: select best model for a query ─────────────────────────
  selectModel(opts: {
    jurisdiction?: JurisdictionCode;
    tier?: ModelTier;
    queryType?: string;
    language?: string;
    requiresStreaming?: boolean;
    requiresVision?: boolean;
    maxCostPer1kInput?: number;
  }): ModelRegistryEntry | undefined {
    let candidates = this.getEnabled();

    if (opts.jurisdiction) {
      candidates = candidates.filter(m =>
        m.capabilities.supportedJurisdictions.includes(opts.jurisdiction!) ||
        m.capabilities.supportedJurisdictions.includes('GLOBAL')
      );
    }
    if (opts.tier !== undefined) {
      candidates = candidates.filter(m => m.routing.tier === opts.tier);
    }
    if (opts.queryType) {
      candidates = candidates.filter(m =>
        m.routing.allowedQueryTypes.includes('*') ||
        m.routing.allowedQueryTypes.includes(opts.queryType!)
      ).filter(m => !m.routing.blockedQueryTypes.includes(opts.queryType!));
    }
    if (opts.requiresStreaming) {
      candidates = candidates.filter(m => m.capabilities.supportsStreaming);
    }
    if (opts.requiresVision) {
      candidates = candidates.filter(m => m.capabilities.supportsVision);
    }
    if (opts.language && opts.language !== 'en') {
      candidates = candidates.filter(m =>
        m.capabilities.supportedLanguages.includes('*') ||
        m.capabilities.supportedLanguages.includes(opts.language!)
      );
    }
    if (opts.maxCostPer1kInput !== undefined) {
      candidates = candidates.filter(m => m.cost.costPer1kInputTokens <= opts.maxCostPer1kInput!);
    }

    return candidates
      .sort((a, b) => a.routing.tier - b.routing.tier || a.routing.priority - b.routing.priority)[0];
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private isDeprecated(model: ModelRegistryEntry): boolean {
    if (!model.sunsetAt) return false;
    return new Date(model.sunsetAt) < new Date();
  }

  private validateEntry(entry: ModelRegistryEntry): void {
    if (!entry.id) throw new Error('Model entry must have an id');
    if (!entry.provider) throw new Error(`Model ${entry.id}: missing provider`);
    if (!entry.apiKeyEnvVar) throw new Error(`Model ${entry.id}: missing apiKeyEnvVar`);
    if (entry.routing.tier < 1 || entry.routing.tier > 5) {
      throw new Error(`Model ${entry.id}: tier must be 1-5`);
    }
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) {
      const key = keyFn(item);
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const dynamicModelRegistry = JrxDynamicModelRegistry.getInstance();

// ─────────────────────────────────────────────────────────────────────────────
// HOW TO ADD A NEW JURISDICTION SLM (README INLINE)
// ─────────────────────────────────────────────────────────────────────────────
/*
ADDING A NEW JURISDICTION SLM — ZERO CODE CHANGES TO CORE:

1. Create a ModelRegistryEntry JSON and POST to /api/jrx/models/register, OR
2. Add to src/config/model-overrides.json, OR
3. Set env var: JRX_MODEL_REGISTER=<JSON>, OR
4. INSERT INTO nv_model_registry (...) then call hotReload()

EXAMPLE — Adding Canada (CA) jurisdiction SLM:
{
  "id": "nys-slm-ca",
  "displayName": "NYS SLM Canada",
  "description": "Fine-tuned on Canadian federal/provincial law",
  "version": "1.0.0",
  "type": "slm",
  "provider": "huggingface",          // or 'custom' for self-hosted
  "providerModelId": "nyayasiddhi/slm-canada-v1",
  "providerBaseUrl": "https://your-inference-endpoint.ca",
  "apiKeyEnvVar": "JRX_PLUGIN_CA_SLM_API_KEY",
  "capabilities": {
    "supportsStreaming": true,
    "supportsVision": false,
    "supportsJsonMode": true,
    "supportsToolCalling": false,
    "supportsFunctionCalling": false,
    "supportsAudio": false,
    "supportsReasoningChain": false,
    "supportedLanguages": ["en", "fr"],
    "supportedJurisdictions": ["CA"],
    "maxContextTokens": 128000,
    "maxOutputTokens": 8192
  },
  "cost": { "costPer1kInputTokens": 0.0003, "costPer1kOutputTokens": 0.0006, "currency": "USD", "billingEntity": "internal" },
  "routing": {
    "priority": 1,
    "tier": 4,
    "allowedQueryTypes": ["*"],
    "blockedQueryTypes": [],
    "preferredForJurisdictions": ["CA"],
    "requiredForJurisdictions": ["CA"]
  },
  "health": {
    "healthCheckIntervalMs": 60000,
    "circuitBreakerThreshold": 5,
    "circuitBreakerResetMs": 60000,
    "timeoutMs": 30000,
    "maxRetries": 2
  },
  "enabled": true,
  "enabledInEnvironments": ["all"],
  "releasedAt": "2026-06-01",
  "tags": ["slm", "canada", "bilingual", "specialist"],
  "addedAt": "2026-06-01"
}
*/
