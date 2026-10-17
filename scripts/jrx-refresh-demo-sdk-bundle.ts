/**
 * nv-refresh-demo-sdk-bundle.ts (task-150, 2026-05-11)
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot canonical SDK-key bundle refresh for the 7 demo platforms.
 *
 * Why this exists
 *   The Session-15 EC2 smoke (docs/canonical/EC2-INTEGRATION-STATUS.md § C)
 *   showed the in-use NSP demo key (`nyv_live_sk_nsp_tUfo…`, 2026-05-01
 *   Practice-app row) carries only 3 scopes, so 3/7 gateway endpoints
 *   (`/usage`, `/cache/stats`, `/guardrails/stats`) return 403 even though
 *   the gateway is healthy. A newer 6-scope row (`…4fd3…`) exists in RDS
 *   but its plain text was lost — only the bcrypt hash survives.
 *
 *   This script ends that confusion: it mints ONE fresh raw key per app
 *   (NSP, NYM, NSI, NSA, NSM, NSPM, JRX), each with a scope set that
 *   covers all 7 documented `/api/jrx/gateway/*` read endpoints
 *   (info, health, agents, practice-areas, usage, cache/stats,
 *   guardrails/stats). Old keys for the same app are deactivated
 *   (`is_active=false`) — never deleted (audit chain).
 *
 *   Output is a single canonical handout file the demo team can paste
 *   into their .env / SSM / Replit Secrets:
 *
 *      .local/run/sdk-bundle-demo-<env>-<ISO>.json   (machine-readable)
 *      .local/run/sdk-bundle-demo-<env>-<ISO>.txt    (human handout)
 *
 *   Re-running ROTATES — old keys still in `sdk_app_api_keys` are flipped
 *   to `is_active=false` so they fail auth on the next request. New keys
 *   land active.
 *
 * Scope coverage (matches src/routes/jrx-sdk-gateway-routes.ts as of 2026-05-11)
 *   /info, /health, /agents, /practice-areas — no scope check
 *   /usage, /usage/tokens                    — `usage:read`
 *   /cache/stats                              — `usage:read`
 *   /guardrails/stats                         — `usage:read` OR `*`
 *
 * Usage
 *   # Replit dev DB
 *   NYV_PLATFORM_ENV=sandbox npx tsx scripts/jrx-refresh-demo-sdk-bundle.ts
 *
 *   # EC2 against RDS (from inside nyv-gateway container)
 *   docker exec nyv-gateway sh -c \
 *     'cd /app && NYV_PLATFORM_ENV=production npx tsx \
 *      /app/scripts/jrx-refresh-demo-sdk-bundle.ts'
 *
 * NV-DB-SCRIPT-001 compliant — uses makePgSql() (real pg.Pool + SSL).
 */

import { makePgSql } from './_pg-pool.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import type pg from 'pg';

dotenv.config();

const env = (process.env.NYV_PLATFORM_ENV ?? 'sandbox') as 'sandbox' | 'production';
const liveTest = env === 'production' ? 'live' : 'test';

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

/**
 * Canonical 7-platform demo bundle.
 *
 * Every entry includes `usage:read` so that the 7 documented gateway
 * read endpoints all return 200 — closing the Session-15 gap where NYM
 * lacked it (`['agents:read','agents:execute','consumer_intake:write']`)
 * and the NSP Practice-app row had only 3 scopes total.
 */
