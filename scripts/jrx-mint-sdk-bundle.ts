/**
 * Nyayavigya Platform 3.1.2 — SDK 4-Key Bundle Mint (canonical-compatible)
 * NYV-SCRIPT-MINT-BUNDLE-001 (2026-05-02)
 *
 * Mints the full 4-key bundle (sdk_api_key, publishable_key, signing_key,
 * webhook_secret) for the 5 priority platforms in the Nyayavigya ecosystem:
 *
 *   1. NSP-WEB    (nyayasiddhi_professional, IN, pro)
 *   2. NSP-MOBILE (nyayasiddhi_professional, IN, pro)
 *   3. NYM        (nyayamitra,                IN, plus)
 *   4. NSI        (nyayasiddhi_institutional, IN, enterprise)
 *   5. JRX        (nyayasiddhi_institutional, US, enterprise)  [JuRiX, US-version of NSI]
 *
 * NSM (Ministry) is intentionally excluded — see runbook §8.2 C1.
 *
 * Schema reality (verified 2026-05-02):
 *   nv_api_keys cols: id, app_id, key_prefix, key_hash, name,
 *                     permissions (text[]), rate_limit, is_active,
 *                     last_used_at, expires_at, created_at
 *   (No key_type, no scopes column. Type encoded in name + key_prefix.
 *    Permissions stored in `permissions` array.)
 *
 * Usage on EC2 (root):
 *   docker exec nyv-gateway sh -c \
 *     'cd /app && NYV_PLATFORM_ENV=production npx tsx /app/scripts/jrx-mint-sdk-bundle.ts'
 *
 * Usage on Replit:
 *   cd nyayavigya-platform-312
 *   NYV_PLATFORM_ENV=sandbox npx tsx scripts/jrx-mint-sdk-bundle.ts
 *
 * Output:
 *   stdout: per-platform table with first 24 chars of each raw key + expiry
 *   file:   .local/run/sdk-bundle-<env>-<ts>.json (root 600 on EC2)
 */

import { makePgSql } from './_pg-pool.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

const env = (process.env.NYV_PLATFORM_ENV ?? 'sandbox') as 'sandbox' | 'production';
const liveTest = env === 'production' ? 'live' : 'test';

interface Platform {
  code: string;
  short: string;
  name: string;
  appId: string;
  tier: string;
  rateBase: number;
  jurisdiction: string;
}

const PLATFORMS: Platform[] = [
  { code: 'nsp-web',     short: 'nsw', name: 'Nyayasiddhi Professional — Web',    appId: 'nvsdkapp-demo-nsp-001',        tier: 'pro',        rateBase: 5000,  jurisdiction: 'IN' },
  { code: 'nsp-mobile',  short: 'nsb', name: 'Nyayasiddhi Professional — Mobile', appId: 'nvsdkapp-demo-nsp-mobile-001', tier: 'pro',        rateBase: 5000,  jurisdiction: 'IN' },
  { code: 'nyayamitra',  short: 'nym', name: 'Nyayamitra Citizen App',            appId: 'nvsdkapp-demo-nm-001',         tier: 'plus',       rateBase: 1000,  jurisdiction: 'IN' },
  { code: 'nsi',         short: 'nsi', name: 'Nyayasiddhi Institutional (IN)',    appId: 'nvsdkapp-demo-nyi-001',        tier: 'enterprise', rateBase: 10000, jurisdiction: 'IN' },
  { code: 'jrx',         short: 'jrx', name: 'JuRiX (US Institutional)',          appId: 'nvsdkapp-demo-jrx-001',        tier: 'enterprise', rateBase: 10000, jurisdiction: 'US' },
];

interface KeyTypeSpec {
  type: 'sdk_api_key' | 'publishable_key' | 'signing_key' | 'webhook_secret';
  prefixTag: string;
  randomBytes: number;
  ttlDays: number;
  permissions: string[];
  description: string;
}

