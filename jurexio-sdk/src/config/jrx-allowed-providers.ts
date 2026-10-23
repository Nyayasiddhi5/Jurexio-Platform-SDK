/**
 * Jurexio v5.0.1 — Allowed LLM provider lockdown (May 2026).
 *
 * Per Session-15 v2 (2026-05-11) user mandate: every configured paid LLM
 * provider must be reachable with its LATEST May 2026 model IDs as primary
 * cascade leaders. Provider availability is gated by env-var presence in
 * `model-catalog.ts::isProviderAvailable()` — providers without keys fall
 * through silently in the cascade.
 *
 * Activating a new provider:
 *   1. Add provider id to ALLOWED_PROVIDERS below
 *   2. Add model list to PROVIDER_MODEL_CATALOG below
 *   3. Provide env-var key on Replit Secrets + EC2 .env.production
 *   4. UPDATE nv_llm_providers SET is_active=true WHERE provider_id='<id>'
 *   5. Run scripts/jrx-seed-models.ts (or psql insert) to seed model rows
 *
 * Voice models route through the `openai` provider.
 */

export const ALLOWED_PROVIDERS = [
  // Active direct providers (5)
  'anthropic',
  'openai',
  'google',
  'sarvam',
  'openrouter',
  // Newly allowed direct providers — gated on env-var key, ready when keys land
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'cohere',
  'perplexity',
  'together',
  // Managed gateway (active)
  'bedrock',
  'vertex',
  // Sovereign terminal fallback (always-on, 7th-tier)
  'agentzero',
] as const;

export type AllowedProvider = typeof ALLOWED_PROVIDERS[number];

export function isAllowedProvider(id: string): id is AllowedProvider {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(id);
}

export const OPENAI_VOICE_MODELS = [
  'tts-1',
  'tts-1-hd',
  'whisper-1',
  'gpt-4o-realtime-preview',
  'gpt-4o-audio-preview',
] as const;

export type OpenAIVoiceModel = typeof OPENAI_VOICE_MODELS[number];

export function isVoiceModel(modelId: string): boolean {
  return (OPENAI_VOICE_MODELS as readonly string[]).includes(modelId);
}

export class ProviderNotAllowedError extends Error {
  constructor(providerId: string) {
    super(
      `Provider '${providerId}' is not in the allowed list. ` +
      `Allowed: ${ALLOWED_PROVIDERS.join(', ')}.`
    );
    this.name = 'ProviderNotAllowedError';
  }
}

/**
 * PROVIDER_MODEL_CATALOG — LATEST models as of May 2026.
 *
 * Source-of-truth for which model IDs the gateway is allowed to dispatch.
 * Mirror to `nv_model_catalog` DB table via `scripts/jrx-seed-models.ts` or
 * direct psql.
 */