const PLATFORMS: PlatformDef[] = [
  {
    envVar: 'NYV_SDK_KEY_NSP',
    short: 'nsp',
    appName: 'Nyayasiddhi Professional™',
    appType: 'nyayasiddhi_professional',
    clientId: 'nyv_app_nsp_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
    rateLimitPerMin: 60,
    dailyTokens: 5_000_000,
    monthlyTokens: 100_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'NYV_SDK_KEY_NYM',
    short: 'nym',
    appName: 'Nyayamitra™ Citizen App',
    appType: 'nyayamitra',
    clientId: 'nyv_app_nym_v5',
    // task-150: added usage:read so /usage, /cache/stats, /guardrails/stats clear.
    // partner smoke (research/query) also requires research:read on all 7 SKUs.
    scopes: ['agents:read', 'agents:execute', 'consumer_intake:write', 'usage:read', 'research:read'],
    rateLimitPerMin: 100,
    dailyTokens: 1_000_000,
    monthlyTokens: 25_000_000,
    allowedAgents: ['nym-*', 'consumer-*'],
  },
  {
    envVar: 'NYV_SDK_KEY_NSI',
    short: 'nsi',
    appName: 'Nyayasiddhi Institutional™',
    appType: 'nyayasiddhi_institutional',
    clientId: 'nyv_app_nsi_v5',
    scopes: ['*'],
    rateLimitPerMin: 600,
    dailyTokens: 50_000_000,
    monthlyTokens: 1_000_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'NYV_SDK_KEY_NSA',
    short: 'nsa',
    appName: 'Nyayasiddhi Academy™',
    appType: 'nyayasiddhi_academy',
    clientId: 'nyv_app_nsa_v5',
    scopes: ['agents:read', 'agents:execute', 'research:read', 'usage:read'],
    rateLimitPerMin: 80,
    dailyTokens: 2_000_000,
    monthlyTokens: 50_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'NYV_SDK_KEY_NSM',
    short: 'nsm',
    appName: 'Nyayasiddhi Ministry™',
    appType: 'government',
    clientId: 'nyv_app_nsm_v5',
    scopes: ['*'],
    rateLimitPerMin: 200,
    dailyTokens: 20_000_000,
    monthlyTokens: 500_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'NYV_SDK_KEY_NSPM',
    short: 'nspm',
    appName: 'Nyayasiddhi Professional Mobile™',
    appType: 'nys_professional_mobile',
    clientId: 'nyv_app_nspm_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read', 'voice:read', 'voice:execute'],
    rateLimitPerMin: 60,
    dailyTokens: 3_000_000,
    monthlyTokens: 50_000_000,
    allowedAgents: ['*'],
  },
  {
    envVar: 'NYV_SDK_KEY_JRX',
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

function buildRawKey(short: string): string {
  // Same shape as nv-seed-sdk-keys.ts: nyv_<env>_sk_<short>_<48hex>
  const random = crypto.randomBytes(24).toString('hex');
  return `nyv_${liveTest}_sk_${short}_${random}`;
}

function rows<T = any>(r: any): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && Array.isArray(r.rows)) return r.rows as T[];
  return [];
}

interface MintedKey {
  envVar: string;
  short: string;
  appName: string;
  rawKey: string;
  keyPrefix: string;
  applicationId: number;
  apiKeyId: number;
  scopes: string[];
  rateLimitPerMin: number;
  deactivatedPriorKeys: number;
}

/**
 * Refresh ONE platform's demo key inside a single Postgres transaction.
 *
 * Atomicity guarantee: deactivate-prior + insert-new succeed together or
 * fail together. If anything throws the transaction is rolled back, so the
 * caller's previous active key is still live. Without this guarantee a
 * partial failure (deactivate succeeded, insert failed) would leave the
 * app with zero active keys and break the demo for that partner.
 */
