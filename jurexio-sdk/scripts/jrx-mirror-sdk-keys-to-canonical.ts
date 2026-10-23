/**
 * JRX SDK v5.0.0 — Mirror legacy SDK keys → NEW canonical Drizzle tables
 * ─────────────────────────────────────────────────────────────────────────
 * Why this exists:
 *   The SDK gateway middleware (sdkGatewayAuth) reads from the new Drizzle
 *   tables `public.sdk_applications` + `public.sdk_app_api_keys` (JRX-NS-016
 *   migration), while the canonical seeder writes only to the legacy tables
 *   `public.nv_api_keys` + `public.nv_sdk_applications`.
 *
 *   Until the migration completes (sunset planned for v3.2), API keys must
 *   exist in BOTH tables for end-to-end auth to work.
 *
 *   This script reads the 7 live SDK keys from `.local/secrets-pending.json`
 *   (already seeded into the legacy tables) and mirrors them into the new
 *   canonical tables so they actually authenticate against the running
 *   gateway.
 */

// NV-DB-SCRIPT-001 (2026-05-10): standalone DB scripts MUST use makePgSql
// (real pg.Pool with SSL) — the @neondatabase/serverless HTTP driver
// silently drops writes on the helium dev DB and on RDS, returning
// rowCount=0 even when the row exists. See replit.md § NV-DB-SCRIPT-001.
import { makePgSql } from './_pg-pool.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const sql = makePgSql(DB_URL);

interface PlatformDef {
  envVar: string;
  short: string;
  appName: string;
  appType: string;
  clientId: string;
  scopes: string[];
  rateLimitPerMin: number;
  dailyTokens: number;
  monthlyTokens: number;
  allowedAgents: string[];
}