export const PROVIDER_MODEL_CATALOG: Record<AllowedProvider, string[]> = {
  // ── Anthropic — direct API (May 2026) ──
  anthropic: [
    'claude-opus-4-7',         // May 2026 frontier, 1M ctx, $5/$25
    'claude-opus-4-6',         // Feb 2026, 1M ctx
    'claude-sonnet-4-6',       // 1M ctx, balanced $3/$15
    'claude-sonnet-4-5-20250929', // dated snapshot
    'claude-haiku-4-5',        // 200K ctx, $1/$5 high-volume
    'claude-haiku-4-5-20251001',
  ],

  // ── OpenAI — frontier + reasoning + voice (May 2026) ──
  openai: [
    'gpt-5.5-pro',             // May 2026 highest-precision flagship
    'gpt-5.5',                 // May 2026 smartest general-purpose
    'gpt-5.5-2026-04-23',      // dated snapshot
    'gpt-5.4',                 // March 2026 frontier fallback
    'gpt-5.4-mini',            // fast efficient 5.4
    'gpt-5.4-2026-03-05',      // dated snapshot
    'gpt-5',                   // Aug 2025 stable fallback
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',                 // Apr 2025 1M-ctx legacy fallback
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'o3',                      // deep reasoning (kept for explicit reasoning)
    'o3-mini',
    'o3-pro',
    'gpt-4o',                  // multimodal legacy
    ...OPENAI_VOICE_MODELS,
  ],

  // ── Google Gemini (May 2026) ──
  google: [
    'gemini-3-1-pro-preview',         // May 2026 flagship, 1M ctx
    'gemini-3-flash-preview',         // Pro-level intel @ Flash speed
    'gemini-3-1-flash-lite-preview',  // cheap 1M-ctx
    'gemini-3-1-flash-image-preview', // Nano Banana 2 (image gen)
    'gemini-3-pro-image-preview',     // Nano Banana Pro
    'gemini-2.5-pro',                 // 2M-ctx GA fallback
    'gemini-2.5-flash',               // GA fast
  ],

  // ── DeepSeek — direct API (May 2026) ──
  deepseek: [
    'deepseek-v4-pro',         // May 2026 flagship, 1M ctx, $0.5/$2
    'deepseek-v4-flash',       // 1M ctx high-throughput
    'deepseek-chat',           // alias → v4-flash non-thinking (deprecates 2026-07)
    'deepseek-reasoner',       // alias → v4-flash thinking (deprecates 2026-07)
  ],

  // ── xAI Grok (May 2026) ──
  xai: [
    'grok-4.20',               // alias for latest stable, 2M ctx
    'grok-4.20-reasoning',     // 2M ctx flagship reasoning
    'grok-4.20-non-reasoning', // fast variant
    'grok-4.20-multi-agent',   // multi-agent architecture
  ],

  // ── Mistral — direct API ──
  mistral: [
    'mistral-large-2-2411',    // EU-residency frontier
    'mistral-medium-3',        // cost-effective
    'ministral-8b-2410',       // small fast
    'codestral-2501',          // code
  ],

  // ── Groq — direct API (LPU inference, very low latency) ──
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],

  // ── Cohere — direct API ──
  cohere: [
    'command-r-plus-08-2024',
    'command-r-08-2024',
    'embed-english-v3.0',
    'embed-multilingual-v3.0',
    'rerank-english-v3.0',
  ],

  // ── Perplexity — direct API (web-grounded answers) ──
  perplexity: [
    'sonar-pro',
    'sonar',
    'sonar-deep-research',
    'sonar-reasoning-pro',
  ],

  // ── Together AI — open-weight gateway ──
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'deepseek-ai/DeepSeek-V3',
  ],

  // ── OpenRouter — multi-provider gateway (paid leaders + free terminal) ──
  openrouter: [
    // PAID — May 2026 frontier
    'anthropic/claude-opus-4-7',
    'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
    'openai/gpt-5.5-pro',
    'openai/gpt-5.5',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini',
    'openai/gpt-5',
    'openai/o3',
    'google/gemini-3-1-pro-preview',
    'google/gemini-3-flash-preview',
    'google/gemini-2.5-pro',
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'x-ai/grok-4.20',
    'x-ai/grok-4.20-reasoning',
    'meta-llama/llama-4-maverick',
    'meta-llama/llama-4-scout',
    'mistralai/mistral-large-2',
    'mistralai/mistral-medium-3',
    'qwen/qwen3-235b-instruct',
    'cohere/command-r-plus',
    'perplexity/sonar-pro',
    // FREE tier (always-on terminal fallback)
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-235b-instruct:free',
    'qwen/qwen3-coder:free',
    'mistralai/mistral-medium-3:free',
    'google/gemma-3-27b-it:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'openai/gpt-oss-120b:free',
    'openai/gpt-oss-20b:free',
    'deepseek/deepseek-v4-flash:free',
    'nvidia/nemotron-nano-9b-v2:free',
  ],

  // ── Sarvam AI — Indic-first (May 2026) ──
  sarvam: [
    'sarvam-105b',                // May 2026 flagship Indic LLM
    'sarvam-30b',                 // mid-tier Indic
    'sarvam-m',                   // hybrid reasoning Indic
    'sarvam-vision',              // OCR + visual understanding
    'sarvam-translate',           // 22 Indic langs translation
    'mayura',                     // 12-lang translation (older)
    'saaras-v3',                  // Indic STT (replaces v2.5)
    'bulbul-v3',                  // Indic TTS (replaces v2)
  ],

  // ── AgentZero (Azentzero) — sovereign self-hosted terminal fallback ──
  agentzero: [
    'agentzero',
    'jrx-azentzero-pro',
  ],

  // ── AWS Bedrock — managed multi-foundation gateway (May 2026) ──
  bedrock: [
    'us.anthropic.claude-opus-5',
    'global.anthropic.claude-opus-4-8',
    'global.anthropic.claude-opus-4-7',
    'global.anthropic.claude-sonnet-5',
    'us.anthropic.claude-sonnet-5',
    'global.anthropic.claude-opus-4-6-v1',
    'global.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
    'anthropic.claude-3-haiku-20240307-v1:0',
    'anthropic.claude-opus-4-7-v1:0',
    'anthropic.claude-sonnet-4-5-v1:0',
    'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'anthropic.claude-3-5-haiku-20241022-v1:0',
    // Meta Llama via Bedrock
    'meta.llama4-maverick-instruct-v1:0',
    'meta.llama4-scout-instruct-v1:0',
    'meta.llama3-3-70b-instruct-v1:0',
    // Amazon Nova
    'amazon.nova-premier-v1:0',           // 1M ctx native
    'amazon.nova-pro-v1:0',
    'amazon.nova-lite-v1:0',
    'amazon.nova-micro-v1:0',
    // Amazon Titan
    'amazon.titan-text-premier-v1:0',
    'amazon.titan-embed-text-v2:0',
    // Mistral via Bedrock
    'mistral.mistral-large-2407-v1:0',
    'mistral.mistral-large-2-2411-v1:0',
    // AI21 Jamba
    'ai21.jamba-1-5-large-v1:0',
    'ai21.jamba-1-5-mini-v1:0',
    // Cohere via Bedrock
    'cohere.command-r-plus-v1:0',
    'cohere.command-r-v1:0',
    'cohere.embed-english-v3',
    'cohere.embed-multilingual-v3',
    // DeepSeek via Bedrock
    'deepseek.r1-v1:0',
  ],

  // ── Vertex AI (Google region-pinned residency) ──
  vertex: [
    'gemini-3-1-pro-preview-vertex',
    'gemini-3-flash-preview-vertex',
    'gemini-2.5-pro-vertex',
    'gemini-2.5-flash-vertex',
  ],
};

export function isAllowedModel(modelId: string): boolean {
  for (const provider of ALLOWED_PROVIDERS) {
    if (PROVIDER_MODEL_CATALOG[provider].includes(modelId)) return true;
  }
  return false;
}

/**
 * INACTIVE_PROVIDERS — supported but not in ALLOWED_PROVIDERS.
 * Have rows in `nv_llm_providers` but are not routable until promoted.
 * (Most have been promoted into ALLOWED_PROVIDERS above per Session-15 v2.)
 */
export const INACTIVE_PROVIDERS = [
  'replicate', 'fireworks', 'qwen', 'kimi', 'llama', 'gemma', 'nvidia',
  'azure-openai', 'huggingface', 'exa', 'tavily',
] as const;

export const PLATFORM_PROVIDER_COUNT = ALLOWED_PROVIDERS.length + INACTIVE_PROVIDERS.length;
