import { createLogger } from '../utils/logger.js';

const logger = createLogger('llm-config');

/**
 * Jurexio LLM Configuration v5.1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL LLM settings live here — no hardcoded model names or API endpoints
 * anywhere else in the codebase. Supports any provider via standard env vars.
 * Replit integration vars used as fallback only for backward-compat.
 *
 * Standard env vars (production / any cloud):
 *   OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY,
 *   GROQ_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY
 *
 * Replit fallback (only active if standard vars absent):
 *   AI_INTEGRATIONS_OPENROUTER_API_KEY, AI_INTEGRATIONS_OPENAI_API_KEY
 */

// ──────────────────────────────────────────────
// 1. PROVIDER REGISTRY
// ──────────────────────────────────────────────

export interface LLMProvider {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string | undefined;
  isAvailable: boolean;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  costPer1kInputTokens: number;  // USD
  costPer1kOutputTokens: number; // USD
}

function resolveKey(standard: string, replitFallback?: string): string | undefined {
  // Prefer runtime dashboard overlay (hot-applied) when available.
  try {
    // Lazy require avoids circular init with boot sequence.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveProviderSecret } = require('../services/jrx-runtime-provider-secrets.js') as typeof import('../services/jrx-runtime-provider-secrets.js');
    const fromOverlay = resolveProviderSecret(standard, ...(replitFallback ? [replitFallback] : []));
    if (fromOverlay) return fromOverlay;
  } catch {
    /* overlay not loaded yet */
  }
  return process.env[standard] || (replitFallback ? process.env[replitFallback] : undefined) || undefined;
}

function resolveUrl(standard: string, replitFallback?: string, defaultUrl?: string): string {
  return process.env[standard] || (replitFallback ? process.env[replitFallback] : undefined) || defaultUrl || '';
}

