#!/usr/bin/env npx tsx
/**
 * scripts/rotate-platform-keys.ts — operator-only one-shot
 *
 * 2026-04-25T14:30Z (JRX-PLATFORMS-KEYS-ROTATE-001):
 * Rotates all 4 key types (sdk_api_key, publishable_key, signing_key,
 * webhook_secret) for the 3 ecosystem platforms and prints raw values.
 *
 * Why: issue-platform-keys.ts is idempotent and refuses to reissue once
 * is_provisioned=true. The original raw keys were captured to a .local/run/
 * log file that has since been wiped. Operator needs fresh keys.
 *
 * What it does:
 *   1. Looks up the 3 platform apps by name.
 *   2. Marks all existing nv_api_keys for those apps is_active=false.
 *   3. Issues 4 fresh raw keys per platform with the same hash format
 *      that jrx-sdk-keylife-routes.ts uses (nyv_test_sk_<32hex>, etc.).
 *   4. Updates nv_sdk_applications.{publishable_key_hash,signing_key_hash,
 *      webhook_secret_hash} so authentication via those fields keeps working.
 *   5. Prints raw values to stdout AND writes them to
 *      .local/run/platform-keys-rotated-<timestamp>.json
 *
 * Usage:
 *   cd Jurexio-Platform-SDK
 *   npx tsx scripts/rotate-platform-keys.ts
 *   JRX_PLATFORM_ENV=production npx tsx scripts/rotate-platform-keys.ts
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const env = (process.env.JRX_PLATFORM_ENV ?? 'sandbox') as 'sandbox' | 'production';
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('FATAL: DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({
  connectionString: normalizePgConnectionString(dbUrl),
  ssl: dbUrl.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
  max: 3,
});

async function q<T = any>(text: string, values: any[] = []): Promise<T[]> {
  const r = await pool.query(text, values);
  return r.rows as T[];
}

type KeyType = 'sdk_api_key' | 'webhook_secret' | 'publishable_key' | 'signing_key';

const PLATFORM_NAMES = ['nsp-web', 'nsp-mobile', 'jurexio-citizen'];

function secureRandomHex(b: number) { return crypto.randomBytes(b).toString('hex'); }
function hashKey(raw: string) { return crypto.createHash('sha256').update(raw).digest('hex'); }

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
  const days =
    type === 'sdk_api_key' ? 90 :
    type === 'signing_key' ? 180 :
    type === 'publishable_key' ? 365 : 0;
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

interface IssuedKey { type: KeyType; raw: string; prefix: string; keyId: string; expiresAt: string; }
interface PlatformOut {
  name: string;
  app_id: string;
  display_name: string;
  platform_type: string;
  environment: string;
  keys: IssuedKey[];
}

async function rotateForApp(appId: string, name: string): Promise<IssuedKey[]> {
  // Step 1: deactivate ALL existing keys for this app.
  const deact = await q<{ id: string }>(
    `UPDATE nv_api_keys SET is_active=false WHERE app_id=$1 AND is_active=true RETURNING id`,
    [appId],
  );
  console.log(`    deactivated ${deact.length} prior key(s) for ${name}`);

  // Step 2: issue 4 fresh keys.
  const issued: IssuedKey[] = [];
  for (const t of ['sdk_api_key', 'publishable_key', 'signing_key', 'webhook_secret'] as KeyType[]) {
    const raw = buildRawKey(t, env);
    const keyHash = hashKey(raw);
    const prefix = raw.slice(0, raw.indexOf('_', 8) + 5);
    const scopes = scopesForKeyType(t);
    const expiresAt = keyExpiresAt(t);
    const rateLimit = t === 'sdk_api_key' ? 5000 : t === 'publishable_key' ? 1000 : 100;
    const ins = await q<{ id: string }>(
      `INSERT INTO nv_api_keys (
         app_id, key_prefix, key_hash, name, key_type,
         permissions, scopes, rate_limit, is_active, expires_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,NOW())
       RETURNING id`,
      [appId, prefix, keyHash, `${t} (rotated 2026-04-25)`, t, scopes, scopes, rateLimit, expiresAt.toISOString()],
    );
    const keyId = String(ins[0].id);

    if (t === 'webhook_secret') {
      await q(`UPDATE nv_sdk_applications SET webhook_secret_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
    } else if (t === 'publishable_key') {
      await q(`UPDATE nv_sdk_applications SET publishable_key_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
    } else if (t === 'signing_key') {
      await q(`UPDATE nv_sdk_applications SET signing_key_hash=$1, updated_at=NOW() WHERE id=$2`, [keyHash, appId]);
    } else {
      await q(`UPDATE nv_sdk_applications SET key_expires_at=$1, updated_at=NOW() WHERE id=$2`, [expiresAt.toISOString(), appId]);
    }
    issued.push({ type: t, raw, prefix, keyId, expiresAt: expiresAt.toISOString() });
  }
  return issued;
}

(async () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), '..', '.local', 'run');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `platform-keys-rotated-${ts}.json`);

  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  JRX Platform Key ROTATION — env=${env}  ${new Date().toISOString()}`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);

  const out: PlatformOut[] = [];
  for (const name of PLATFORM_NAMES) {
    const rows = await q<{ id: string; display_name: string; platform_type: string; environment: string }>(
      `SELECT id, display_name, platform_type, environment FROM nv_sdk_applications WHERE name=$1 LIMIT 1`,
      [name],
    );
    if (!rows.length) {
      console.log(`▶ ${name}: NOT FOUND in nv_sdk_applications — run issue-platform-keys.ts first.\n`);
      continue;
    }
    const row = rows[0];
    console.log(`▶ ${row.display_name}`);
    console.log(`    app_id:        ${row.id}`);
    console.log(`    platform_type: ${row.platform_type}`);
    console.log(`    environment:   ${row.environment}`);
    const keys = await rotateForApp(row.id, name);
    console.log(`    Keys issued (RAW — capture now, never recoverable):\n`);
    for (const k of keys) {
      console.log(`      [${k.type.padEnd(16)}] ${k.raw}`);
      console.log(`        key_id:    ${k.keyId}`);
      console.log(`        prefix:    ${k.prefix}`);
      console.log(`        expires:   ${k.expiresAt}\n`);
    }
    out.push({ name, app_id: row.id, display_name: row.display_name, platform_type: row.platform_type, environment: row.environment, keys });
  }

  fs.writeFileSync(outFile, JSON.stringify({ rotated_at: new Date().toISOString(), env, platforms: out }, null, 2));
  console.log(`══════════════════════════════════════════════════════════════════════`);
  console.log(`  Done. Raw keys also written to: ${outFile}`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
