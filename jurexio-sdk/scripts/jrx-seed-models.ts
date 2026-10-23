/**
 * Seed nv_llm_providers (23 platform-supported, 6 active) and
 * nv_model_catalog (~80 latest models across 6 active providers).
 *
 * Idempotent — safe to re-run. Mirrors `src/config/jrx-allowed-providers.ts`.
 *
 * Run: npx tsx scripts/jrx-seed-models.ts
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_llm_providers': [
    'provider_id', 'name', 'api_base_url', 'is_active', 'capabilities',
    'avg_latency_ms', 'cost_per_1k_tokens_in', 'cost_per_1k_tokens_out',
  ],
  'public.nv_model_catalog': [
    'model_id', 'provider_id', 'display_name', 'context_window',
    'max_output_tokens', 'supports_vision', 'supports_tools',
    'cost_per_1k_in', 'cost_per_1k_out', 'is_active',
  ],
} as const;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
const sql = makePgSql();

// ─────────────────────────────────────────────────────────────────────────────
// 23 platform-supported providers; 6 marked is_active=true
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVE_PROVIDER_IDS = new Set([
  'anthropic', 'openai', 'google', 'openrouter', 'sarvam', 'bedrock',
]);

const PROVIDERS = [
  // ── 6 ACTIVE ──
  { provider_id: 'anthropic',  name: 'Anthropic',                  api_base_url: 'https://api.anthropic.com/v1',                       capabilities: ['chat','vision','tools','long-context'],         avg_latency_ms: 1200, cost_per_1k_tokens_in: 0.003,   cost_per_1k_tokens_out: 0.015 },
  { provider_id: 'openai',     name: 'OpenAI',                     api_base_url: 'https://api.openai.com/v1',                          capabilities: ['chat','vision','tools','embeddings','tts','stt'], avg_latency_ms: 800, cost_per_1k_tokens_in: 0.005, cost_per_1k_tokens_out: 0.015 },
  { provider_id: 'google',     name: 'Google Gemini',              api_base_url: 'https://generativelanguage.googleapis.com/v1beta',  capabilities: ['chat','vision','tools','long-context','multimodal'], avg_latency_ms: 700, cost_per_1k_tokens_in: 0.00025, cost_per_1k_tokens_out: 0.00075 },
  { provider_id: 'openrouter', name: 'OpenRouter',                 api_base_url: 'https://openrouter.ai/api/v1',                       capabilities: ['chat','vision','tools','multi-model','free-tier'], avg_latency_ms: 900, cost_per_1k_tokens_in: 0.001, cost_per_1k_tokens_out: 0.003 },
  { provider_id: 'sarvam',     name: 'Sarvam AI',                  api_base_url: 'https://api.sarvam.ai',                              capabilities: ['chat','tts','stt','translation','indic-languages'], avg_latency_ms: 500, cost_per_1k_tokens_in: 0.0005, cost_per_1k_tokens_out: 0.001 },
  { provider_id: 'bedrock',    name: 'AWS Bedrock',                api_base_url: 'https://bedrock-runtime.ap-south-1.amazonaws.com',   capabilities: ['chat','vision','tools','enterprise','multi-foundation'], avg_latency_ms: 1000, cost_per_1k_tokens_in: 0.003, cost_per_1k_tokens_out: 0.015 },
  // ── 17 INACTIVE (platform-supported, not currently routable) ──
  { provider_id: 'groq',         name: 'Groq',              api_base_url: 'https://api.groq.com/openai/v1',                capabilities: ['chat','fast-inference','tools'],          avg_latency_ms: 200,  cost_per_1k_tokens_in: 0.00027,  cost_per_1k_tokens_out: 0.00027 },
  { provider_id: 'perplexity',   name: 'Perplexity AI',     api_base_url: 'https://api.perplexity.ai',                     capabilities: ['chat','search','real-time'],              avg_latency_ms: 1500, cost_per_1k_tokens_in: 0.001,    cost_per_1k_tokens_out: 0.001 },
  { provider_id: 'mistral',      name: 'Mistral AI',        api_base_url: 'https://api.mistral.ai/v1',                     capabilities: ['chat','tools','embeddings'],              avg_latency_ms: 600,  cost_per_1k_tokens_in: 0.002,    cost_per_1k_tokens_out: 0.006 },
  { provider_id: 'replicate',    name: 'Replicate',         api_base_url: 'https://api.replicate.com/v1',                  capabilities: ['image-gen','video-gen','audio','custom-models'], avg_latency_ms: 3000, cost_per_1k_tokens_in: 0.0005, cost_per_1k_tokens_out: 0.001 },
  { provider_id: 'together',     name: 'Together AI',       api_base_url: 'https://api.together.xyz/v1',                   capabilities: ['chat','tools','fine-tuning','embeddings'],avg_latency_ms: 400,  cost_per_1k_tokens_in: 0.0002,   cost_per_1k_tokens_out: 0.0002 },
  { provider_id: 'cohere',       name: 'Cohere',            api_base_url: 'https://api.cohere.ai/v1',                      capabilities: ['chat','embeddings','rerank','classification'], avg_latency_ms: 700, cost_per_1k_tokens_in: 0.003, cost_per_1k_tokens_out: 0.015 },
  { provider_id: 'fireworks',    name: 'Fireworks AI',      api_base_url: 'https://api.fireworks.ai/inference/v1',         capabilities: ['chat','fast-inference','tools'],          avg_latency_ms: 250,  cost_per_1k_tokens_in: 0.0001,   cost_per_1k_tokens_out: 0.0001 },
  { provider_id: 'deepseek',     name: 'DeepSeek',          api_base_url: 'https://api.deepseek.com/v1',                   capabilities: ['chat','reasoning','tools','code'],        avg_latency_ms: 800,  cost_per_1k_tokens_in: 0.00014,  cost_per_1k_tokens_out: 0.00028 },
  { provider_id: 'qwen',         name: 'Alibaba Qwen',      api_base_url: 'https://dashscope.aliyuncs.com/api/v1',         capabilities: ['chat','vision','tools','long-context'],   avg_latency_ms: 900,  cost_per_1k_tokens_in: 0.0002,   cost_per_1k_tokens_out: 0.0006 },
  { provider_id: 'kimi',         name: 'Kimi (Moonshot)',   api_base_url: 'https://api.moonshot.cn/v1',                    capabilities: ['chat','long-context','tools'],            avg_latency_ms: 1000, cost_per_1k_tokens_in: 0.0001,   cost_per_1k_tokens_out: 0.0003 },
  { provider_id: 'llama',        name: 'Meta LLaMA',        api_base_url: 'https://llama-api.meta.com/v1',                 capabilities: ['chat','tools','open-source'],             avg_latency_ms: 300,  cost_per_1k_tokens_in: 0.0001,   cost_per_1k_tokens_out: 0.0001 },
  { provider_id: 'gemma',        name: 'Google Gemma',      api_base_url: 'https://generativelanguage.googleapis.com/v1beta', capabilities: ['chat','open-source','lightweight'],    avg_latency_ms: 200,  cost_per_1k_tokens_in: 0.00005,  cost_per_1k_tokens_out: 0.0001 },
  { provider_id: 'nvidia',       name: 'NVIDIA NIM',        api_base_url: 'https://integrate.api.nvidia.com/v1',           capabilities: ['chat','vision','tools','enterprise'],     avg_latency_ms: 500,  cost_per_1k_tokens_in: 0.0003,   cost_per_1k_tokens_out: 0.0009 },
  { provider_id: 'azure-openai', name: 'Azure OpenAI',      api_base_url: 'https://YOUR-RESOURCE.openai.azure.com',        capabilities: ['chat','vision','tools','enterprise'],     avg_latency_ms: 900,  cost_per_1k_tokens_in: 0.005,    cost_per_1k_tokens_out: 0.015 },
  { provider_id: 'huggingface',  name: 'Hugging Face',      api_base_url: 'https://api-inference.huggingface.co',          capabilities: ['chat','embeddings','custom-models','open-source'], avg_latency_ms: 2000, cost_per_1k_tokens_in: 0.0001, cost_per_1k_tokens_out: 0.0001 },
  { provider_id: 'exa',          name: 'Exa (Search AI)',   api_base_url: 'https://api.exa.ai',                            capabilities: ['search','retrieval','rag'],               avg_latency_ms: 800,  cost_per_1k_tokens_in: 0.001,    cost_per_1k_tokens_out: 0.001 },
  { provider_id: 'tavily',       name: 'Tavily Search',     api_base_url: 'https://api.tavily.com',                        capabilities: ['search','retrieval','real-time'],         avg_latency_ms: 1000, cost_per_1k_tokens_in: 0.0005,   cost_per_1k_tokens_out: 0.0005 },
];

// ─────────────────────────────────────────────────────────────────────────────
// MODEL CATALOG — only models for the 6 ACTIVE providers, latest as of May 2026
// Mirrors PROVIDER_MODEL_CATALOG in src/config/jrx-allowed-providers.ts
// ─────────────────────────────────────────────────────────────────────────────
const MODELS = [
  // ── ANTHROPIC (3) ──
  { model_id: 'claude-opus-4-6',    provider_id: 'anthropic', display_name: 'Claude Opus 4.6 (frontier, 1M ctx)',  context_window: 1000000, max_output_tokens: 32000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.015,  cost_per_1k_out: 0.075 },
  { model_id: 'claude-sonnet-4-6',  provider_id: 'anthropic', display_name: 'Claude Sonnet 4.6 (balanced, 1M ctx)', context_window: 1000000, max_output_tokens: 16000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.003,  cost_per_1k_out: 0.015 },
  { model_id: 'claude-haiku-4-5',   provider_id: 'anthropic', display_name: 'Claude Haiku 4.5 (fast & cheap)',     context_window: 200000,  max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0008, cost_per_1k_out: 0.004 },

  // ── OPENAI (10 + voice) ──
  { model_id: 'gpt-5',                       provider_id: 'openai', display_name: 'GPT-5 (flagship, Aug 2025)',         context_window: 256000,  max_output_tokens: 32768, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.005,    cost_per_1k_out: 0.015 },
  { model_id: 'gpt-5-mini',                  provider_id: 'openai', display_name: 'GPT-5 Mini',                          context_window: 256000,  max_output_tokens: 16384, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.003 },
  { model_id: 'gpt-5-nano',                  provider_id: 'openai', display_name: 'GPT-5 Nano',                          context_window: 256000,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0002,   cost_per_1k_out: 0.0008 },
  { model_id: 'gpt-4.1',                     provider_id: 'openai', display_name: 'GPT-4.1 (Apr 2025, 1M ctx)',          context_window: 1047576, max_output_tokens: 32768, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.002,    cost_per_1k_out: 0.008 },
  { model_id: 'gpt-4.1-mini',                provider_id: 'openai', display_name: 'GPT-4.1 Mini',                        context_window: 1047576, max_output_tokens: 16384, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0004,   cost_per_1k_out: 0.0016 },
  { model_id: 'gpt-4.1-nano',                provider_id: 'openai', display_name: 'GPT-4.1 Nano',                        context_window: 1047576, max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0001,   cost_per_1k_out: 0.0004 },
  { model_id: 'o4-mini',                     provider_id: 'openai', display_name: 'o4-mini (reasoning)',                 context_window: 200000,  max_output_tokens: 65536, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0011,   cost_per_1k_out: 0.0044 },
  { model_id: 'o3',                          provider_id: 'openai', display_name: 'o3 (deep reasoning)',                 context_window: 200000,  max_output_tokens: 100000,supports_vision: false, supports_tools: true, cost_per_1k_in: 0.060,    cost_per_1k_out: 0.240 },
  { model_id: 'o3-mini',                     provider_id: 'openai', display_name: 'o3-mini (fast reasoning)',            context_window: 200000,  max_output_tokens: 65536, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0011,   cost_per_1k_out: 0.0044 },
  { model_id: 'gpt-4o',                      provider_id: 'openai', display_name: 'GPT-4o (multimodal)',                 context_window: 128000,  max_output_tokens: 16384, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0025,   cost_per_1k_out: 0.01 },
  // OpenAI voice
  { model_id: 'tts-1',                       provider_id: 'openai', display_name: 'TTS-1 (text-to-speech)',              context_window: 4096,    max_output_tokens: 4096,  supports_vision: false, supports_tools: false, cost_per_1k_in: 0.015,    cost_per_1k_out: 0.0 },
  { model_id: 'tts-1-hd',                    provider_id: 'openai', display_name: 'TTS-1 HD',                            context_window: 4096,    max_output_tokens: 4096,  supports_vision: false, supports_tools: false, cost_per_1k_in: 0.030,    cost_per_1k_out: 0.0 },
  { model_id: 'whisper-1',                   provider_id: 'openai', display_name: 'Whisper-1 (speech-to-text)',          context_window: 25000,   max_output_tokens: 4096,  supports_vision: false, supports_tools: false, cost_per_1k_in: 0.006,    cost_per_1k_out: 0.0 },
  { model_id: 'gpt-4o-realtime-preview',     provider_id: 'openai', display_name: 'GPT-4o Realtime (voice)',             context_window: 128000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.005,    cost_per_1k_out: 0.020 },
  { model_id: 'gpt-4o-audio-preview',        provider_id: 'openai', display_name: 'GPT-4o Audio',                        context_window: 128000,  max_output_tokens: 16384, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0025,   cost_per_1k_out: 0.010 },

  // ── GOOGLE (6) ──
  { model_id: 'gemini-3.1-pro',     provider_id: 'google', display_name: 'Gemini 3.1 Pro (frontier)',          context_window: 2000000, max_output_tokens: 16384, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.00125, cost_per_1k_out: 0.005 },
  { model_id: 'gemini-3.1-flash',   provider_id: 'google', display_name: 'Gemini 3.1 Flash',                    context_window: 1000000, max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0001,  cost_per_1k_out: 0.0004 },
  { model_id: 'gemini-3-pro',       provider_id: 'google', display_name: 'Gemini 3 Pro',                        context_window: 1000000, max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.001,   cost_per_1k_out: 0.004 },
  { model_id: 'gemini-3-flash',     provider_id: 'google', display_name: 'Gemini 3 Flash',                      context_window: 1000000, max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0001,  cost_per_1k_out: 0.0004 },
  { model_id: 'gemini-2.5-pro',     provider_id: 'google', display_name: 'Gemini 2.5 Pro (GA)',                 context_window: 1000000, max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.00125, cost_per_1k_out: 0.005 },
  { model_id: 'gemini-2.5-flash',   provider_id: 'google', display_name: 'Gemini 2.5 Flash',                    context_window: 1000000, max_output_tokens: 8192,  supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0001,  cost_per_1k_out: 0.0004 },

  // ── OPENROUTER FREE (17) ──
  { model_id: 'meta-llama/llama-4-maverick:free',                provider_id: 'openrouter', display_name: 'Llama 4 Maverick (free)',          context_window: 1000000, max_output_tokens: 8192, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'meta-llama/llama-4-scout:free',                   provider_id: 'openrouter', display_name: 'Llama 4 Scout (free, 10M ctx)',    context_window: 10000000,max_output_tokens: 8192, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'meta-llama/llama-3.3-70b-instruct:free',          provider_id: 'openrouter', display_name: 'Llama 3.3 70B (free)',             context_window: 128000,  max_output_tokens: 4096, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'qwen/qwen3-235b-instruct:free',                   provider_id: 'openrouter', display_name: 'Qwen3 235B (free)',                context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'qwen/qwen3-coder:free',                           provider_id: 'openrouter', display_name: 'Qwen3 Coder (free)',               context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'qwen/qwen3-72b-instruct:free',                    provider_id: 'openrouter', display_name: 'Qwen3 72B (free)',                 context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'mistralai/mistral-medium-3:free',                 provider_id: 'openrouter', display_name: 'Mistral Medium 3 (free)',          context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'mistralai/mistral-small-3.1-24b-instruct:free',   provider_id: 'openrouter', display_name: 'Mistral Small 3.1 24B (free)',     context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'google/gemma-3-27b-it:free',                      provider_id: 'openrouter', display_name: 'Gemma 3 27B (free)',               context_window: 131072,  max_output_tokens: 8192, supports_vision: true,  supports_tools: false, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'google/gemma-3-12b-it:free',                      provider_id: 'openrouter', display_name: 'Gemma 3 12B (free)',               context_window: 131072,  max_output_tokens: 8192, supports_vision: true,  supports_tools: false, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'nousresearch/hermes-3-llama-3.1-405b:free',       provider_id: 'openrouter', display_name: 'Hermes 3 Llama 405B (free)',       context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'openai/gpt-oss-120b:free',                        provider_id: 'openrouter', display_name: 'GPT-OSS 120B (free)',              context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'openai/gpt-oss-20b:free',                         provider_id: 'openrouter', display_name: 'GPT-OSS 20B (free)',               context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'deepseek/deepseek-r1:free',                       provider_id: 'openrouter', display_name: 'DeepSeek R1 (free, reasoning)',    context_window: 131072,  max_output_tokens: 16000, supports_vision: false, supports_tools: false, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'deepseek/deepseek-chat-v3:free',                  provider_id: 'openrouter', display_name: 'DeepSeek Chat V3 (free)',          context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',     provider_id: 'openrouter', display_name: 'NVIDIA Nemotron 70B (free)',       context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  { model_id: 'microsoft/phi-4:free',                            provider_id: 'openrouter', display_name: 'Microsoft Phi-4 (free)',           context_window: 131072,  max_output_tokens: 8192, supports_vision: false, supports_tools: true, cost_per_1k_in: 0, cost_per_1k_out: 0 },
  // ── OPENROUTER PAID (20) ──
  { model_id: 'anthropic/claude-opus-4-6',                       provider_id: 'openrouter', display_name: 'Claude Opus 4.6 (via OR)',         context_window: 1000000, max_output_tokens: 32000, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.015,    cost_per_1k_out: 0.075 },
  { model_id: 'anthropic/claude-sonnet-4-6',                     provider_id: 'openrouter', display_name: 'Claude Sonnet 4.6 (via OR)',       context_window: 1000000, max_output_tokens: 16000, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.003,    cost_per_1k_out: 0.015 },
  { model_id: 'anthropic/claude-haiku-4-5',                      provider_id: 'openrouter', display_name: 'Claude Haiku 4.5 (via OR)',        context_window: 200000,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.004 },
  { model_id: 'openai/gpt-5',                                    provider_id: 'openrouter', display_name: 'GPT-5 (via OR)',                    context_window: 256000,  max_output_tokens: 32768, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.005,    cost_per_1k_out: 0.015 },
  { model_id: 'openai/gpt-5-mini',                               provider_id: 'openrouter', display_name: 'GPT-5 Mini (via OR)',               context_window: 256000,  max_output_tokens: 16384, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.003 },
  { model_id: 'openai/gpt-4.1',                                  provider_id: 'openrouter', display_name: 'GPT-4.1 (via OR)',                  context_window: 1047576, max_output_tokens: 32768, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.002,    cost_per_1k_out: 0.008 },
  { model_id: 'openai/o3',                                       provider_id: 'openrouter', display_name: 'OpenAI o3 (via OR)',                context_window: 200000,  max_output_tokens: 100000,supports_vision: false, supports_tools: true, cost_per_1k_in: 0.060,    cost_per_1k_out: 0.240 },
  { model_id: 'openai/o4-mini',                                  provider_id: 'openrouter', display_name: 'OpenAI o4-mini (via OR)',           context_window: 200000,  max_output_tokens: 65536, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0011,   cost_per_1k_out: 0.0044 },
  { model_id: 'google/gemini-3.1-pro',                           provider_id: 'openrouter', display_name: 'Gemini 3.1 Pro (via OR)',           context_window: 2000000, max_output_tokens: 16384, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.00125,  cost_per_1k_out: 0.005 },
  { model_id: 'google/gemini-3.1-flash',                         provider_id: 'openrouter', display_name: 'Gemini 3.1 Flash (via OR)',         context_window: 1000000, max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0001,   cost_per_1k_out: 0.0004 },
  { model_id: 'meta-llama/llama-4-maverick',                     provider_id: 'openrouter', display_name: 'Llama 4 Maverick (paid)',           context_window: 1000000, max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0006,   cost_per_1k_out: 0.0006 },
  { model_id: 'meta-llama/llama-4-scout',                        provider_id: 'openrouter', display_name: 'Llama 4 Scout (paid, 10M ctx)',     context_window: 10000000,max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0003,   cost_per_1k_out: 0.0003 },
  { model_id: 'deepseek/deepseek-v3',                            provider_id: 'openrouter', display_name: 'DeepSeek V3',                       context_window: 131072,  max_output_tokens: 16000, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.00014,  cost_per_1k_out: 0.00028 },
  { model_id: 'deepseek/deepseek-r1',                            provider_id: 'openrouter', display_name: 'DeepSeek R1 (reasoning)',           context_window: 131072,  max_output_tokens: 16000, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.00055,  cost_per_1k_out: 0.00219 },
  { model_id: 'mistralai/mistral-large-2',                       provider_id: 'openrouter', display_name: 'Mistral Large 2',                   context_window: 131072,  max_output_tokens: 8192,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.002,    cost_per_1k_out: 0.006 },
  { model_id: 'mistralai/mistral-medium-3',                      provider_id: 'openrouter', display_name: 'Mistral Medium 3',                  context_window: 131072,  max_output_tokens: 8192,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0004,   cost_per_1k_out: 0.002 },
  { model_id: 'qwen/qwen3-72b-instruct',                         provider_id: 'openrouter', display_name: 'Qwen3 72B',                         context_window: 131072,  max_output_tokens: 8192,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0009,   cost_per_1k_out: 0.0009 },
  { model_id: 'x-ai/grok-2-1212',                                provider_id: 'openrouter', display_name: 'Grok 2',                            context_window: 131072,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.002,    cost_per_1k_out: 0.010 },
  { model_id: 'x-ai/grok-3',                                     provider_id: 'openrouter', display_name: 'Grok 3',                            context_window: 131072,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.003,    cost_per_1k_out: 0.015 },
  { model_id: 'cohere/command-r-plus',                           provider_id: 'openrouter', display_name: 'Cohere Command R+',                 context_window: 128000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0025,   cost_per_1k_out: 0.010 },
  { model_id: 'perplexity/llama-3.1-sonar-large-128k-online',    provider_id: 'openrouter', display_name: 'Perplexity Sonar Large (online)',   context_window: 127072,  max_output_tokens: 8192,  supports_vision: false, supports_tools: false, cost_per_1k_in: 0.001,    cost_per_1k_out: 0.001 },

  // ── SARVAM (8) ──
  { model_id: 'sarvam-m',                       provider_id: 'sarvam', display_name: 'Sarvam-M (Indic flagship)',   context_window: 32000, max_output_tokens: 4096, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0005, cost_per_1k_out: 0.001 },
  { model_id: 'sarvam-2b-v0.5',                 provider_id: 'sarvam', display_name: 'Sarvam-2B v0.5',              context_window: 8192,  max_output_tokens: 2048, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0002, cost_per_1k_out: 0.0004 },
  { model_id: 'sarvam-7b',                      provider_id: 'sarvam', display_name: 'Sarvam-7B',                   context_window: 8192,  max_output_tokens: 2048, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0003, cost_per_1k_out: 0.0006 },
  { model_id: 'sarvamai/sarvam-1',              provider_id: 'sarvam', display_name: 'Sarvam-1 (legacy)',           context_window: 8192,  max_output_tokens: 2048, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0002, cost_per_1k_out: 0.0004 },
  { model_id: 'sarvamai/sarvam-translate-v2',   provider_id: 'sarvam', display_name: 'Sarvam Translate v2',         context_window: 8192,  max_output_tokens: 4096, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0001, cost_per_1k_out: 0.0001 },
  { model_id: 'sarvamai/sarvam-summarize',      provider_id: 'sarvam', display_name: 'Sarvam Summarize',            context_window: 16384, max_output_tokens: 4096, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0001, cost_per_1k_out: 0.0001 },
  { model_id: 'saaras-v2.5',                    provider_id: 'sarvam', display_name: 'Saaras v2.5 (Indic STT)',     context_window: 25000, max_output_tokens: 4096, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.005,  cost_per_1k_out: 0.0 },
  { model_id: 'bulbul-v2',                      provider_id: 'sarvam', display_name: 'Bulbul v2 (Indic TTS)',       context_window: 4096,  max_output_tokens: 4096, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.010,  cost_per_1k_out: 0.0 },

  // ── BEDROCK (23) ──
  { model_id: 'anthropic.claude-opus-4-6-v1:0',                  provider_id: 'bedrock', display_name: 'Claude Opus 4.6 (Bedrock)',          context_window: 1000000, max_output_tokens: 32000, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.015,    cost_per_1k_out: 0.075 },
  { model_id: 'anthropic.claude-sonnet-4-6-v1:0',                provider_id: 'bedrock', display_name: 'Claude Sonnet 4.6 (Bedrock)',        context_window: 1000000, max_output_tokens: 16000, supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.003,    cost_per_1k_out: 0.015 },
  { model_id: 'anthropic.claude-haiku-4-5-v1:0',                 provider_id: 'bedrock', display_name: 'Claude Haiku 4.5 (Bedrock)',         context_window: 200000,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.004 },
  { model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',       provider_id: 'bedrock', display_name: 'Claude 3.5 Sonnet v2 (Bedrock)',     context_window: 200000,  max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.003,    cost_per_1k_out: 0.015 },
  { model_id: 'anthropic.claude-3-5-haiku-20241022-v1:0',        provider_id: 'bedrock', display_name: 'Claude 3.5 Haiku (Bedrock)',         context_window: 200000,  max_output_tokens: 8192,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.004 },
  { model_id: 'meta.llama4-maverick-instruct-v1:0',              provider_id: 'bedrock', display_name: 'Llama 4 Maverick (Bedrock)',         context_window: 1000000, max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0006,   cost_per_1k_out: 0.0006 },
  { model_id: 'meta.llama4-scout-instruct-v1:0',                 provider_id: 'bedrock', display_name: 'Llama 4 Scout (Bedrock)',            context_window: 10000000,max_output_tokens: 8192,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0003,   cost_per_1k_out: 0.0003 },
  { model_id: 'meta.llama3-3-70b-instruct-v1:0',                 provider_id: 'bedrock', display_name: 'Llama 3.3 70B (Bedrock)',            context_window: 128000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.00072,  cost_per_1k_out: 0.00072 },
  { model_id: 'amazon.nova-premier-v1:0',                        provider_id: 'bedrock', display_name: 'Amazon Nova Premier',                context_window: 1000000, max_output_tokens: 5000,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0025,   cost_per_1k_out: 0.0125 },
  { model_id: 'amazon.nova-pro-v1:0',                            provider_id: 'bedrock', display_name: 'Amazon Nova Pro',                    context_window: 300000,  max_output_tokens: 5000,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.0008,   cost_per_1k_out: 0.0032 },
  { model_id: 'amazon.nova-lite-v1:0',                           provider_id: 'bedrock', display_name: 'Amazon Nova Lite',                   context_window: 300000,  max_output_tokens: 5000,  supports_vision: true,  supports_tools: true, cost_per_1k_in: 0.00006,  cost_per_1k_out: 0.00024 },
  { model_id: 'amazon.nova-micro-v1:0',                          provider_id: 'bedrock', display_name: 'Amazon Nova Micro',                  context_window: 128000,  max_output_tokens: 5000,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.000035, cost_per_1k_out: 0.00014 },
  { model_id: 'amazon.titan-text-premier-v1:0',                  provider_id: 'bedrock', display_name: 'Amazon Titan Text Premier',          context_window: 32000,   max_output_tokens: 3072,  supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0005,   cost_per_1k_out: 0.0015 },
  { model_id: 'amazon.titan-embed-text-v2:0',                    provider_id: 'bedrock', display_name: 'Amazon Titan Embed v2',              context_window: 8192,    max_output_tokens: 0,     supports_vision: false, supports_tools: false, cost_per_1k_in: 0.00002,  cost_per_1k_out: 0.0 },
  { model_id: 'mistral.mistral-large-2407-v1:0',                 provider_id: 'bedrock', display_name: 'Mistral Large 2 (Bedrock)',          context_window: 131072,  max_output_tokens: 8192,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.003,    cost_per_1k_out: 0.009 },
  { model_id: 'mistral.mixtral-8x7b-instruct-v0:1',              provider_id: 'bedrock', display_name: 'Mixtral 8x7B (Bedrock)',             context_window: 32000,   max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.00045,  cost_per_1k_out: 0.0007 },
  { model_id: 'ai21.jamba-1-5-large-v1:0',                       provider_id: 'bedrock', display_name: 'AI21 Jamba 1.5 Large',               context_window: 256000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.002,    cost_per_1k_out: 0.008 },
  { model_id: 'ai21.jamba-1-5-mini-v1:0',                        provider_id: 'bedrock', display_name: 'AI21 Jamba 1.5 Mini',                context_window: 256000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0002,   cost_per_1k_out: 0.0004 },
  { model_id: 'cohere.command-r-plus-v1:0',                      provider_id: 'bedrock', display_name: 'Cohere Command R+ (Bedrock)',        context_window: 128000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0025,   cost_per_1k_out: 0.010 },
  { model_id: 'cohere.command-r-v1:0',                           provider_id: 'bedrock', display_name: 'Cohere Command R (Bedrock)',         context_window: 128000,  max_output_tokens: 4096,  supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0005,   cost_per_1k_out: 0.0015 },
  { model_id: 'cohere.embed-english-v3',                         provider_id: 'bedrock', display_name: 'Cohere Embed English v3',            context_window: 512,     max_output_tokens: 0,     supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0001,   cost_per_1k_out: 0.0 },
  { model_id: 'cohere.embed-multilingual-v3',                    provider_id: 'bedrock', display_name: 'Cohere Embed Multilingual v3',       context_window: 512,     max_output_tokens: 0,     supports_vision: false, supports_tools: false, cost_per_1k_in: 0.0001,   cost_per_1k_out: 0.0 },
  { model_id: 'deepseek.r1-v1:0',                                provider_id: 'bedrock', display_name: 'DeepSeek R1 (Bedrock)',              context_window: 131072,  max_output_tokens: 16000, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.00135,  cost_per_1k_out: 0.0054 },
];

async function seedProviders() {
  for (const p of PROVIDERS) {
    const isActive = ACTIVE_PROVIDER_IDS.has(p.provider_id);
    await sql`
      INSERT INTO nv_llm_providers (provider_id, name, api_base_url, is_active, capabilities, avg_latency_ms, cost_per_1k_tokens_in, cost_per_1k_tokens_out)
      VALUES (${p.provider_id}, ${p.name}, ${p.api_base_url}, ${isActive}, ${p.capabilities as any}, ${p.avg_latency_ms}, ${p.cost_per_1k_tokens_in}, ${p.cost_per_1k_tokens_out})
      ON CONFLICT (provider_id) DO UPDATE SET
        name = EXCLUDED.name,
        api_base_url = EXCLUDED.api_base_url,
        is_active = EXCLUDED.is_active,
        capabilities = EXCLUDED.capabilities,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        cost_per_1k_tokens_in = EXCLUDED.cost_per_1k_tokens_in,
        cost_per_1k_tokens_out = EXCLUDED.cost_per_1k_tokens_out,
        updated_at = NOW()
    `;
    console.log(`  ${isActive ? '✓ ACTIVE  ' : '○ inactive'} ${p.provider_id.padEnd(15)} ${p.name}`);
  }
}

async function seedModels() {
  // Purge stale rows for the 6 active providers, then re-insert.
  // Inactive-provider models (if any leftovers) are dropped — they shouldn't be here.
  await sql`DELETE FROM nv_model_catalog WHERE provider_id NOT IN ('anthropic','openai','google','openrouter','sarvam','bedrock')`;
  for (const m of MODELS) {
    await sql`
      INSERT INTO nv_model_catalog (model_id, provider_id, display_name, context_window, max_output_tokens, supports_vision, supports_tools, cost_per_1k_in, cost_per_1k_out, is_active)
      VALUES (${m.model_id}, ${m.provider_id}, ${m.display_name}, ${m.context_window}, ${m.max_output_tokens}, ${m.supports_vision}, ${m.supports_tools}, ${m.cost_per_1k_in}, ${m.cost_per_1k_out}, true)
      ON CONFLICT (model_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        display_name = EXCLUDED.display_name,
        context_window = EXCLUDED.context_window,
        max_output_tokens = EXCLUDED.max_output_tokens,
        supports_vision = EXCLUDED.supports_vision,
        supports_tools = EXCLUDED.supports_tools,
        cost_per_1k_in = EXCLUDED.cost_per_1k_in,
        cost_per_1k_out = EXCLUDED.cost_per_1k_out,
        is_active = true
    `;
  }
  console.log(`  ✓ ${MODELS.length} models seeded across ${ACTIVE_PROVIDER_IDS.size} active providers`);
}

async function main() {
  console.log('🌱 Seeding LLM providers (23) and model catalog (latest, May 2026)...');
  await assertColumns(sql, './jrx-seed-models', REQUIRED_COLUMNS);
  await seedProviders();
  console.log('✅ Providers seeded (6 active, 17 inactive)');
  await seedModels();
  console.log('✅ Models seeded');
  console.log(`🎉 Seed complete — ${PROVIDERS.length} providers, ${MODELS.length} models`);
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => sql.end());
