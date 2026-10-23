// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('model-catalog-seeder');

const PROVIDERS = [
  { provider_id: 'openai', name: 'OpenAI', api_base_url: 'https://api.openai.com/v1', capabilities: ['chat','embeddings','vision','tools','json_mode'], cost_per_1k_tokens_in: 0.005, cost_per_1k_tokens_out: 0.015, avg_latency_ms: 420 },
  { provider_id: 'anthropic', name: 'Anthropic', api_base_url: 'https://api.anthropic.com/v1', capabilities: ['chat','vision','tools','json_mode'], cost_per_1k_tokens_in: 0.003, cost_per_1k_tokens_out: 0.015, avg_latency_ms: 510 },
  { provider_id: 'google', name: 'Google AI', api_base_url: 'https://generativelanguage.googleapis.com/v1beta', capabilities: ['chat','vision','embeddings','tools','json_mode'], cost_per_1k_tokens_in: 0.00125, cost_per_1k_tokens_out: 0.005, avg_latency_ms: 380 },
  { provider_id: 'meta', name: 'Meta (via OpenRouter)', api_base_url: 'https://openrouter.ai/api/v1', capabilities: ['chat','tools'], cost_per_1k_tokens_in: 0.0008, cost_per_1k_tokens_out: 0.0008, avg_latency_ms: 350 },
  { provider_id: 'mistral', name: 'Mistral AI', api_base_url: 'https://api.mistral.ai/v1', capabilities: ['chat','embeddings','tools','json_mode'], cost_per_1k_tokens_in: 0.002, cost_per_1k_tokens_out: 0.006, avg_latency_ms: 290 },
  { provider_id: 'deepseek', name: 'DeepSeek', api_base_url: 'https://api.deepseek.com/v1', capabilities: ['chat','tools','json_mode'], cost_per_1k_tokens_in: 0.00014, cost_per_1k_tokens_out: 0.00028, avg_latency_ms: 600 },
  { provider_id: 'groq', name: 'Groq', api_base_url: 'https://api.groq.com/openai/v1', capabilities: ['chat','tools'], cost_per_1k_tokens_in: 0.0005, cost_per_1k_tokens_out: 0.001, avg_latency_ms: 120 },
  { provider_id: 'openrouter', name: 'OpenRouter (Aggregator)', api_base_url: 'https://openrouter.ai/api/v1', capabilities: ['chat','vision','tools','json_mode','embeddings'], cost_per_1k_tokens_in: 0.002, cost_per_1k_tokens_out: 0.006, avg_latency_ms: 450 },
];

const MODELS = [
  { model_id: 'gpt-4o', provider_id: 'openai', display_name: 'GPT-4o', context_window: 128000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.005, cost_per_1k_out: 0.015 },
  { model_id: 'gpt-4o-mini', provider_id: 'openai', display_name: 'GPT-4o Mini', context_window: 128000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.00015, cost_per_1k_out: 0.0006 },
  { model_id: 'o3-mini', provider_id: 'openai', display_name: 'o3-mini (Reasoning)', context_window: 200000, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0011, cost_per_1k_out: 0.0044 },
  { model_id: 'claude-sonnet-4-20250514', provider_id: 'anthropic', display_name: 'Claude Sonnet 4', context_window: 200000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.003, cost_per_1k_out: 0.015 },
  { model_id: 'claude-3-5-haiku-20241022', provider_id: 'anthropic', display_name: 'Claude 3.5 Haiku', context_window: 200000, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0008, cost_per_1k_out: 0.004 },
  { model_id: 'gemini-2.0-flash', provider_id: 'google', display_name: 'Gemini 2.0 Flash', context_window: 1048576, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0001, cost_per_1k_out: 0.0004 },
  { model_id: 'gemini-2.5-pro-preview', provider_id: 'google', display_name: 'Gemini 2.5 Pro (Preview)', context_window: 1048576, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.00125, cost_per_1k_out: 0.01 },
  { model_id: 'llama-4-maverick', provider_id: 'meta', display_name: 'Llama 4 Maverick', context_window: 1048576, supports_vision: true, supports_tools: true, cost_per_1k_in: 0.0005, cost_per_1k_out: 0.0005 },
  { model_id: 'llama-3.3-70b', provider_id: 'meta', display_name: 'Llama 3.3 70B', context_window: 131072, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0008, cost_per_1k_out: 0.0008 },
  { model_id: 'mistral-large-latest', provider_id: 'mistral', display_name: 'Mistral Large', context_window: 131072, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.002, cost_per_1k_out: 0.006 },
  { model_id: 'codestral-latest', provider_id: 'mistral', display_name: 'Codestral (Code)', context_window: 256000, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0003, cost_per_1k_out: 0.0009 },
  { model_id: 'deepseek-chat', provider_id: 'deepseek', display_name: 'DeepSeek V3', context_window: 131072, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.00014, cost_per_1k_out: 0.00028 },
  { model_id: 'deepseek-reasoner', provider_id: 'deepseek', display_name: 'DeepSeek R1 (Reasoning)', context_window: 131072, supports_vision: false, supports_tools: false, cost_per_1k_in: 0.00055, cost_per_1k_out: 0.00219 },
  { model_id: 'llama-3.3-70b-versatile', provider_id: 'groq', display_name: 'Llama 3.3 70B (Groq)', context_window: 131072, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.00059, cost_per_1k_out: 0.00079 },
  { model_id: 'qwen/qwen3-235b-a22b', provider_id: 'openrouter', display_name: 'Qwen3 235B-A22B (MoE)', context_window: 131072, supports_vision: false, supports_tools: true, cost_per_1k_in: 0.0005, cost_per_1k_out: 0.0005 },
];