const KEY_TYPES: KeyTypeSpec[] = [
  {
    type: 'sdk_api_key',
    prefixTag: 'sk',
    randomBytes: 32,
    ttlDays: 90,
    permissions: ['agents:execute','agents:read','documents:read','documents:write','research:read','usage:read','completions:write'],
    description: 'server-to-server backend calls — never expose to browsers',
  },
  {
    type: 'publishable_key',
    prefixTag: 'pk',
    randomBytes: 24,
    ttlDays: 365,
    permissions: ['completions:write','research:read'],
    description: 'browser/SPA — completions only — safe to ship in client bundles',
  },
  {
    type: 'signing_key',
    prefixTag: 'ss',
    randomBytes: 64,
    ttlDays: 180,
    permissions: ['requests:sign'],
    description: 'HMAC-SHA256 signs outgoing request bodies — never sent over the wire',
  },
  {
    type: 'webhook_secret',
    prefixTag: 'wh',
    randomBytes: 32,
    ttlDays: 3650,
    permissions: ['webhooks:receive'],
    description: 'verify incoming webhooks from NYV — never sent over the wire',
  },
];

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildRaw(short: string, kt: KeyTypeSpec): string {
  const random = crypto.randomBytes(kt.randomBytes).toString('hex');
  if (kt.type === 'sdk_api_key')     return `nyv_${liveTest}_sk_${short}_${random}`;
  if (kt.type === 'publishable_key') return `nyv_${liveTest}_pk_${short}_${random}`;
  if (kt.type === 'signing_key')     return `nyv_ss_${short}_${random}`;
  return `nyv_wh_${short}_${random}`;
}

interface IssuedKey { id: string; type: string; raw: string; prefix: string; rateLimit: number; expiresAt: string | null; permissions: string[]; }
interface PlatformOut { code: string; name: string; appId: string; tier: string; jurisdiction: string; env: string; keys: IssuedKey[]; }

async function mintForPlatform(p: Platform): Promise<PlatformOut | null> {
  const appCheck = await sql`SELECT id, app_type, tier FROM nv_sdk_applications WHERE id = ${p.appId} LIMIT 1`;
  if (appCheck.length === 0) {
    console.log(`▶ ${p.code.padEnd(11)}: SKIP (app row not found: ${p.appId} — run insert-app-rows first)\n`);
    return null;
  }

  console.log(`▶ ${p.name}`);
  console.log(`    app_id:       ${p.appId}`);
  console.log(`    tier:         ${p.tier} | jurisdiction: ${p.jurisdiction} | env: ${env}`);

  const out: PlatformOut = { code: p.code, name: p.name, appId: p.appId, tier: p.tier, jurisdiction: p.jurisdiction, env, keys: [] };

  const envShort = env === 'production' ? 'pr' : 'sb';
  for (const kt of KEY_TYPES) {
    const id = `nvkb-${p.short}-${kt.prefixTag}-${envShort}-001`;
    const raw = buildRaw(p.short, kt);
    const hash = hashKey(raw);
    const prefix = raw.substring(0, 16) + '...';
    const expiresAt = kt.ttlDays > 0 ? new Date(Date.now() + kt.ttlDays * 86400e3) : null;
    const rateLimit =
      kt.type === 'sdk_api_key' ? p.rateBase :
      kt.type === 'publishable_key' ? Math.floor(p.rateBase / 5) :
      100;

    await sql`DELETE FROM nv_api_keys WHERE id = ${id}`;
    await sql`
      INSERT INTO nv_api_keys (
        id, name, key_hash, key_prefix, app_id,
        permissions, rate_limit, expires_at, is_active, created_at
      ) VALUES (
        ${id},
        ${`${p.name} — ${kt.type} (${env})`},
        ${hash},
        ${prefix},
        ${p.appId},
        ${kt.permissions},
        ${rateLimit},
        ${expiresAt},
        true,
        NOW()
      )
    `;

    out.keys.push({
      id, type: kt.type, raw, prefix, rateLimit,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      permissions: kt.permissions,
    });

    const exp = expiresAt ? expiresAt.toISOString().slice(0, 10) : 'never';
    console.log(`      [${kt.type.padEnd(16)}] ${prefix}  rate=${rateLimit}/min  exp=${exp}`);
  }
  console.log('');
  return out;
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  NYV SDK Bundle Mint — env=${env} live/test=${liveTest}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const out: PlatformOut[] = [];
  for (const p of PLATFORMS) {
    const r = await mintForPlatform(p);
    if (r) out.push(r);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = process.env.NYV_BUNDLE_OUT_DIR
    ?? path.resolve(process.cwd(), '..', '.local', 'run');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `sdk-bundle-${env}-${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    minted_at: new Date().toISOString(),
    env,
    platform_count: out.length,
    key_types: KEY_TYPES.map(k => ({ type: k.type, ttlDays: k.ttlDays, permissions: k.permissions, description: k.description })),
    platforms: out,
  }, null, 2));
  fs.chmodSync(outFile, 0o600);

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  ${out.length} platforms × ${KEY_TYPES.length} keys = ${out.length * KEY_TYPES.length} keys minted`);
  console.log(`  Raw bundle JSON (CHMOD 600): ${outFile}`);
  console.log('  SECURITY: keys shown above are SHA-256 hashed in DB — file is the only');
  console.log('  recoverable record. Move to /opt/Nyayavigya/secrets/ and chmod 600.');
  console.log('══════════════════════════════════════════════════════════════════════');
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => sql.end());