async function refreshOne(client: pg.PoolClient, p: PlatformDef): Promise<MintedKey> {
  const rawKey = buildRawKey(p.short);
  const keyHash = sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 20);

  // sdk_applications requires client_secret_* not-null. Derive deterministically
  // from the client_id; never used for SDK-key auth (kept stable across rotations).
  const clientSecret = `nyv_secret_${p.short}_${sha256Hex(`${p.clientId}::stable-seed`).slice(0, 24)}`;
  const clientSecretHash = sha256Hex(clientSecret);
  const clientSecretPrefix = clientSecret.slice(0, 20);

  await client.query('BEGIN');
  try {
    // 1. Upsert sdk_applications (canonical table)
    await client.query(
      `INSERT INTO public.sdk_applications (
         app_name, app_type, description, client_id, client_secret_hash, client_secret_prefix,
         allowed_agents, llm_config, rate_limit_per_minute, daily_token_budget, monthly_token_budget,
         allowed_origins, jurisdiction, metadata, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14::jsonb,'active')
       ON CONFLICT (client_id) DO UPDATE SET
         app_name = EXCLUDED.app_name,
         app_type = EXCLUDED.app_type,
         rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
         daily_token_budget = EXCLUDED.daily_token_budget,
         monthly_token_budget = EXCLUDED.monthly_token_budget,
         status = 'active',
         updated_at = NOW()`,
      [
        p.appName, p.appType,
        'Demo bundle entry — refreshed by nv-refresh-demo-sdk-bundle.ts (task-150).',
        p.clientId, clientSecretHash, clientSecretPrefix,
        JSON.stringify(p.allowedAgents),
        JSON.stringify({ primary: 'auto', fallback: 'auto', budget_mode: 'balanced' }),
        p.rateLimitPerMin, p.dailyTokens, p.monthlyTokens,
        JSON.stringify([]),
        'IN',
        JSON.stringify({ short: p.short, sdk_version: '5.0.0', source: 'task-150-demo-bundle' }),
      ]
    );

    const appLookup = await client.query<{ id: number }>(
      `SELECT id FROM public.sdk_applications WHERE client_id = $1 LIMIT 1`,
      [p.clientId]
    );
    if (!appLookup.rows[0]) throw new Error(`application row not resolvable for ${p.clientId}`);
    const applicationId = appLookup.rows[0].id;

    // 2. Deactivate any prior active keys for this app (rotation, not delete)
    const priorDeactivate = await client.query<{ id: number }>(
      `UPDATE public.sdk_app_api_keys
          SET is_active = false
        WHERE application_id = $1
          AND is_active = true
        RETURNING id`,
      [applicationId]
    );
    const deactivatedPriorKeys = priorDeactivate.rows.length;

    // 3. Insert the fresh active key (in same TX — atomic with the deactivate)
    await client.query(
      `INSERT INTO public.sdk_app_api_keys (
         application_id, key_hash, key_prefix, name, scopes, is_active, expires_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,true,NULL)
       ON CONFLICT (key_hash) DO UPDATE SET
         application_id = EXCLUDED.application_id,
         key_prefix = EXCLUDED.key_prefix,
         name = EXCLUDED.name,
         scopes = EXCLUDED.scopes,
         is_active = true`,
      [
        applicationId, keyHash, keyPrefix,
        `${p.appName} — Demo Key (task-150 ${liveTest} ${new Date().toISOString().slice(0, 10)})`,
        JSON.stringify(p.scopes),
      ]
    );

    const keyLookup = await client.query<{ id: number }>(
      `SELECT id FROM public.sdk_app_api_keys WHERE key_hash = $1 LIMIT 1`,
      [keyHash]
    );
    if (!keyLookup.rows[0]) throw new Error('api_key row not resolvable after insert');
    const apiKeyId = keyLookup.rows[0].id;

    await client.query('COMMIT');

    return {
      envVar: p.envVar,
      short: p.short,
      appName: p.appName,
      rawKey,
      keyPrefix,
      applicationId,
      apiKeyId,
      scopes: p.scopes,
      rateLimitPerMin: p.rateLimitPerMin,
      deactivatedPriorKeys,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* swallow secondary error */ });
    throw err;
  }
}

void rows; // legacy helper kept for potential future use; intentionally unused.