export async function seedModelCatalog(): Promise<{ providers: number; models: number }> {
  try {
    const providerCount = await db.execute(sql`SELECT COUNT(*) as c FROM nv_llm_providers`).then(r => Number((r.rows?.[0] as any)?.c ?? 0)).catch(() => 0);
    const modelCount = await db.execute(sql`SELECT COUNT(*) as c FROM nv_model_catalog`).then(r => Number((r.rows?.[0] as any)?.c ?? 0)).catch(() => 0);

    if (providerCount >= 8 && modelCount >= 15) {
      logger.info(`model_catalog_already_seeded providers=${providerCount} models=${modelCount}`);
      return { providers: providerCount, models: modelCount };
    }

    let seededProviders = 0;
    for (const p of PROVIDERS) {
      await db.execute(sql`
        INSERT INTO nv_llm_providers (provider_id, name, api_base_url, is_active, capabilities, cost_per_1k_tokens_in, cost_per_1k_tokens_out, avg_latency_ms)
        VALUES (${p.provider_id}, ${p.name}, ${p.api_base_url}, true, ${sql.raw(`ARRAY[${p.capabilities.map(c => `'${c}'`).join(',')}]`)}, ${p.cost_per_1k_tokens_in}, ${p.cost_per_1k_tokens_out}, ${p.avg_latency_ms})
        ON CONFLICT (provider_id) DO UPDATE SET
          name = EXCLUDED.name,
          api_base_url = EXCLUDED.api_base_url,
          capabilities = EXCLUDED.capabilities,
          cost_per_1k_tokens_in = EXCLUDED.cost_per_1k_tokens_in,
          cost_per_1k_tokens_out = EXCLUDED.cost_per_1k_tokens_out,
          avg_latency_ms = EXCLUDED.avg_latency_ms,
          updated_at = NOW()
      `);
      seededProviders++;
    }

    let seededModels = 0;
    for (const m of MODELS) {
      await db.execute(sql`
        INSERT INTO nv_model_catalog (model_id, provider_id, display_name, context_window, supports_vision, supports_tools, cost_per_1k_in, cost_per_1k_out, is_active)
        VALUES (${m.model_id}, ${m.provider_id}, ${m.display_name}, ${m.context_window}, ${m.supports_vision}, ${m.supports_tools}, ${m.cost_per_1k_in}, ${m.cost_per_1k_out}, true)
        ON CONFLICT (model_id) DO UPDATE SET
          provider_id = EXCLUDED.provider_id,
          display_name = EXCLUDED.display_name,
          context_window = EXCLUDED.context_window,
          supports_vision = EXCLUDED.supports_vision,
          supports_tools = EXCLUDED.supports_tools,
          cost_per_1k_in = EXCLUDED.cost_per_1k_in,
          cost_per_1k_out = EXCLUDED.cost_per_1k_out
      `);
      seededModels++;
    }

    logger.info(`model_catalog_seeded providers=${seededProviders} models=${seededModels}`);
    return { providers: seededProviders, models: seededModels };
  } catch (err: any) {
    logger.warn(`model_catalog_seed_failed err=${(err as Error).message}`);
    return { providers: 0, models: 0 };
  }
}