const PLATFORMS: PlatformDef[] = [
  {
    envVar: 'JRX_SDK_KEY_NSP',
    short: 'nsp',
    appName: 'Jurexio Professional™',
    appType: 'nyayasiddhi_professional',
    clientId: 'nyv_app_nsp_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
    rateLimitPerMin: 60,
    dailyTokens: 5_000_000,
    monthlyTokens: 100_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'JRX_SDK_KEY_NSI',
    short: 'nsi',
    appName: 'Jurexio Institutional™',
    appType: 'nyayasiddhi_institutional',
    clientId: 'nyv_app_nsi_v5',
    scopes: ['*'],
    rateLimitPerMin: 600,
    dailyTokens: 50_000_000,
    monthlyTokens: 1_000_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'JRX_SDK_KEY_NSA',
    short: 'nsa',
    appName: 'Jurexio Academy™',
    appType: 'nyayasiddhi_academy',
    clientId: 'nyv_app_nsa_v5',
    scopes: ['agents:read', 'agents:execute', 'research:read', 'usage:read'],
    rateLimitPerMin: 80,
    dailyTokens: 2_000_000,
    monthlyTokens: 50_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'JRX_SDK_KEY_NSM',
    short: 'nsm',
    appName: 'Jurexio Ministry™',
    appType: 'government',
    clientId: 'nyv_app_nsm_v5',
    scopes: ['*'],
    rateLimitPerMin: 200,
    dailyTokens: 20_000_000,
    monthlyTokens: 500_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'JRX_SDK_KEY_NYM',
    short: 'nym',
    appName: 'Jurexio Citizen Citizen App',
    appType: 'jurexio-citizen',
    clientId: 'nyv_app_nym_v5',
    // task-150: added usage:read so /usage, /cache/stats, /guardrails/stats clear for NYM.
    scopes: ['agents:read', 'agents:execute', 'consumer_intake:write', 'usage:read'],
    rateLimitPerMin: 100,
    dailyTokens: 1_000_000,
    monthlyTokens: 25_000_000,
    allowedAgents: ['nym-*', 'consumer-*'],
  },
  {
    envVar: 'JRX_SDK_KEY_NSPM',
    short: 'nspm',
    appName: 'Jurexio Professional Mobile™',
    appType: 'nys_professional_mobile',
    clientId: 'nyv_app_nspm_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read', 'voice:read', 'voice:execute'],
    rateLimitPerMin: 60,
    dailyTokens: 3_000_000,
    monthlyTokens: 50_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'JRX_SDK_KEY_JRX',
    short: 'jrx',
    appName: 'JurisX™',
    appType: 'jurisx',
    clientId: 'nyv_app_jrx_v5',
    scopes: ['*'],
    rateLimitPerMin: 400,
    dailyTokens: 30_000_000,
    monthlyTokens: 750_000_000,
    allowedAgents: ['*'],
  },
];

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Normalize neon serverless return — sometimes Array, sometimes {rows}. */
function rows<T = any>(r: any): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('  JRX SDK v5.0.0 — Mirror keys → NEW canonical tables (JRX-NS-016)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const pendingPath = path.resolve('.local/secrets-pending.json');
  if (!fs.existsSync(pendingPath)) {
    console.error(`FATAL: ${pendingPath} not found — run jrx-seed-sdk-keys.ts + jrx-issue-extra-sdk-keys.ts first.`);
    process.exit(1);
  }
  const pending: Record<string, string> = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));

  const results: Array<{ platform: string; appId: number; keyId: number; status: string }> = [];

  for (const p of PLATFORMS) {
    const rawKey = pending[p.envVar];
    if (!rawKey) {
      console.error(`✗ ${p.envVar}: not in secrets-pending.json — skipping`);
      continue;
    }

    const keyHash = sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 20); // First 20 chars (column max)

    // Generate a deterministic client_secret pair (not used for SDK auth, but
    // required NOT NULL by schema). We hash a fixed seed per app.
    const clientSecret = `nyv_secret_${p.short}_${sha256Hex(`${p.clientId}::${rawKey.slice(-16)}`).slice(0, 24)}`;
    const clientSecretHash = sha256Hex(clientSecret);
    const clientSecretPrefix = clientSecret.slice(0, 20);

    // 1️⃣  Upsert sdk_applications row
    const appResRaw = await sql`
      INSERT INTO public.sdk_applications (
        app_name, app_type, description, client_id, client_secret_hash, client_secret_prefix,
        allowed_agents, llm_config, rate_limit_per_minute, daily_token_budget, monthly_token_budget,
        allowed_origins, jurisdiction, metadata, status
      ) VALUES (
        ${p.appName}, ${p.appType},
        ${`Auto-mirrored from legacy nv_sdk_applications during JRX-NS-016 migration (SDK v5.0.0).`},
        ${p.clientId}, ${clientSecretHash}, ${clientSecretPrefix},
        ${JSON.stringify(p.allowedAgents)}::jsonb,
        ${JSON.stringify({ primary: 'auto', fallback: 'auto', budget_mode: 'balanced' })}::jsonb,
        ${p.rateLimitPerMin}, ${p.dailyTokens}, ${p.monthlyTokens},
        ${JSON.stringify([])}::jsonb,
        'IN',
        ${JSON.stringify({ short: p.short, sdk_version: '5.0.0', mirrored_from: 'nv_api_keys' })}::jsonb,
        'active'
      )
      ON CONFLICT (client_id) DO UPDATE SET
        app_name = EXCLUDED.app_name,
        app_type = EXCLUDED.app_type,
        rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
        daily_token_budget = EXCLUDED.daily_token_budget,
        monthly_token_budget = EXCLUDED.monthly_token_budget,
        status = 'active',
        updated_at = NOW()
    `;
    void appResRaw;
    // Neon HTTP doesn't always return rows on ON CONFLICT — fetch id explicitly
    const appLookup = rows<{ id: number }>(
      await sql`SELECT id FROM public.sdk_applications WHERE client_id = ${p.clientId} LIMIT 1`
    );
    if (!appLookup[0]) {
      console.error(`✗ ${p.envVar}: app row not found after upsert (client_id=${p.clientId})`);
      continue;
    }
    const appId = appLookup[0].id;

    // 2️⃣  Insert/update sdk_app_api_keys row keyed by key_hash (unique)
    const keyResRaw = await sql`
      INSERT INTO public.sdk_app_api_keys (
        application_id, key_hash, key_prefix, name, scopes, is_active, expires_at
      ) VALUES (
        ${appId}, ${keyHash}, ${keyPrefix},
        ${`${p.appName} — Live Key (SDK v5.0.0)`},
        ${JSON.stringify(p.scopes)}::jsonb,
        true,
        NULL
      )
      ON CONFLICT (key_hash) DO UPDATE SET
        application_id = EXCLUDED.application_id,
        key_prefix = EXCLUDED.key_prefix,
        name = EXCLUDED.name,
        scopes = EXCLUDED.scopes,
        is_active = true
    `;
    void keyResRaw;
    const keyLookup = rows<{ id: number }>(
      await sql`SELECT id FROM public.sdk_app_api_keys WHERE key_hash = ${keyHash} LIMIT 1`
    );
    if (!keyLookup[0]) {
      console.error(`✗ ${p.envVar}: key row not found after upsert (key_hash=${keyHash.slice(0,16)}…)`);
      continue;
    }
    const keyId = keyLookup[0].id;

    results.push({ platform: p.envVar, appId, keyId, status: '✓ mirrored' });
    console.log(`  ✓ ${p.envVar.padEnd(22)} app_id=${appId}  key_id=${keyId}  prefix=${keyPrefix}…`);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(`  Mirrored ${results.length}/${PLATFORMS.length} keys → public.sdk_app_api_keys`);
  console.log('══════════════════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
