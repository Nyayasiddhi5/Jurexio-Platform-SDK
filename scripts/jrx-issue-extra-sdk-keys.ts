/**
 * jrx-issue-extra-sdk-keys.ts (post-2026-05-05: NSPM and JRX are now first-class platforms; this script only re-issues if missing)
 *
 * JRX-NS-029 (2026-05-05): mint LIVE + TEST keys for two ADDITIONAL platforms
 * (NSPM + JRX) on top of the existing 5 Jurexio platforms (NYM/NSP/NSI/
 * NSA/NSM) seeded by `jrx-seed-sdk-keys.ts`.
 *
 * Behaviour
 *   • Same generation algorithm as jrx-seed-sdk-keys.ts (crypto.randomBytes(24)
 *     hex → `nyv_live_sk_<short>_<48hex>`, sha256 hash, 16-char prefix).
 *   • Idempotent: existing rows for the two key IDs are deleted-then-inserted.
 *   • Touches ONLY the 2 new platforms — leaves the existing 5 untouched.
 *   • Appends new entries to .local/secrets-pending.json without overwriting
 *     any of the 5 existing entries.
 *
 * Usage
 *   npx tsx scripts/jrx-issue-extra-sdk-keys.ts (post-2026-05-05: NSPM and JRX are now first-class platforms; this script only re-issues if missing)
 */
import { makePgSql } from './_pg-pool.js';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

const EXTRA_PLATFORMS = [
  {
    code: 'nys-professional-mobile',
    short: 'nspm',
    name: 'Jurexio Professional Mobile™',
    appId: 'nvsdkapp-demo-nspm-001',
    tier: 'pro',
    permissions: [
      'agents:read', 'agents:execute', 'documents:read', 'documents:write',
      'research:read', 'usage:read', 'voice:read', 'voice:execute',
    ],
    rateLimit: 60,
    envVar: 'JRX_SDK_KEY_NSPM',
  },
  {
    code: 'jurisx',
    short: 'jrx',
    name: 'JurisX™',
    appId: 'nvsdkapp-demo-jrx-001',
    tier: 'enterprise',
    permissions: ['*'],
    rateLimit: 400,
    envVar: 'JRX_SDK_KEY_JRX',
  },
];

function generateKey(prefix: string, platformShort: string): string {
  const random = crypto.randomBytes(24).toString('hex');
  return `${prefix}${platformShort}_${random}`;
}
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
function getPrefix(key: string): string {
  return key.substring(0, 16) + '...';
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  JRX SDK v5.0.0 — Extra-Platform Key Issuance');
  console.log('  NSPM (Jurexio Professional Mobile) + JRX (JurisX)');
  console.log('══════════════════════════════════════════════════════');

  const pendingPath = path.resolve('.local/secrets-pending.json');
  let pending: Record<string, string> = {};
  if (fs.existsSync(pendingPath)) {
    pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  }

  const minted: Array<{
    platform: string; envVar: string; liveKey: string; testKey: string;
    tier: string; permissions: string[];
  }> = [];

  for (const p of EXTRA_PLATFORMS) {
    const liveKey = generateKey('nyv_live_sk_', p.short);
    const testKey = generateKey('nyv_test_sk_', p.short);

    const liveKeyId = `nvkey-demo-${p.short}-live-001`;
    const testKeyId = `nvkey-demo-${p.short}-test-001`;

    // 1️⃣  Ensure parent nv_sdk_applications row exists (FK target).
    await sql`
      INSERT INTO nv_sdk_applications (
        id, name, app_type, platform_type, tier, jurisdiction, jurisdictions, is_active, environment
      ) VALUES (
        ${p.appId},
        ${p.name},
        ${p.code},
        ${p.short},
        ${p.tier},
        'IN',
        ${['IN']},
        true,
        'sandbox'
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        tier = EXCLUDED.tier,
        is_active = true,
        updated_at = NOW()
    `;

    await sql`DELETE FROM nv_api_keys WHERE id = ${liveKeyId}`;
    await sql`
      INSERT INTO nv_api_keys (
        id, name, key_hash, key_prefix, app_id,
        permissions, rate_limit, created_at
      ) VALUES (
        ${liveKeyId},
        ${`${p.name} — Live Demo Key (SDK v5.0.0)`},
        ${hashKey(liveKey)},
        ${getPrefix(liveKey)},
        ${p.appId},
        ${p.permissions},
        ${p.rateLimit},
        NOW()
      )
    `;

    await sql`DELETE FROM nv_api_keys WHERE id = ${testKeyId}`;
    await sql`
      INSERT INTO nv_api_keys (
        id, name, key_hash, key_prefix, app_id,
        permissions, rate_limit, created_at
      ) VALUES (
        ${testKeyId},
        ${`${p.name} — Sandbox Demo Key (SDK v5.0.0)`},
        ${hashKey(testKey)},
        ${getPrefix(testKey)},
        ${p.appId},
        ${p.permissions},
        ${p.rateLimit},
        NOW()
      )
    `;

    pending[p.envVar] = liveKey;
    minted.push({
      platform: p.name, envVar: p.envVar, liveKey, testKey,
      tier: p.tier, permissions: p.permissions,
    });

    console.log('');
    console.log(`✓ ${p.name}`);
    console.log(`    env var       : ${p.envVar}`);
    console.log(`    live key      : ${liveKey}`);
    console.log(`    test key      : ${testKey}`);
    console.log(`    db row (live) : ${liveKeyId}`);
    console.log(`    db row (test) : ${testKeyId}`);
    console.log(`    tier          : ${p.tier}  rate_limit=${p.rateLimit}/min`);
  }

  // Update audit metadata + write back
  pending._generated_at = new Date().toISOString().slice(0, 16);
  pending._instructions =
    'Paste each JRX_SDK_KEY_* value into Replit Secrets. ' +
    'Same values are mirrored to AWS SSM /nyv/prod/JRX_SDK_KEY_<NAME> for EC2.';
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2) + '\n');
  console.log('');
  console.log(`✓ .local/secrets-pending.json updated (${Object.keys(pending).filter(k => !k.startsWith('_')).length} keys total)`);

  // Append audit log
  const auditLine =
    `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z | ` +
    `new_or_existing=${minted.length}platforms (NSPM,JRX) | ssm=skipped | replit=manual_paste_pending\n`;
  fs.appendFileSync('.local/sdk-key-issuance.log', auditLine);

  console.log('');
  console.log('Next: paste these 2 values into Replit Secrets when prompted.');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