function envTruthy(v: string | undefined, defaultWhenUnset = false): boolean {
  if (v == null || v === '') return defaultWhenUnset;
  const s = v.toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

export function buildProviderRegistry(): Record<string, LLMProvider> {
  const openrouterKey = resolveKey('OPENROUTER_API_KEY', 'AI_INTEGRATIONS_OPENROUTER_API_KEY');
  const openrouterUrl = resolveUrl('OPENROUTER_BASE_URL', 'AI_INTEGRATIONS_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
  const openaiKey = resolveKey('OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY');
  const anthropicKey = resolveKey('ANTHROPIC_API_KEY');
  const googleKey =
    resolveKey('GOOGLE_API_KEY', 'GEMINI_API_KEY') ||
    String(process.env.GEMINI_API_KEYS || '').split(/[,;\n]+/).map((s) => s.trim()).find(Boolean);
  const groqKey = resolveKey('GROQ_API_KEY');
  const togetherKey = resolveKey('TOGETHER_API_KEY');
  const deepseekKey = resolveKey('DEEPSEEK_API_KEY');
  const mistralKey = resolveKey('MISTRAL_API_KEY');
  const omnirouteKey = resolveKey('OMNIROUTE_API_KEY');
  const omnirouteUrl = resolveUrl('OMNIROUTE_BASE_URL', undefined, 'https://api.omniroute.ai/v1');

  return {
    openrouter: {
      id: 'openrouter', name: 'OpenRouter',
      baseURL: openrouterUrl,
      apiKey: openrouterKey,
      isAvailable: !!openrouterKey,
      maxTokens: 32768, supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      costPer1kInputTokens: 0.0025, costPer1kOutputTokens: 0.010,
    },
    openai: {
      id: 'openai', name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      apiKey: openaiKey,
      isAvailable: !!openaiKey,
      maxTokens: 128000, supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      costPer1kInputTokens: 0.0015, costPer1kOutputTokens: 0.006,
    },
    anthropic: {
      id: 'anthropic', name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      apiKey: anthropicKey,
      isAvailable: !!anthropicKey,
      maxTokens: 200000, supportsStreaming: true, supportsVision: true, supportsJsonMode: false,
      costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015,
    },
    google: {
      id: 'google', name: 'Google Gemini',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: googleKey,
      isAvailable: !!googleKey,
      maxTokens: 1000000, supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      costPer1kInputTokens: 0.00035, costPer1kOutputTokens: 0.00105,
    },
    groq: {
      id: 'groq', name: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: groqKey,
      isAvailable: !!groqKey,
      maxTokens: 32768, supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      costPer1kInputTokens: 0.00009, costPer1kOutputTokens: 0.00009,
    },
    together: {
      id: 'together', name: 'Together AI',
      baseURL: 'https://api.together.xyz/v1',
      apiKey: togetherKey,
      isAvailable: !!togetherKey,
      maxTokens: 32768, supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      costPer1kInputTokens: 0.0002, costPer1kOutputTokens: 0.0002,
    },
    deepseek: {
      id: 'deepseek', name: 'DeepSeek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: deepseekKey,
      isAvailable: !!deepseekKey,
      maxTokens: 65536, supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      costPer1kInputTokens: 0.00014, costPer1kOutputTokens: 0.00028,
    },
    mistral: {
      id: 'mistral', name: 'Mistral AI',
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: mistralKey,
      isAvailable: !!mistralKey,
      maxTokens: 32768, supportsStreaming: true, supportsVision: false, supportsJsonMode: true,
      costPer1kInputTokens: 0.0002, costPer1kOutputTokens: 0.0006,
    },
    omniroute: {
      id: 'omniroute', name: 'OmniRoute AI Gateway',
      baseURL: omnirouteUrl,
      apiKey: omnirouteKey,
      // Enabled when key is present unless explicitly disabled (default true).
      isAvailable: !!omnirouteKey && envTruthy(process.env.NYV_OMNIROUTE_ENABLED, true),
      maxTokens: 1000000, supportsStreaming: true, supportsVision: true, supportsJsonMode: true,
      costPer1kInputTokens: 0.001, costPer1kOutputTokens: 0.003,
    },
  };
}

// ──────────────────────────────────────────────
// 2. MODEL CATALOGUE — all in config, never hardcoded elsewhere
// ──────────────────────────────────────────────

export const MODEL_CATALOGUE = {
  // Tier 1 — Expert / Frontier (April 2026)
  expert: {
    openrouter: 'anthropic/claude-opus-4-6',     // Claude Opus 4.6 — Feb 5, 2026, 1M ctx
    openai: 'gpt-4.1',                           // GPT-4.1 — Apr 2025, 1M ctx, real API ID
    anthropic: 'claude-opus-4-6',                // Direct Anthropic API ID
    google: 'gemini-3.1-pro-preview',            // Gemini 3.1 Pro — Feb 19, 2026
    reasoning: 'o3',                             // OpenAI o3 — deep reasoning
    omniroute: 'omniroute/auto/reliable',        // OmniRoute last-mile reliable fallback
  },
  // Tier 2 — Professional / Balanced
  professional: {
    openrouter: 'anthropic/claude-sonnet-4-6',   // Claude Sonnet 4.6 — Feb 2026, 1M ctx
    openai: 'gpt-4.1-mini',                      // GPT-4.1 Mini — 1M ctx, low latency
    anthropic: 'claude-sonnet-4-6',              // Direct Anthropic API ID
    google: 'gemini-3-1-pro-preview',            // Gemini 3.1 Pro — latest multilingual / reasoning
    reasoning: 'o4-mini',                        // OpenAI o4-mini — fast reasoning
    openrouter2: 'meta-llama/llama-4-maverick',  // Llama 4 Maverick — 1M ctx, MoE
    omniroute: 'omniroute/auto/reliable',        // OmniRoute last-mile reliable fallback
  },
  // Tier 3 — Standard / Fast / Low-cost
  standard: {
    openrouter: 'openai/gpt-4.1-nano',           // GPT-4.1 Nano — cheapest OpenAI, 1M ctx
    openai: 'gpt-4.1-nano',                      // Real API ID
    anthropic: 'claude-haiku-4-5',               // Claude Haiku 4.5 — fast & cheap
    google: 'gemini-3-flash-preview',            // Gemini 3 Flash — latest fast path
    deepseek: 'deepseek-chat',                   // DeepSeek V3 — very low cost
    openrouter2: 'meta-llama/llama-4-scout',     // Llama 4 Scout — 10M ctx, cheapest
    omniroute: 'omniroute/auto/cheap',           // OmniRoute cost-optimized fallback
  },
  // Free tier / always-on fallback
  free: {
    openrouter: 'meta-llama/llama-4-scout:free',       // Llama 4 Scout free tier
    openrouter2: 'google/gemma-3-27b-it:free',         // Gemma 3 free tier
    agentzero: 'agentzero',                            // AgentZero — zero cost, always-on
    omniroute: 'omniroute/auto/free',                  // OmniRoute free-tier pool
  },
} as const;

// ──────────────────────────────────────────────
// 3. AGENT → MODEL ROUTING TABLE
// ──────────────────────────────────────────────

export const AGENT_MODEL_ROUTING: Record<string, keyof typeof MODEL_CATALOGUE> = {
  'chief-legal-officer': 'expert',
  'senior-litigation-counsel': 'expert',
  'senior-contract-counsel': 'expert',
  'drafting-specialist': 'professional',
  'legal-researcher': 'professional',
  'document-analyzer': 'professional',
  'document-checker': 'professional',
  'risk-assessor': 'professional',
  'compliance-specialist': 'professional',
  'clause-advisor': 'standard',
  'legal-analyst': 'standard',
  'legal-mentor': 'standard',
  'deadline-calculator': 'standard',
  'case-summarizer': 'standard',
  'compliance-checker': 'standard',
  'contract-reviewer': 'professional',
  'ip-analyst': 'professional',
  'tax-advisor': 'standard',
  'case-brief-writer': 'standard',
  'generic': 'standard',
};

// ──────────────────────────────────────────────
// 4. ORCHESTRATION CONFIGURATION
// ──────────────────────────────────────────────

export const ORCHESTRATION_CONFIG = {
  defaultPattern: 'single' as const,
  maxParallelAgents: parseInt(process.env.NV_MAX_PARALLEL_AGENTS || '5', 10),
  maxRetries: parseInt(process.env.NV_MAX_RETRIES || '3', 10),
  timeoutMs: parseInt(process.env.NV_TIMEOUT_MS || '30000', 10),
  hitlThreshold: parseFloat(process.env.NV_HITL_THRESHOLD || '0.75'), // confidence below this → HITL
  riskScoreThreshold: parseInt(process.env.NV_RISK_THRESHOLD || '60', 10),
  enabledPatterns: ['single', 'sequential', 'parallel', 'dag', 'swarm'] as const,
  providerFallbackOrder: (process.env.NV_PROVIDER_FALLBACK || 'openrouter,openai,anthropic,google,groq,together,deepseek,mistral').split(','),
} as const;

// ──────────────────────────────────────────────
// 5. TIER-BASED FEATURE FLAGS
// ──────────────────────────────────────────────

export const TIER_FEATURES = {
  solo: {
    modelTier: 'standard' as keyof typeof MODEL_CATALOGUE,
    maxTokens: 4096,
    rag: false, memory: false, hitl: false, parallelAgents: 1,
    dailyTokenLimit: parseInt(process.env.SOLO_DAILY_TOKENS || '50000', 10),
  },
  plus: {
    modelTier: 'professional' as keyof typeof MODEL_CATALOGUE,
    maxTokens: 8192,
    rag: true, memory: false, hitl: false, parallelAgents: 3,
    dailyTokenLimit: parseInt(process.env.PLUS_DAILY_TOKENS || '200000', 10),
  },
  pro: {
    modelTier: 'professional' as keyof typeof MODEL_CATALOGUE,
    maxTokens: 16384,
    rag: true, memory: true, hitl: true, parallelAgents: 5,
    dailyTokenLimit: parseInt(process.env.PRO_DAILY_TOKENS || '1000000', 10),
  },
  enterprise: {
    modelTier: 'expert' as keyof typeof MODEL_CATALOGUE,
    maxTokens: 32768,
    rag: true, memory: true, hitl: true, parallelAgents: 10,
    dailyTokenLimit: parseInt(process.env.ENTERPRISE_DAILY_TOKENS || '5000000', 10),
  },
  default: {
    modelTier: 'standard' as keyof typeof MODEL_CATALOGUE,
    maxTokens: 2048,
    rag: false, memory: false, hitl: false, parallelAgents: 1,
    dailyTokenLimit: 10000,
  },
} as const;

// ──────────────────────────────────────────────
// 6. HELPERS
// ──────────────────────────────────────────────

export function getAvailableProviders(): string[] {
  const registry = buildProviderRegistry();
  return Object.values(registry).filter(p => p.isAvailable).map(p => p.id);
}

export function getPrimaryProvider(): LLMProvider | null {
  const registry = buildProviderRegistry();
  const order = ORCHESTRATION_CONFIG.providerFallbackOrder;
  for (const id of order) {
    if (registry[id]?.isAvailable) return registry[id];
  }
  return null;
}

export function getModelForAgent(agentId: string, provider: string): string {
  const tier = AGENT_MODEL_ROUTING[agentId] || 'standard';
  const catalogue = MODEL_CATALOGUE[tier] as Record<string, string>;
  return catalogue[provider] || catalogue['openrouter'] || 'gpt-4o-mini';
}

export function getTierFeatures(tier: string) {
  return TIER_FEATURES[tier as keyof typeof TIER_FEATURES] || TIER_FEATURES.default;
}

export function logProviderStatus(): void {
  const available = getAvailableProviders();
  const primary = getPrimaryProvider();
  logger.info(`[NV-LLM] Providers available: ${available.join(', ') || 'NONE'}`);
  logger.info(`[NV-LLM] Primary provider: ${primary?.id || 'UNCONFIGURED'}`);
  if (!primary) {
    logger.warn(`[NV-LLM] ⚠️  No LLM providers configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.`);
  }
}