async function main() {
  const sql = makePgSql();
  const startedAt = new Date();

  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log(`  NYV Demo SDK-Key Bundle Refresh — task-150 (${env} / ${liveTest})`);
  console.log(`  ${startedAt.toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const minted: MintedKey[] = [];
  const failed: Array<{ envVar: string; reason: string }> = [];
  for (const p of PLATFORMS) {
    const client = await sql.pool.connect();
    try {
      const m = await refreshOne(client, p);
      minted.push(m);
      console.log(
        `  ✓ ${m.envVar.padEnd(22)} app_id=${String(m.applicationId).padStart(3)}  ` +
        `key_id=${String(m.apiKeyId).padStart(4)}  prefix=${m.keyPrefix}…  ` +
        `scopes=${m.scopes.length === 1 && m.scopes[0] === '*' ? '[*]' : `[${m.scopes.length}]`}  ` +
        `(deactivated ${m.deactivatedPriorKeys} prior)`
      );
    } catch (err: any) {
      const reason = err?.message || String(err);
      failed.push({ envVar: p.envVar, reason });
      console.error(`  ✗ ${p.envVar}: ${reason} (TX rolled back — prior active key, if any, remains live)`);
    } finally {
      client.release();
    }
  }

  console.log('');
  console.log(`  ${minted.length}/${PLATFORMS.length} keys minted.`);
  if (failed.length > 0) {
    console.error(`  ${failed.length} platform(s) FAILED:`);
    for (const f of failed) console.error(`    - ${f.envVar}: ${f.reason}`);
  }

  // Emit canonical bundle files. Plain-text outputs are written 0600.
  const outDir = process.env.NYV_BUNDLE_OUT_DIR
    ?? path.resolve(process.cwd(), '.local', 'run');
  fs.mkdirSync(outDir, { recursive: true });

  const ts = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `sdk-bundle-demo-${env}-${ts}.json`);
  const txtPath = path.join(outDir, `sdk-bundle-demo-${env}-${ts}.txt`);

  const bundle = {
    schema: 'nv.sdk-bundle.demo/v1',
    generatedAt: startedAt.toISOString(),
    env,
    liveOrTest: liveTest,
    sourceScript: 'scripts/jrx-refresh-demo-sdk-bundle.ts',
    task: 'task-150',
    notes: [
      'Plain-text keys are shown ONCE here. Store in SSM /nyv/<env>/NYV_SDK_KEY_<PLAT> as SecureString.',
      'Re-running this script ROTATES — every call deactivates prior keys for the same app.',
      'Scopes are sufficient for all 7 documented gateway endpoints (info/health/agents/practice-areas/usage/cache/stats/guardrails/stats).',
      'Supersedes /opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt (stale — keys never seeded on RDS).',
    ],
    platforms: minted,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + '\n');
  try { fs.chmodSync(jsonPath, 0o600); } catch { /* non-fatal on Windows */ }

  const handoutLines: string[] = [];
  handoutLines.push('# Nyayavigya — Demo SDK-Key Bundle (task-150)');
  handoutLines.push(`# Generated:  ${startedAt.toISOString()}`);
  handoutLines.push(`# Env:        ${env} (${liveTest})`);
  handoutLines.push(`# Source:     scripts/jrx-refresh-demo-sdk-bundle.ts`);
  handoutLines.push('# ─────────────────────────────────────────────────────────────');
  handoutLines.push('# Plain-text keys appear ONCE. Paste into:');
  handoutLines.push('#   • Replit Secrets (dev)');
  handoutLines.push('#   • AWS SSM /nyv/<env>/NYV_SDK_KEY_<PLAT> as SecureString (prod)');
  handoutLines.push('#   • /opt/Nyayavigya/secrets/.env.production on EC2 (prod)');
  handoutLines.push('# Rotate by re-running this script — old keys flip to is_active=false.');
  handoutLines.push('');
  for (const m of minted) {
    handoutLines.push(`# ${m.appName}`);
    handoutLines.push(`#   app_id=${m.applicationId}  key_id=${m.apiKeyId}  rate_limit=${m.rateLimitPerMin}/min`);
    handoutLines.push(`#   scopes=${JSON.stringify(m.scopes)}`);
    handoutLines.push(`${m.envVar}=${m.rawKey}`);
    handoutLines.push('');
  }
  fs.writeFileSync(txtPath, handoutLines.join('\n'));
  try { fs.chmodSync(txtPath, 0o600); } catch { /* non-fatal on Windows */ }

  console.log('');
  console.log(`  Wrote bundle (mode 0600):`);
  console.log(`    ${jsonPath}`);
  console.log(`    ${txtPath}`);
  console.log('');
  console.log('  NEXT STEPS (operator):');
  console.log('    1. Copy keys into Replit Secrets / AWS SSM / .env.production.');
  console.log('    2. Restart consumers so they pick up the new keys.');
  console.log('    3. Smoke (replace NSP key):');
  console.log('       for p in /api/jrx/gateway/{info,health,agents,practice-areas,usage,cache/stats,guardrails/stats}; do');
  console.log('         curl -sS -o /dev/null -w "[%{http_code}] $p\\n" \\');
  console.log('           -H "X-API-Key: $NYV_SDK_KEY_NSP" "https://api.nyayasiddhi.online$p"');
  console.log('       done');
  console.log('    4. Securely delete the .txt + .json bundle files after use.');
  console.log('══════════════════════════════════════════════════════════════════════════════');

  await sql.end();

  // Fail-fast: only signal SUCCESS when every platform got a fresh key.
  // Operators wiring this into a deploy / cron expect a non-zero exit on
  // partial failure so they don't blindly push a half-baked bundle to SSM.
  if (minted.length !== PLATFORMS.length) {
    console.error(
      `\nFATAL: ${PLATFORMS.length - minted.length}/${PLATFORMS.length} platform(s) failed; ` +
      `bundle is INCOMPLETE. Do NOT distribute the .txt/.json files above.`
    );
    process.exit(2);
  }
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
