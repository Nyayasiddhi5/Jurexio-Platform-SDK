/**
 * Nyayavigya Platform 3.1.2 — Feature Flags Seed
 * NYV-SCRIPT-SEED-FLAGS-001
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_feature_flags': ['flag_key', 'is_enabled', 'description'],
} as const;

const FEATURE_FLAGS = [
  { flag_key: 'nv_avatar_sessions',      is_enabled: true,  description: 'Avatar session API (GAP-020)' },
  { flag_key: 'nv_grpo_training',        is_enabled: true,  description: 'GRPO optimization training runs' },
  { flag_key: 'nv_bmad_clusters',        is_enabled: true,  description: 'BMAD agent cluster formation' },
  { flag_key: 'nv_a2a_collaboration',    is_enabled: true,  description: 'Agent-to-Agent collaboration bus' },
  { flag_key: 'nv_voice_sessions',       is_enabled: true,  description: 'Voice WebSocket sessions' },
  { flag_key: 'nv_mcp_tools',            is_enabled: true,  description: 'MCP tool execution (GitHub, DB, SQS)' },
  { flag_key: 'nv_parlant_journeys',     is_enabled: true,  description: 'Parlant 7-template journeys' },
  { flag_key: 'nv_digital_twin',         is_enabled: true,  description: 'Digital twin simulation' },
  { flag_key: 'nv_multimodal',           is_enabled: true,  description: 'Multimodal (vision + audio) processing' },
  { flag_key: 'nv_hallucination_check',  is_enabled: true,  description: 'Hallucination detection on all responses' },
  { flag_key: 'nv_pii_vault',            is_enabled: true,  description: 'PII vault encryption storage' },
  { flag_key: 'nv_rag_search',           is_enabled: true,  description: 'RAG semantic search on documents' },
  { flag_key: 'nv_social_memory',        is_enabled: true,  description: 'Cross-session social memory' },
  { flag_key: 'nv_cost_analytics',       is_enabled: true,  description: 'Per-request cost analytics' },
  { flag_key: 'nv_real_time_events',     is_enabled: true,  description: 'WebSocket real-time event push' },
];

async function seedFeatureFlags() {
  await assertColumns(sql, './jrx-seed-feature-flags', REQUIRED_COLUMNS);
  for (const flag of FEATURE_FLAGS) {
    await sql`
      INSERT INTO nv_feature_flags (flag_key, is_enabled, description)
      VALUES (${flag.flag_key}, ${flag.is_enabled}, ${flag.description})
      ON CONFLICT (flag_key) DO UPDATE
        SET is_enabled = EXCLUDED.is_enabled,
            description = EXCLUDED.description,
            updated_at = NOW()
    `;
    console.log(`    ✓ ${flag.flag_key}: ${flag.is_enabled ? 'ON' : 'OFF'}`);
  }
  console.log(`  ✓ ${FEATURE_FLAGS.length} feature flags seeded`);
}

seedFeatureFlags().catch(console.error).finally(() => sql.end());
