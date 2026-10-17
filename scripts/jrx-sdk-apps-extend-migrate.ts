/**
 * Nyayavigya Platform 3.1.2 — SDK Applications Schema Extension Migration
 * NYV-MIGRATION-SDK-APPS-EXTEND-001
 *
 * Adds enterprise columns to nv_sdk_applications:
 *   platform_type       — which of the 5 Nyayasiddhi platforms
 *   modules_enabled     — JSONB flags per Nyayavigya module
 *   agents_allowed      — which ROMA L5 agent IDs are active
 *   llm_config          — primary/fallback model, budget mode, monthly cap
 *   rate_limits_config  — req/min, req/hour, tokens/day
 *   webhook_secret_hash — hashed webhook secret (raw shown once)
 *   publishable_key_hash— hashed publishable key (frontend-safe)
 *   signing_key_hash    — hashed signing key (HMAC-SHA256)
 *   key_expires_at      — primary SDK key expiry timestamp
 *   is_provisioned      — whether platform has completed SDK setup
 *   display_name        — human-readable name override
 *   contact_email       — primary technical contact
 *   environment         — 'sandbox' | 'production'
 *
 * Run: npx tsx scripts/jrx-sdk-apps-extend-migrate.ts
 */

// NV-DB-SCRIPT-001 (2026-05-10): see replit.md — neon HTTP silently drops
// writes; standalone scripts must use the pg.Pool shim.
import { makePgSql } from './_pg-pool.js';
import * as dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL not set');
  process.exit(1);
}

const sql = makePgSql(DATABASE_URL);

async function runMigration(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  NYV SDK Applications — Schema Extension Migration');
  console.log('══════════════════════════════════════════════════════\n');

  try {
    // 1. platform_type
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS platform_type VARCHAR(60) DEFAULT 'custom'
    `;
    console.log('  ✓ platform_type column added');

    // 2. modules_enabled
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS modules_enabled JSONB DEFAULT '{
        "clawdbot": false,
        "openbot": false,
        "automateai": false,
        "twindesk": false,
        "skillshop": false,
        "nyayarag": true,
        "doc_intelligence": true,
        "voice_ai": false,
        "hitl": false,
        "sdk_intelligence": true
      }'::jsonb
    `;
    console.log('  ✓ modules_enabled column added');

    // 3. agents_allowed
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS agents_allowed TEXT[] DEFAULT ARRAY['*']
    `;
    console.log('  ✓ agents_allowed column added');

    // 4. llm_config
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS llm_config JSONB DEFAULT '{
        "primary": "claude-sonnet-4-5",
        "fallback": "gpt-4.1",
        "budget_mode": "balanced",
        "monthly_cap_usd": 1000,
        "alert_threshold_pct": 80
      }'::jsonb
    `;
    console.log('  ✓ llm_config column added');

    // 5. rate_limits_config
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS rate_limits_config JSONB DEFAULT '{
        "requests_per_min": 60,
        "requests_per_hour": 2000,
        "requests_per_day": 20000,
        "tokens_per_day": 5000000,
        "max_concurrent": 20
      }'::jsonb
    `;
    console.log('  ✓ rate_limits_config column added');

    // 6. webhook_secret_hash
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS webhook_secret_hash VARCHAR(255)
    `;
    console.log('  ✓ webhook_secret_hash column added');

    // 7. publishable_key_hash
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS publishable_key_hash VARCHAR(255)
    `;
    console.log('  ✓ publishable_key_hash column added');

    // 8. signing_key_hash
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS signing_key_hash VARCHAR(255)
    `;
    console.log('  ✓ signing_key_hash column added');

    // 9. key_expires_at
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS key_expires_at TIMESTAMP
    `;
    console.log('  ✓ key_expires_at column added');

    // 10. is_provisioned
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS is_provisioned BOOLEAN NOT NULL DEFAULT FALSE
    `;
    console.log('  ✓ is_provisioned column added');

    // 11. display_name
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)
    `;
    console.log('  ✓ display_name column added');

    // 12. contact_email
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)
    `;
    console.log('  ✓ contact_email column added');

    // 13. environment
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'sandbox'
    `;
    console.log('  ✓ environment column added');

    // 14. jurisdictions (platform-level array)
    await sql`
      ALTER TABLE nv_sdk_applications
      ADD COLUMN IF NOT EXISTS jurisdictions TEXT[] DEFAULT ARRAY['IN']
    `;
    console.log('  ✓ jurisdictions column added');

    // 15. Indexes for common query patterns
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sdk_apps_platform_type
      ON nv_sdk_applications (platform_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sdk_apps_org_id
      ON nv_sdk_applications (org_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sdk_apps_is_active
      ON nv_sdk_applications (is_active)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sdk_apps_environment
      ON nv_sdk_applications (environment)
    `;
    console.log('  ✓ Indexes created');

    // 16. Extend nv_api_keys with key_type for 4-key model
    await sql`
      ALTER TABLE nv_api_keys
      ADD COLUMN IF NOT EXISTS key_type VARCHAR(30) NOT NULL DEFAULT 'api_key'
    `;
    await sql`
      ALTER TABLE nv_api_keys
      ADD COLUMN IF NOT EXISTS scopes TEXT[] DEFAULT ARRAY['agents:execute', 'documents:read', 'research:read']
    `;
    console.log('  ✓ nv_api_keys extended with key_type + scopes');

    // 17. Verify final state
    const appCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'nv_sdk_applications'
      ORDER BY ordinal_position
    `;
    console.log(`\n  ✓ nv_sdk_applications columns (${appCols.length} total):`);
    appCols.forEach(c => console.log(`    • ${c.column_name} (${c.data_type})`));

    const keyCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'nv_api_keys'
      ORDER BY ordinal_position
    `;
    console.log(`\n  ✓ nv_api_keys columns (${keyCols.length} total):`);
    keyCols.forEach(c => console.log(`    • ${c.column_name} (${c.data_type})`));

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Migration COMPLETE — SDK Applications Extended');
    console.log('══════════════════════════════════════════════════════\n');

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('\n  ✗ Migration FAILED:', msg);
    process.exit(1);
  }
}

runMigration();
