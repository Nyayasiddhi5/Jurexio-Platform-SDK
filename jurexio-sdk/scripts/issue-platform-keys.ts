#!/usr/bin/env npx tsx
/**
 * scripts/issue-platform-keys.ts — operator-only one-shot
 *
 * 2026-04-25 (JRX-PLATFORMS-KEYS-001): Provision the three Nyayasiddhi
 * ecosystem platforms requested by ops:
 *   1. nsp-web         (Nyayasiddhi Professional — web client)
 *   2. nsp-mobile      (Nyayasiddhi Professional — mobile/RN client)
 *   3. jurexio-citizen      (Jurexio Citizen — citizen legal-aid)
 *
 * For each platform this script:
 *   - Upserts the row in nv_sdk_applications (idempotent on app_type + name).
 *   - Issues four keys (sdk_api_key, publishable_key, signing_key, webhook_secret)
 *     using the SAME hash format as src/routes/jrx-sdk-keylife-routes.ts so the
 *     keys authenticate against the running gateway.
 *   - Prints the raw keys to stdout EXACTLY ONCE — capture them now or rotate.
 *
 * Idempotence: re-running the script does NOT reissue keys for an app that
 * already has hashes recorded in nv_sdk_applications. To rotate, call the
 * gateway's POST /api/jrx/sdk/keys/:appId/rotate endpoint.
 *
 * Usage:
 *   cd Jurexio-Platform-SDK
 *   npx tsx scripts/issue-platform-keys.ts                   # sandbox keys
 *   JRX_PLATFORM_ENV=production npx tsx scripts/issue-platform-keys.ts  # prod keys
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const env = (process.env.JRX_PLATFORM_ENV ?? 'sandbox') as 'sandbox' | 'production';
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

// Use plain pg driver — neon serverless HTTP client struggles with batch
// INSERT/UPDATE flows that mix RETURNING with array-typed parameters.
const pool = new Pool({
  connectionString: normalizePgConnectionString(dbUrl),
  ssl: dbUrl.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
  max: 3,
});

async function q<T = any>(text: string, values: any[] = []): Promise<T[]> {
  const r = await pool.query(text, values);
  return r.rows as T[];
}

function secureRandomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}
function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
function buildRawKey(type: KeyType, environment: string): string {
  const livetest = environment === 'production' ? 'live' : 'test';
  switch (type) {
    case 'sdk_api_key':     return `nyv_${livetest}_sk_${secureRandomHex(32)}`;
    case 'webhook_secret':  return `nyv_wh_${secureRandomHex(32)}`;
    case 'publishable_key': return `nyv_pk_${secureRandomHex(24)}`;
    case 'signing_key':     return `nyv_ss_${secureRandomHex(64)}`;
  }
}
function keyExpiresAt(type: KeyType): Date {
  const days = type === 'sdk_api_key' ? 90
             : type === 'signing_key' ? 180
             : type === 'publishable_key' ? 365
             : 0;
  if (!days) return new Date(Date.now() + 10 * 365 * 86400 * 1000);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function scopesForKeyType(type: KeyType): string[] {
  switch (type) {
    case 'sdk_api_key':     return ['agents:execute', 'agents:read', 'documents:read', 'documents:write', 'research:read', 'usage:read', 'completions:write'];
    case 'publishable_key': return ['completions:write', 'research:read'];
    case 'webhook_secret':  return ['webhooks:receive'];
    case 'signing_key':     return ['requests:sign'];
  }
}

type KeyType = 'sdk_api_key' | 'webhook_secret' | 'publishable_key' | 'signing_key';

interface PlatformSpec {
  name:           string;
  display_name:   string;
  app_type:       string;
  platform_type:  string;
  contact_email:  string;
  jurisdiction:   string;
  jurisdictions:  string[];
  agents_allowed: string[];
  modules_enabled: Record<string, boolean>;
  llm_config: {
    primary: string;
    fallback: string;
    budget_mode: 'aggressive' | 'balanced' | 'conservative';
    monthly_cap_usd: number;
    alert_threshold_pct: number;
  };
  rate_limits_config: {
    requests_per_min: number;
    requests_per_hour: number;
    requests_per_day: number;
    tokens_per_day: number;
    max_concurrent: number;
  };
}

const PLATFORMS: PlatformSpec[] = [
  {
    name: 'nsp-web',
    display_name: 'Nyayasiddhi Professional — Web',
    app_type: 'web_client',
    platform_type: 'nyayasiddhi-professional',
    contact_email: 'platforms@nyayasiddhi.in',
    jurisdiction: 'IN',
    jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'],
    agents_allowed: ['*'],
    modules_enabled: {
      clawdbot: true, openbot: true, twindesk: true, voice_ai: true,
      automateai: true, doc_intelligence: true, sdk_intelligence: true,
      nyayarag: true, skillshop: true, hitl: true,
    },
    llm_config: {
      primary: 'claude-sonnet-4-6', fallback: 'gpt-4.1',
      budget_mode: 'balanced', monthly_cap_usd: 5000, alert_threshold_pct: 80,
    },
    rate_limits_config: {
      requests_per_min: 120, requests_per_hour: 5000, requests_per_day: 50000,
      tokens_per_day: 25_000_000, max_concurrent: 50,
    },
  },
  {
    name: 'nsp-mobile',
    display_name: 'Nyayasiddhi Professional — Mobile',
    app_type: 'mobile_client',
    platform_type: 'nsp-mobile',
    contact_email: 'platforms@nyayasiddhi.in',
    jurisdiction: 'IN',
    jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'],
    agents_allowed: ['*'],
    modules_enabled: {
      clawdbot: true, openbot: true, twindesk: false, voice_ai: true,
      automateai: false, doc_intelligence: true, sdk_intelligence: true,
      nyayarag: true, skillshop: false, hitl: true,
    },
    llm_config: {
      primary: 'gemini-2-5-pro', fallback: 'claude-haiku-4-5',
      budget_mode: 'aggressive', monthly_cap_usd: 2000, alert_threshold_pct: 75,
    },
    rate_limits_config: {
      requests_per_min: 60, requests_per_hour: 2000, requests_per_day: 20000,
      tokens_per_day: 8_000_000, max_concurrent: 25,
    },
  },
  {
    name: 'jurexio-citizen',
    display_name: 'Jurexio Citizen — Citizen Legal Aid',
    app_type: 'citizen_app',
    platform_type: 'jurexio-citizen',
    contact_email: 'platforms@nyayasiddhi.in',
    jurisdiction: 'IN',
    jurisdictions: ['IN'],
    agents_allowed: [
      'mitra-conversational',
      'clause-classifier',
      'case-brief-generator',
      'agent-jurisdiction-router',
      'agent-language-router',
    ],
    modules_enabled: {
      clawdbot: false, openbot: true, twindesk: false, voice_ai: true,
      automateai: false, doc_intelligence: true, sdk_intelligence: false,
      nyayarag: true, skillshop: false, hitl: false,
    },
    llm_config: {
      primary: 'sarvam-105b', fallback: 'kimi-k2-6',
      budget_mode: 'aggressive', monthly_cap_usd: 1500, alert_threshold_pct: 70,
    },
    rate_limits_config: {
      requests_per_min: 30, requests_per_hour: 1000, requests_per_day: 8000,
      tokens_per_day: 3_000_000, max_concurrent: 10,
    },
  },
];

interface IssuedKey { type: KeyType; raw: string; prefix: string; keyId: string; expiresAt: string; }

async function upsertPlatform(spec: PlatformSpec): Promise<{ id: string; reused: boolean }> {
  const existing = await q<{ id: string; publishable_key_hash: string | null }>(
    `SELECT id, publishable_key_hash FROM nv_sdk_applications
     WHERE name = $1 AND app_type = $2 LIMIT 1`,
    [spec.name, spec.app_type],
  );
  if (existing.length) {
    return { id: String(existing[0].id), reused: !!existing[0].publishable_key_hash };
  }
  const ins = await q<{ id: string }>(
    `INSERT INTO nv_sdk_applications (
       name, display_name, app_type, platform_type, contact_email,
       jurisdiction, jurisdictions, agents_allowed, modules_enabled,
       llm_config, rate_limits_config, environment, tier, is_active, is_provisioned
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,'enterprise',true,true)
     RETURNING id`,
    [
      spec.name, spec.display_name, spec.app_type, spec.platform_type,
      spec.contact_email, spec.jurisdiction, spec.jurisdictions,
      spec.agents_allowed, JSON.stringify(spec.modules_enabled),
      JSON.stringify(spec.llm_config), JSON.stringify(spec.rate_limits_config),
      env,
    ],
  );
  return { id: String(ins[0].id), reused: false };
}

async function issueKey(appId: string, type: KeyType): Promise<IssuedKey> {
  const raw = buildRawKey(type, env);
  const keyHash = hashKey(raw);
  const prefix = raw.slice(0, raw.indexOf('_', 8) + 5);
  const scopes = scopesForKeyType(type);
  const expiresAt = keyExpiresAt(type);
  const rateLimit = type === 'sdk_api_key' ? 5000 : type === 'publishable_key' ? 1000 : 100;

  const ins = await q<{ id: string }>(
    `INSERT INTO nv_api_keys (
       app_id, key_prefix, key_hash, name, key_type,
       permissions, scopes, rate_limit, is_active, expires_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,NOW())
     RETURNING id`,
    [appId, prefix, keyHash, `${type} (provisioned 2026-04-25)`, type, scopes, scopes, rateLimit, expiresAt.toISOString()],
  );
  const keyId = String(ins[0].id);

  if (type === 'webhook_secret') {
    await q(`UPDATE nv_sdk_applications SET webhook_secret_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
  } else if (type === 'publishable_key') {
    await q(`UPDATE nv_sdk_applications SET publishable_key_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
  } else if (type === 'signing_key') {
    await q(`UPDATE nv_sdk_applications SET signing_key_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
  } else {
    await q(`UPDATE nv_sdk_applications SET key_expires_at=$1, updated_at=NOW() WHERE id=$2`, [expiresAt.toISOString(), appId]);
  }

  return { type, raw, prefix, keyId, expiresAt: expiresAt.toISOString() };
}

(async () => {
  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  JRX Platform Key Provisioning — env=${env}  ${new Date().toISOString()}`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);

  for (const spec of PLATFORMS) {
    const { id, reused } = await upsertPlatform(spec);
    console.log(`▶ ${spec.display_name}`);
    console.log(`    app_id:        ${id}`);
    console.log(`    platform_type: ${spec.platform_type}`);
    console.log(`    environment:   ${env}`);
    if (reused) {
      console.log(`    ⚠ Already provisioned — skipping key issuance. Use POST /api/jrx/sdk/keys/${id}/rotate to rotate.\n`);
      continue;
    }
    const issued: IssuedKey[] = [];
    for (const t of ['sdk_api_key', 'publishable_key', 'signing_key', 'webhook_secret'] as KeyType[]) {
      issued.push(await issueKey(id, t));
    }
    console.log(`    Keys issued (RAW — capture now, never recoverable):\n`);
    for (const k of issued) {
      console.log(`      [${k.type.padEnd(16)}] ${k.raw}`);
      console.log(`        key_id:    ${k.keyId}`);
      console.log(`        prefix:    ${k.prefix}`);
      console.log(`        expires:   ${k.expiresAt}\n`);
    }
  }

  console.log(`══════════════════════════════════════════════════════════════════════`);
  console.log(`  Done. Store the RAW values in your secret manager NOW.`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
