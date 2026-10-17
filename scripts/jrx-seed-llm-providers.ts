/**
 * Nyayavigya Platform 3.1.2 — LLM Providers Seed
 * NYV-SCRIPT-SEED-LLM-001
 * Seeds all 23 supported LLM providers into nv_llm_providers
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_llm_providers': [
    'provider_id', 'name', 'capabilities', 'is_active',
    'cost_per_1k_tokens_in', 'cost_per_1k_tokens_out', 'avg_latency_ms',
  ],
} as const;

const LLM_PROVIDERS = [
  { provider_id: 'openai',       name: 'OpenAI',           capabilities: ['chat', 'vision', 'tools', 'embeddings', 'tts', 'stt'],   cost_in: 0.005,  cost_out: 0.015,  avg_latency: 800  },
  { provider_id: 'anthropic',    name: 'Anthropic',        capabilities: ['chat', 'vision', 'tools', 'long-context'],               cost_in: 0.003,  cost_out: 0.015,  avg_latency: 1200 },
  { provider_id: 'google',       name: 'Google GenAI',     capabilities: ['chat', 'vision', 'tools', 'long-context', 'multimodal'], cost_in: 0.0015, cost_out: 0.006,  avg_latency: 700  },
  { provider_id: 'openrouter',   name: 'OpenRouter',       capabilities: ['chat', 'vision', 'tools', 'multi-model'],               cost_in: 0.001,  cost_out: 0.003,  avg_latency: 900  },
  { provider_id: 'groq',         name: 'Groq',             capabilities: ['chat', 'fast-inference', 'tools'],                      cost_in: 0.0001, cost_out: 0.0001, avg_latency: 200  },
  { provider_id: 'perplexity',   name: 'Perplexity AI',   capabilities: ['chat', 'search', 'real-time'],                          cost_in: 0.001,  cost_out: 0.001,  avg_latency: 1500 },
  { provider_id: 'mistral',      name: 'Mistral AI',       capabilities: ['chat', 'tools', 'embeddings'],                         cost_in: 0.0002, cost_out: 0.0006, avg_latency: 600  },
  { provider_id: 'sarvam',       name: 'Sarvam AI',        capabilities: ['chat', 'tts', 'stt', 'translation', 'indic-languages'], cost_in: 0.0001, cost_out: 0.0002, avg_latency: 500  },
  { provider_id: 'replicate',    name: 'Replicate',        capabilities: ['image-gen', 'video-gen', 'audio', 'custom-models'],    cost_in: 0.0005, cost_out: 0.001,  avg_latency: 3000 },
  { provider_id: 'together',     name: 'Together AI',      capabilities: ['chat', 'tools', 'fine-tuning', 'embeddings'],          cost_in: 0.0002, cost_out: 0.0002, avg_latency: 400  },
  { provider_id: 'cohere',       name: 'Cohere',           capabilities: ['chat', 'embeddings', 'rerank', 'classification'],      cost_in: 0.0003, cost_out: 0.0015, avg_latency: 700  },
  { provider_id: 'fireworks',    name: 'Fireworks AI',     capabilities: ['chat', 'fast-inference', 'tools'],                    cost_in: 0.0001, cost_out: 0.0001, avg_latency: 250  },
  { provider_id: 'deepseek',     name: 'DeepSeek',         capabilities: ['chat', 'reasoning', 'tools', 'code'],                 cost_in: 0.00014, cost_out: 0.00028, avg_latency: 800 },
  { provider_id: 'qwen',         name: 'Alibaba Qwen',     capabilities: ['chat', 'vision', 'tools', 'long-context'],            cost_in: 0.0002, cost_out: 0.0006, avg_latency: 900  },
  { provider_id: 'kimi',         name: 'Kimi (Moonshot)',  capabilities: ['chat', 'long-context', 'tools'],                      cost_in: 0.0001, cost_out: 0.0003, avg_latency: 1000 },
  { provider_id: 'llama',        name: 'Meta LLaMA',       capabilities: ['chat', 'tools', 'open-source'],                       cost_in: 0.0001, cost_out: 0.0001, avg_latency: 300  },
  { provider_id: 'gemma',        name: 'Google Gemma',     capabilities: ['chat', 'open-source', 'lightweight'],                 cost_in: 0.00005, cost_out: 0.0001, avg_latency: 200 },
  { provider_id: 'nvidia',       name: 'NVIDIA NIM',       capabilities: ['chat', 'vision', 'tools', 'enterprise'],             cost_in: 0.0003, cost_out: 0.0009, avg_latency: 500  },
  { provider_id: 'azure-openai', name: 'Azure OpenAI',     capabilities: ['chat', 'vision', 'tools', 'enterprise'],             cost_in: 0.005,  cost_out: 0.015,  avg_latency: 900  },
  { provider_id: 'aws-bedrock',  name: 'AWS Bedrock',      capabilities: ['chat', 'vision', 'tools', 'enterprise'],             cost_in: 0.003,  cost_out: 0.015,  avg_latency: 1000 },
  { provider_id: 'huggingface',  name: 'Hugging Face',     capabilities: ['chat', 'embeddings', 'custom-models', 'open-source'], cost_in: 0.0001, cost_out: 0.0001, avg_latency: 2000 },
  { provider_id: 'exa',          name: 'Exa (Search AI)',  capabilities: ['search', 'retrieval', 'rag'],                        cost_in: 0.001,  cost_out: 0.001,  avg_latency: 800  },
  { provider_id: 'tavily',       name: 'Tavily Search',    capabilities: ['search', 'retrieval', 'real-time'],                  cost_in: 0.0005, cost_out: 0.0005, avg_latency: 1000 },
];

async function seedLlmProviders() {
  await assertColumns(sql, './jrx-seed-llm-providers', REQUIRED_COLUMNS);
  for (const provider of LLM_PROVIDERS) {
    await sql`
      INSERT INTO nv_llm_providers (
        provider_id, name, capabilities, is_active,
        cost_per_1k_tokens_in, cost_per_1k_tokens_out, avg_latency_ms
      )
      VALUES (
        ${provider.provider_id}, ${provider.name}, ${provider.capabilities},
        true, ${provider.cost_in}, ${provider.cost_out}, ${provider.avg_latency}
      )
      ON CONFLICT (provider_id) DO UPDATE
        SET name = EXCLUDED.name,
            capabilities = EXCLUDED.capabilities,
            avg_latency_ms = EXCLUDED.avg_latency_ms,
            updated_at = NOW()
    `;
    console.log(`    ✓ ${provider.name} [${provider.provider_id}]`);
  }
  console.log(`  ✓ ${LLM_PROVIDERS.length} LLM providers seeded`);
}

seedLlmProviders().catch(console.error).finally(() => sql.end());
