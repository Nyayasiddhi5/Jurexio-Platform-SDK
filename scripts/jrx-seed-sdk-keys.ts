import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_api_keys': [
    'id', 'name', 'key_hash', 'key_prefix', 'app_id',
    'permissions', 'rate_limit', 'created_at',
  ],
} as const;

const PLATFORMS = [
  {
    code: 'jurexio-citizen',
    short: 'nym',
    name: 'Jurexio Citizen Citizen App',
    appId: 'nvsdkapp-demo-nm-001',
    tier: 'plus',
    permissions: ['agents:read', 'agents:execute', 'documents:read'],
    rateLimit: 100,
  },
  {
    code: 'nys-professional',
    short: 'nsp',
    name: 'Jurexio Professional™',
    appId: 'nvsdkapp-demo-nsp-001',
    tier: 'pro',
    permissions: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
    rateLimit: 60,
  },
  {
    code: 'nys-institutional',
    short: 'nsi',
    name: 'Jurexio Institutional™',
    appId: 'nvsdkapp-demo-nyi-001',
    tier: 'enterprise',
    permissions: ['*'],
    rateLimit: 600,
  },
  {
    code: 'nys-academy',
    short: 'nsa',
    name: 'Jurexio Academy™',
    appId: 'nvsdkapp-demo-academy-001',
    tier: 'pro',
    permissions: ['agents:read', 'agents:execute', 'documents:read', 'research:read'],
    rateLimit: 80,
  },
  {
    code: 'nys-ministry',
    short: 'nsm',
    name: 'Jurexio Ministry™',
    appId: 'nvsdkapp-demo-ministry-001',
    tier: 'government',
    permissions: ['*'],
    rateLimit: 200,
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

async function seedDemoKeys() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Jurexio SDK v5.0.0 — Demo API Key Generation');
  console.log('  Platform 3.1.2 | All 5 Jurexio Ecosystem Apps');
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  await assertColumns(sql, './jrx-seed-sdk-keys', REQUIRED_COLUMNS);

  const generatedKeys: Array<{
    platform: string;
    name: string;
    liveKey: string;
    testKey: string;
    tier: string;
  }> = [];

  for (const platform of PLATFORMS) {
    const liveKey = generateKey('nyv_live_sk_', platform.short);
    const testKey = generateKey('nyv_test_sk_', platform.short);

    const liveKeyHash = hashKey(liveKey);
    const testKeyHash = hashKey(testKey);
    const liveKeyPrefix = getPrefix(liveKey);
    const testKeyPrefix = getPrefix(testKey);

    const liveKeyId = `nvkey-demo-${platform.short}-live-001`;
    const testKeyId = `nvkey-demo-${platform.short}-test-001`;

    await sql`DELETE FROM nv_api_keys WHERE id = ${liveKeyId}`;
    await sql`
      INSERT INTO nv_api_keys (
        id, name, key_hash, key_prefix, app_id,
        permissions, rate_limit, created_at
      ) VALUES (
        ${liveKeyId},
        ${`${platform.name} — Live Demo Key (SDK v5.0.0)`},
        ${liveKeyHash},
        ${liveKeyPrefix},
        ${platform.appId},
        ${platform.permissions},
        ${platform.rateLimit},
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
        ${`${platform.name} — Sandbox Demo Key (SDK v5.0.0)`},
        ${testKeyHash},
        ${testKeyPrefix},
        ${platform.appId},
        ${platform.permissions},
        ${platform.rateLimit},
        NOW()
      )
    `;

    generatedKeys.push({
      platform: platform.code,
      name: platform.name,
      liveKey,
      testKey,
      tier: platform.tier,
    });

    console.log(`  ✓ ${platform.name} [${platform.tier}]`);
    console.log(`    Live: ${liveKey}`);
    console.log(`    Test: ${testKey}`);
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════');
  console.log('  SDK v5.0.0 Demo Keys Summary');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Platform                      | Tier       | Live Key Prefix       | Test Key Prefix');
  console.log('  ------------------------------|------------|----------------------|----------------------');
  for (const k of generatedKeys) {
    const name = k.name.padEnd(30);
    const tier = k.tier.padEnd(10);
    const lp = k.liveKey.substring(0, 24) + '...';
    const tp = k.testKey.substring(0, 24) + '...';
    console.log(`  ${name} | ${tier} | ${lp} | ${tp}`);
  }
  console.log('');
  console.log('  SECURITY: These keys are shown ONCE. Store them securely.');
  console.log('  Keys are SHA-256 hashed before database storage.');
  console.log('  Use test keys for sandbox/development; live keys for production.');
  console.log('');
  console.log(`  ✓ ${generatedKeys.length * 2} demo API keys generated (${generatedKeys.length} live + ${generatedKeys.length} test)`);
  console.log('══════════════════════════════════════════════════════');

  return generatedKeys;
}

seedDemoKeys().catch(console.error).finally(() => sql.end());
