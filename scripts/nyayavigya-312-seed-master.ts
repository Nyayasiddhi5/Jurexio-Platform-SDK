/**
 * ══════════════════════════════════════════════════════════════════════════════
 * NYAYAVIGYA PLATFORM 3.1.2 — MASTER STANDALONE SEED SCRIPT
 * NYV-SCRIPT-SEED-MASTER-001 | April 04, 2026
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Self-contained single-file seed script.
 * Covers all data seeded by the 8 individual seed scripts.
 * Idempotent — safe to run multiple times (ON CONFLICT DO UPDATE everywhere).
 *
 * Usage:
 *   npx tsx scripts/nyayavigya-312-seed-master.ts
 *
 * Requires:
 *   DATABASE_URL env var (Neon / PostgreSQL)
 *
 * What this seeds:
 *   1. Feature Flags (15)
 *   2. Jurisdiction Configs (6: IN, UK, GC, EU, US, SG)
 *   3. LLM Providers (23)
 *   4. Demo Organizations (4)
 *   5. Demo Users (6) — password: $NV_DEMO_PASSWORD (operator-managed)
 *   6. SDK Applications (5)
 *   7. MCP Tools (10)
 *   8. System Configs (15 platform constants)
 *
 * NOT covered here (requires external files/services):
 *   - Legal Agents (452): run nv-seed-agents.ts → reads jrx-agents-registry.json
 *   - Statute DB: run nv-seed-statutes.ts → calls NyayavignStatuteSeedingService
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

// NV-DB-SCRIPT-001 (2026-05-10): see replit.md — neon HTTP silently drops
// writes; standalone scripts must use the pg.Pool shim.
import { makePgSql } from './_pg-pool.js';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('\n  ✗ DATABASE_URL not set. Exiting.\n');
  process.exit(1);
}

const sql = makePgSql(process.env.DATABASE_URL);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function banner(title: string) {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ${title}`);
  console.log('══════════════════════════════════════════════════════\n');
}

function section(name: string) {
  console.log(`\n  ── ${name} ──────────────────────────────────────`);
}

function ok(msg: string) {
  console.log(`    ✓ ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · FEATURE FLAGS
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_FLAGS = [
  { flag_key: 'nv_avatar_sessions',    is_enabled: true,  description: 'Avatar session API (GAP-020)' },
  { flag_key: 'nv_grpo_training',      is_enabled: true,  description: 'GRPO optimization training runs' },
  { flag_key: 'nv_bmad_clusters',      is_enabled: true,  description: 'BMAD agent cluster formation' },
  { flag_key: 'nv_a2a_collaboration',  is_enabled: true,  description: 'Agent-to-Agent collaboration bus' },
  { flag_key: 'nv_voice_sessions',     is_enabled: true,  description: 'Voice WebSocket sessions' },
  { flag_key: 'nv_mcp_tools',          is_enabled: true,  description: 'MCP tool execution (GitHub, DB, SQS)' },
  { flag_key: 'nv_parlant_journeys',   is_enabled: true,  description: 'Parlant 7-template journeys' },
  { flag_key: 'nv_digital_twin',       is_enabled: true,  description: 'Digital twin simulation' },
  { flag_key: 'nv_multimodal',         is_enabled: true,  description: 'Multimodal (vision + audio) processing' },
  { flag_key: 'nv_hallucination_check',is_enabled: true,  description: 'Hallucination detection on all responses' },
  { flag_key: 'nv_pii_vault',          is_enabled: true,  description: 'PII vault encryption storage' },
  { flag_key: 'nv_rag_search',         is_enabled: true,  description: 'RAG semantic search on documents' },
  { flag_key: 'nv_social_memory',      is_enabled: true,  description: 'Cross-session social memory' },
  { flag_key: 'nv_cost_analytics',     is_enabled: true,  description: 'Per-request cost analytics' },
  { flag_key: 'nv_real_time_events',   is_enabled: true,  description: 'WebSocket real-time event push' },
];

async function seedFeatureFlags() {
  section('Feature Flags');
  for (const flag of FEATURE_FLAGS) {
    await sql`
      INSERT INTO nv_feature_flags (flag_key, is_enabled, description)
      VALUES (${flag.flag_key}, ${flag.is_enabled}, ${flag.description})
      ON CONFLICT (flag_key) DO UPDATE
        SET is_enabled  = EXCLUDED.is_enabled,
            description = EXCLUDED.description,
            updated_at  = NOW()
    `;
    ok(`${flag.flag_key}: ${flag.is_enabled ? 'ON' : 'OFF'}`);
  }
  console.log(`\n  ✓ ${FEATURE_FLAGS.length} feature flags seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · JURISDICTION CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL_JURISDICTIONS = [
  {
    jurisdiction: 'IN',
    name: 'India',
    slm_binding: 'NS-SLM-IND',
    legal_framework: [
      'Constitution of India 1950',
      'BNS 2023 (Bharatiya Nyaya Sanhita)',
      'BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita)',
      'BSA 2023 (Bharatiya Sakshya Adhiniyam)',
      'CPC 1908',
      'Companies Act 2013',
      'DPDPA 2023 (Digital Personal Data Protection Act)',
      'Income Tax Act 1961',
      'GST Laws 2017',
      'Arbitration and Conciliation Act 1996',
    ],
    languages: ['en','hi','ta','te','kn','ml','mr','gu','pa','bn','or','as','ur','sa','kok','mai','mni','ks','sd','doi','sat'],
    currency: 'INR',
  },
  {
    jurisdiction: 'UK',
    name: 'United Kingdom',
    slm_binding: 'NS-SLM-UK',
    legal_framework: [
      'UK GDPR',
      'Data Protection Act 2018',
      'Companies Act 2006',
      'Employment Rights Act 1996',
      'Equality Act 2010',
      'Arbitration Act 1996',
      'Financial Services and Markets Act 2000',
      'Proceeds of Crime Act 2002',
      'Consumer Rights Act 2015',
      'UK AI Regulation Framework 2024',
    ],
    languages: ['en','cy','gd'],
    currency: 'GBP',
  },
  {
    jurisdiction: 'GC',
    name: 'GCC (Gulf Cooperation Council)',
    slm_binding: 'NS-SLM-GCC',
    legal_framework: [
      'UAE Federal Law',
      'UAE Civil Code (Federal Law No. 5/1985)',
      'DIFC Laws and Regulations',
      'ADGM Laws and Regulations',
      'Saudi Commercial Law',
      'Saudi Labor Law',
      'GCC Common Market Agreement',
      'GCC Cybercrime Law',
      'PDPL (Saudi Personal Data Protection Law)',
      'UAE Federal Decree-Law No. 45/2021 (Data Protection)',
    ],
    languages: ['en','ar'],
    currency: 'AED',
  },
  {
    jurisdiction: 'EU',
    name: 'European Union',
    slm_binding: 'NS-SLM-EUR',
    legal_framework: [
      'GDPR (General Data Protection Regulation)',
      'EU AI Act 2024',
      'Digital Services Act (DSA)',
      'Digital Markets Act (DMA)',
      'NIS2 Directive',
      'ePrivacy Directive',
      'ECHR (European Convention on Human Rights)',
      'EU Consumer Rights Directive',
    ],
    languages: ['en','fr','de','es','it','nl','pl','pt','ro','sv','da','fi'],
    currency: 'EUR',
  },
  {
    jurisdiction: 'US',
    name: 'United States',
    slm_binding: 'NS-SLM-USA',
    legal_framework: [
      'US Federal Constitution',
      'Uniform Commercial Code (UCC)',
      'CCPA (California Consumer Privacy Act)',
      'HIPAA',
      'SOX (Sarbanes-Oxley Act)',
      'SEC Regulations',
      'Federal Rules of Civil Procedure',
      'Federal Rules of Evidence',
      'State Laws (50 states)',
    ],
    languages: ['en','es'],
    currency: 'USD',
  },
  {
    jurisdiction: 'SG',
    name: 'Singapore',
    slm_binding: 'NS-SLM-SGP',
    legal_framework: [
      'Singapore Companies Act 1967',
      'PDPA (Personal Data Protection Act 2012)',
      'Employment Act (Cap. 91)',
      'Electronic Transactions Act',
      'Securities and Futures Act',
      'Arbitration Act',
      'MAS (Monetary Authority of Singapore) Regulations',
    ],
    languages: ['en','zh','ms','ta'],
    currency: 'SGD',
  },
];

async function seedJurisdictions() {
  section('Jurisdiction Configs');
  for (const j of CANONICAL_JURISDICTIONS) {
    await sql`
      INSERT INTO nv_jurisdiction_configs (jurisdiction, name, legal_framework, languages, currency)
      VALUES (${j.jurisdiction}, ${j.name}, ${j.legal_framework}, ${j.languages}, ${j.currency})
      ON CONFLICT (jurisdiction) DO UPDATE
        SET name           = EXCLUDED.name,
            legal_framework = EXCLUDED.legal_framework,
            languages       = EXCLUDED.languages
    `;
    ok(`${j.jurisdiction}: ${j.name} [${j.slm_binding}]`);
  }
  console.log(`\n  ✓ ${CANONICAL_JURISDICTIONS.length} jurisdictions seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · LLM PROVIDERS
// ─────────────────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = [
  { provider_id: 'openai',       name: 'OpenAI',           capabilities: ['chat','vision','tools','embeddings','tts','stt'],            cost_in: 0.005,    cost_out: 0.015,    avg_latency: 800  },
  { provider_id: 'anthropic',    name: 'Anthropic',        capabilities: ['chat','vision','tools','long-context'],                      cost_in: 0.003,    cost_out: 0.015,    avg_latency: 1200 },
  { provider_id: 'google',       name: 'Google GenAI',     capabilities: ['chat','vision','tools','long-context','multimodal'],         cost_in: 0.0015,   cost_out: 0.006,    avg_latency: 700  },
  { provider_id: 'openrouter',   name: 'OpenRouter',       capabilities: ['chat','vision','tools','multi-model'],                       cost_in: 0.001,    cost_out: 0.003,    avg_latency: 900  },
  { provider_id: 'groq',         name: 'Groq',             capabilities: ['chat','fast-inference','tools'],                             cost_in: 0.0001,   cost_out: 0.0001,   avg_latency: 200  },
  { provider_id: 'perplexity',   name: 'Perplexity AI',   capabilities: ['chat','search','real-time'],                                 cost_in: 0.001,    cost_out: 0.001,    avg_latency: 1500 },
  { provider_id: 'mistral',      name: 'Mistral AI',       capabilities: ['chat','tools','embeddings'],                                cost_in: 0.0002,   cost_out: 0.0006,   avg_latency: 600  },
  { provider_id: 'sarvam',       name: 'Sarvam AI',        capabilities: ['chat','tts','stt','translation','indic-languages'],          cost_in: 0.0001,   cost_out: 0.0002,   avg_latency: 500  },
  { provider_id: 'replicate',    name: 'Replicate',        capabilities: ['image-gen','video-gen','audio','custom-models'],            cost_in: 0.0005,   cost_out: 0.001,    avg_latency: 3000 },
  { provider_id: 'together',     name: 'Together AI',      capabilities: ['chat','tools','fine-tuning','embeddings'],                  cost_in: 0.0002,   cost_out: 0.0002,   avg_latency: 400  },
  { provider_id: 'cohere',       name: 'Cohere',           capabilities: ['chat','embeddings','rerank','classification'],              cost_in: 0.0003,   cost_out: 0.0015,   avg_latency: 700  },
  { provider_id: 'fireworks',    name: 'Fireworks AI',     capabilities: ['chat','fast-inference','tools'],                           cost_in: 0.0001,   cost_out: 0.0001,   avg_latency: 250  },
  { provider_id: 'deepseek',     name: 'DeepSeek',         capabilities: ['chat','reasoning','tools','code'],                         cost_in: 0.00014,  cost_out: 0.00028,  avg_latency: 800  },
  { provider_id: 'qwen',         name: 'Alibaba Qwen',     capabilities: ['chat','vision','tools','long-context'],                    cost_in: 0.0002,   cost_out: 0.0006,   avg_latency: 900  },
  { provider_id: 'kimi',         name: 'Kimi (Moonshot)',  capabilities: ['chat','long-context','tools'],                             cost_in: 0.0001,   cost_out: 0.0003,   avg_latency: 1000 },
  { provider_id: 'llama',        name: 'Meta LLaMA',       capabilities: ['chat','tools','open-source'],                              cost_in: 0.0001,   cost_out: 0.0001,   avg_latency: 300  },
  { provider_id: 'gemma',        name: 'Google Gemma',     capabilities: ['chat','open-source','lightweight'],                        cost_in: 0.00005,  cost_out: 0.0001,   avg_latency: 200  },
  { provider_id: 'nvidia',       name: 'NVIDIA NIM',       capabilities: ['chat','vision','tools','enterprise'],                      cost_in: 0.0003,   cost_out: 0.0009,   avg_latency: 500  },
  { provider_id: 'azure-openai', name: 'Azure OpenAI',     capabilities: ['chat','vision','tools','enterprise'],                      cost_in: 0.005,    cost_out: 0.015,    avg_latency: 900  },
  { provider_id: 'aws-bedrock',  name: 'AWS Bedrock',      capabilities: ['chat','vision','tools','enterprise'],                      cost_in: 0.003,    cost_out: 0.015,    avg_latency: 1000 },
  { provider_id: 'huggingface',  name: 'Hugging Face',     capabilities: ['chat','embeddings','custom-models','open-source'],        cost_in: 0.0001,   cost_out: 0.0001,   avg_latency: 2000 },
  { provider_id: 'exa',          name: 'Exa (Search AI)',  capabilities: ['search','retrieval','rag'],                               cost_in: 0.001,    cost_out: 0.001,    avg_latency: 800  },
  { provider_id: 'tavily',       name: 'Tavily Search',    capabilities: ['search','retrieval','real-time'],                         cost_in: 0.0005,   cost_out: 0.0005,   avg_latency: 1000 },
];

async function seedLlmProviders() {
  section('LLM Providers');
  for (const p of LLM_PROVIDERS) {
    await sql`
      INSERT INTO nv_llm_providers (
        provider_id, name, capabilities, is_active,
        cost_per_1k_tokens_in, cost_per_1k_tokens_out, avg_latency_ms
      )
      VALUES (
        ${p.provider_id}, ${p.name}, ${p.capabilities},
        true, ${p.cost_in}, ${p.cost_out}, ${p.avg_latency}
      )
      ON CONFLICT (provider_id) DO UPDATE
        SET name           = EXCLUDED.name,
            capabilities   = EXCLUDED.capabilities,
            avg_latency_ms = EXCLUDED.avg_latency_ms,
            updated_at     = NOW()
    `;
    ok(`${p.name} [${p.provider_id}]`);
  }
  console.log(`\n  ✓ ${LLM_PROVIDERS.length} LLM providers seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · DEMO ORGANIZATIONS
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_ORGS = [
  { name: 'Nyayavigya Technologies',           slug: 'nyayavigya-tech',  tier: 'enterprise' },
  { name: 'Demo Law Firm (Pro)',                slug: 'demo-law-firm-pro', tier: 'pro'        },
  { name: 'Demo Legal Department (Plus)',       slug: 'demo-legal-dept',  tier: 'plus'       },
  { name: 'Demo Bar Association (Enterprise)', slug: 'demo-bar-assoc',   tier: 'enterprise' },
];

async function seedOrganizations() {
  section('Demo Organizations');
  for (const org of DEMO_ORGS) {
    await sql`
      INSERT INTO nv_organizations (name, slug, tier)
      VALUES (${org.name}, ${org.slug}, ${org.tier})
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            tier = EXCLUDED.tier
    `;
    ok(`${org.name} [${org.tier}]`);
  }
  console.log(`\n  ✓ ${DEMO_ORGS.length} organizations seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · DEMO USERS
// ─────────────────────────────────────────────────────────────────────────────

// NYV-SECURITY-DOC-CREDS-001: demo password is operator-managed (Replit
// Secret in dev, SSM Parameter Store in EC2). Refuses to seed without it.
const DEMO_PASSWORD = (() => {
  const v = process.env.NV_DEMO_PASSWORD;
  if (!v || v.length < 12) {
    throw new Error(
      'NYV-SEED-MISSING-PW: NV_DEMO_PASSWORD env var (>= 12 chars) required to seed demo users.',
    );
  }
  return v;
})();

const DEMO_USERS = [
  { email: 'admin@nyayavigya.in',         name: 'SDK Administrator', role: 'super_admin', tier: 'enterprise' },
  { email: 'dev@demo.nyayavigya.in',      name: 'Demo Developer',   role: 'developer',   tier: 'pro'        },
  { email: 'analyst@demo.nyayavigya.in',  name: 'Demo Analyst',     role: 'analyst',     tier: 'plus'       },
  { email: 'operator@demo.nyayavigya.in', name: 'Demo Operator',    role: 'operator',    tier: 'pro'        },
  { email: 'manager@demo.nyayavigya.in',  name: 'Demo Manager',     role: 'manager',     tier: 'enterprise' },
  { email: 'user@demo.nyayavigya.in',     name: 'Demo User',        role: 'user',        tier: 'solo'       },
];

async function seedUsers() {
  section('Demo Users');
  console.log(`    Hashing password (bcrypt cost 12)...`);
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const user of DEMO_USERS) {
    await sql`
      INSERT INTO nv_users (email, password_hash, full_name, role, tier)
      VALUES (${user.email}, ${hash}, ${user.name}, ${user.role}, ${user.tier})
      ON CONFLICT (email) DO UPDATE
        SET role       = EXCLUDED.role,
            tier       = EXCLUDED.tier,
            full_name  = EXCLUDED.full_name
    `;
    ok(`${user.email} [${user.role}/${user.tier}]`);
  }
  console.log(`\n  ✓ ${DEMO_USERS.length} demo users seeded`);
  // NV-SEC-2026-05-08 (hounddog CRITICAL PASSWORD): never echo the demo
  // password value to stdout. Read it from the DEMO_PASSWORD env-var.
  console.log(`  ✓ Demo password: <set via DEMO_PASSWORD env-var; not logged>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · SDK APPLICATIONS
// ─────────────────────────────────────────────────────────────────────────────

const SDK_APPS = [
  { id: 'nvsdkapp-demo-nsp-001',        name: 'Nyayasiddhi Professional™ Integration',  app_type: 'nyayasiddhi_professional',  jurisdiction: 'IN', tier: 'pro'        },
  { id: 'nvsdkapp-demo-nm-001',          name: 'Nyayamitra Citizen App Integration',     app_type: 'nyayamitra',                jurisdiction: 'IN', tier: 'plus'       },
  { id: 'nvsdkapp-demo-playground-001', name: 'SDK Playground (Developer Testing)',      app_type: 'custom',                    jurisdiction: 'IN', tier: 'solo'       },
  { id: 'nvsdkapp-demo-nyi-001',         name: 'Nyayasiddhi Institutional™ Integration', app_type: 'nyayasiddhi_institutional', jurisdiction: 'IN', tier: 'enterprise' },
  { id: 'nvsdkapp-demo-academy-001',    name: 'Nyayasiddhi Academy™ Integration',        app_type: 'nyayasiddhi_academy',       jurisdiction: 'IN', tier: 'pro'        },
];

async function seedSdkApps() {
  section('SDK Applications');
  for (const app of SDK_APPS) {
    await sql`
      INSERT INTO nv_sdk_applications (id, name, app_type, jurisdiction, tier)
      VALUES (${app.id}, ${app.name}, ${app.app_type}, ${app.jurisdiction}, ${app.tier})
      ON CONFLICT (id) DO UPDATE
        SET name     = EXCLUDED.name,
            app_type = EXCLUDED.app_type
    `;
    ok(`${app.name} [${app.tier}]`);
  }
  console.log(`\n  ✓ ${SDK_APPS.length} SDK applications seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · MCP TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const MCP_TOOLS = [
  { tool_id: 'NYV-MCP-GITHUB-001',   name: 'GitHub Repository Tool',    tool_type: 'github',    description: 'Read/write GitHub repos, create PRs, manage issues'                     },
  { tool_id: 'NYV-MCP-DBQUERY-001',  name: 'Database Query Tool',       tool_type: 'db-query',  description: 'Execute safe read-only SQL queries against NV databases'                },
  { tool_id: 'NYV-MCP-SQS-001',      name: 'SQS Batch Processing Tool', tool_type: 'sqs-batch', description: 'Push batch jobs to AWS SQS for async processing'                        },
  { tool_id: 'NYV-MCP-SEARCH-001',   name: 'Web Search Tool',           tool_type: 'search',    description: 'Real-time web search via Exa / Tavily / Perplexity'                     },
  { tool_id: 'NYV-MCP-SCRAPE-001',   name: 'Web Scraping Tool',         tool_type: 'scrape',    description: 'Extract structured content from legal websites'                         },
  { tool_id: 'NYV-MCP-DOC-001',      name: 'Document Processing Tool',  tool_type: 'document',  description: 'Extract, analyze, and summarize legal documents (PDF, DOCX)'            },
  { tool_id: 'NYV-MCP-CODE-001',     name: 'Code Execution Tool',       tool_type: 'code',      description: 'Safe sandboxed JavaScript/Python execution via vm2'                     },
  { tool_id: 'NYV-MCP-STORAGE-001',  name: 'Storage Tool',              tool_type: 'storage',   description: 'Read/write files to GCS / Replit Object Storage'                        },
  { tool_id: 'NYV-MCP-EMAIL-001',    name: 'Email Notification Tool',   tool_type: 'email',     description: 'Send email notifications via SMTP'                                      },
  { tool_id: 'NYV-MCP-CALENDAR-001', name: 'Calendar Tool',             tool_type: 'calendar',  description: 'Create legal deadline reminders and court date events'                   },
];

async function seedMcpTools() {
  section('MCP Tools');
  for (const tool of MCP_TOOLS) {
    await sql`
      INSERT INTO nv_mcp_tools (tool_id, name, description, tool_type, is_active)
      VALUES (${tool.tool_id}, ${tool.name}, ${tool.description}, ${tool.tool_type}, true)
      ON CONFLICT (tool_id) DO UPDATE
        SET name        = EXCLUDED.name,
            description = EXCLUDED.description
    `;
    ok(`${tool.tool_id}: ${tool.name}`);
  }
  console.log(`\n  ✓ ${MCP_TOOLS.length} MCP tools seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · SYSTEM CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_CONFIGS = [
  { key: 'platform.version',          value: '3.1.2',              desc: 'Platform version — stays 312 until live production'    },
  { key: 'platform.name',             value: 'Nyayavigya Platform', desc: 'Platform display name'                                },
  { key: 'platform.agent_count',      value: '149',                desc: 'Total agent count: 148 domain + 1 NS-Queen'           },
  { key: 'platform.launch_target',    value: 'September 2026',     desc: 'First release: India, UK, USA'                        },
  { key: 'platform.api_prefix',       value: '/api/jrx/',           desc: 'API prefix (NEVER /api/nyv/)'                         },
  { key: 'platform.jurisdictions',    value: 'IN,UK,GC,EU,US,SG', desc: 'Canonical 6 jurisdictions'                            },
  { key: 'platform.patterns_count',   value: '22',                 desc: 'Total ROMA L5 patterns (P01–P22)'                     },
  { key: 'grpo.min_pairs_for_update', value: '20',                 desc: 'Minimum training pairs before GRPO policy update'     },
  { key: 'grpo.default_reward',       value: '0.7',                desc: 'Default GRPO reward if evaluation unavailable'        },
  { key: 'sdk.rate_limit_default',    value: '1000',               desc: 'Default API key rate limit per hour'                  },
  { key: 'audit.chain_algo',          value: 'sha256',             desc: 'Hash chain algorithm for nv_schema.nv_audit_logs'     },
  { key: 'pii.expiry_minutes',        value: '30',                 desc: 'Default PII vault entry expiry in minutes'            },
  { key: 'hitl.default_priority',     value: 'normal',             desc: 'Default HITL queue priority'                         },
  { key: 'llm.default_model',         value: 'claude-opus-4-6',   desc: 'Platform default LLM model'                           },
  { key: 'llm.fallback_model',        value: 'gpt-4.1',            desc: 'Platform fallback LLM model'                         },
];

async function seedSystemConfigs() {
  section('System Configs');
  for (const cfg of SYSTEM_CONFIGS) {
    await sql`
      INSERT INTO nv_system_configs (config_key, config_value, description)
      VALUES (${cfg.key}, ${cfg.value}, ${cfg.desc})
      ON CONFLICT (config_key) DO UPDATE
        SET config_value = EXCLUDED.config_value,
            description  = EXCLUDED.description,
            updated_at   = NOW()
    `;
    ok(`${cfg.key} = ${cfg.value}`);
  }
  console.log(`\n  ✓ ${SYSTEM_CONFIGS.length} system configs seeded`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  banner('Nyayavigya Platform 3.1.2 — Master Seed Script');

  const steps: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'Feature Flags',       fn: seedFeatureFlags    },
    { name: 'Jurisdiction Configs',fn: seedJurisdictions   },
    { name: 'LLM Providers',       fn: seedLlmProviders    },
    { name: 'Organizations',       fn: seedOrganizations   },
    { name: 'Demo Users',          fn: seedUsers           },
    { name: 'SDK Applications',    fn: seedSdkApps         },
    { name: 'MCP Tools',           fn: seedMcpTools        },
    { name: 'System Configs',      fn: seedSystemConfigs   },
  ];

  for (const step of steps) {
    try {
      await step.fn();
    } catch (err: any) {
      console.error(`\n  ✗ ${step.name} failed: ${err.message}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Master seed complete');
  console.log('');
  console.log('  Still needed (run separately):');
  console.log('    npx tsx scripts/jrx-seed-agents.ts');
  console.log('      → 452 ROMA L5 agents from jrx-agents-registry.json');
  console.log('    npx tsx scripts/jrx-seed-statutes.ts');
  console.log('      → Statute DB (IN, UK, US, EU, GCC, SG)');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n  ✗ Master seed failed:', err);
  process.exit(1);
});
