/**
 * NV-ENV-KEY-SYNC-001 — Mirror existing NYV_SDK_KEY_* env values into
 * public.sdk_applications + public.sdk_app_api_keys (hash only, never log values).
 * Does NOT mint new keys — reads canonical secrets already on the host.
 */
import crypto from 'crypto';
import { pool as _rawPool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';

const pool = lazyRequire(() => _rawPool, 'pool');
const logger = createLogger('env-sdk-key-sync');

let _synced = false;

interface PlatformEnvDef {
  envVar: string;
  short: string;
  appName: string;
  appType: string;
  clientId: string;
  scopes: string[];
  rateLimitPerMin: number;
}

const PLATFORM_ENV_DEFS: PlatformEnvDef[] = [
  {
    envVar: 'NYV_SDK_KEY_NSP',
    short: 'nsp',
    appName: 'Jurexio Professional™',
    appType: 'nyayasiddhi_professional',
    clientId: 'nyv_app_nsp_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
    rateLimitPerMin: 60,
  },
  {
    envVar: 'NYV_SDK_KEY_NYM',
    short: 'nym',
    appName: 'Nyayamitra™ Citizen App',
    appType: 'nyayamitra',
    clientId: 'nyv_app_nym_v5',
    scopes: ['agents:read', 'agents:execute', 'consumer_intake:write', 'usage:read', 'research:read'],
    rateLimitPerMin: 100,
  },
  {
    envVar: 'NYV_SDK_KEY_NSI',
    short: 'nsi',
    appName: 'Jurexio Institutional™',
    appType: 'nyayasiddhi_institutional',
    clientId: 'nyv_app_nsi_v5',
    scopes: ['*'],
    rateLimitPerMin: 600,
  },
  {
    envVar: 'NYV_SDK_KEY_NSA',
    short: 'nsa',
    appName: 'Jurexio Academy™',
    appType: 'nyayasiddhi_academy',
    clientId: 'nyv_app_nsa_v5',
    scopes: ['agents:read', 'agents:execute', 'research:read', 'usage:read'],
    rateLimitPerMin: 80,
  },
  {
    envVar: 'NYV_SDK_KEY_NSM',
    short: 'nsm',
    appName: 'Jurexio Ministry™',
    appType: 'government',
    clientId: 'nyv_app_nsm_v5',
    scopes: ['*'],
    rateLimitPerMin: 200,
  },
  {
    envVar: 'NYV_SDK_KEY_NSPM',
    short: 'nspm',
    appName: 'Jurexio Professional Mobile™',
    appType: 'nys_professional_mobile',
    clientId: 'nyv_app_nspm_v5',
    scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read', 'voice:read', 'voice:execute'],
    rateLimitPerMin: 60,
  },
  {
    envVar: 'NYV_SDK_KEY_JRX',
    short: 'jrx',
    appName: 'JurisX™',
    appType: 'jurisx',
    clientId: 'nyv_app_jrx_v5',
    scopes: ['*'],
    rateLimitPerMin: 400,
  },
];

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function keyMetadata(rawKey: string): { keyHash: string; keyPrefix: string; last4: string } {
  const keyHash = sha256Hex(rawKey);
  const keyPrefix = rawKey.length > 20 ? rawKey.slice(0, 20) : rawKey;
  const last4 = rawKey.length >= 4 ? rawKey.slice(-4) : '****';
  return { keyHash, keyPrefix, last4 };
}

/** Idempotent sync — returns counts only (no secret values). */
export async function syncEnvSdkKeysToDb(): Promise<{ synced: number; skipped: number; failed: number }> {
  if (!pool) return { synced: 0, skipped: PLATFORM_ENV_DEFS.length, failed: 0 };

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of PLATFORM_ENV_DEFS) {
    const rawKey = (process.env[p.envVar] ?? '').trim().replace(/^["']|["']$/g, '');
    if (!rawKey || rawKey.length < 16) {
      skipped++;
      continue;
    }

    const { keyHash, keyPrefix, last4 } = keyMetadata(rawKey);
    const clientSecret = `nyv_secret_${p.short}_${sha256Hex(`${p.clientId}::stable-seed`).slice(0, 24)}`;
    const clientSecretHash = sha256Hex(clientSecret);
    const clientSecretPrefix = clientSecret.slice(0, 20);

    try {
      await pool.query(
        `INSERT INTO public.sdk_applications (
           app_name, app_type, description, client_id, client_secret_hash, client_secret_prefix,
           allowed_agents, llm_config, rate_limit_per_minute, daily_token_budget, monthly_token_budget,
           allowed_origins, jurisdiction, metadata, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14::jsonb,'active')
         ON CONFLICT (client_id) DO UPDATE SET
           app_name = EXCLUDED.app_name,
           app_type = EXCLUDED.app_type,
           rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
           metadata = EXCLUDED.metadata,
           status = 'active',
           updated_at = NOW()`,
        [
          p.appName,
          p.appType,
          `Env-synced from ${p.envVar} (NV-ENV-KEY-SYNC-001). Prefix …${last4}`,
          p.clientId,
          clientSecretHash,
          clientSecretPrefix,
          JSON.stringify(['*']),
          JSON.stringify({ primary: 'auto', fallback: 'auto', budget_mode: 'balanced' }),
          p.rateLimitPerMin,
          5_000_000,
          100_000_000,
          JSON.stringify([]),
          'IN',
          JSON.stringify({ short: p.short, envVar: p.envVar, keyLast4: last4, source: 'env-sync' }),
        ],
      );

      const appLookup = await pool.query<{ id: number }>(
        `SELECT id FROM public.sdk_applications WHERE client_id = $1 LIMIT 1`,
        [p.clientId],
      );
      const applicationId = appLookup.rows[0]?.id;
      if (!applicationId) {
        failed++;
        continue;
      }

      await pool.query(
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
          applicationId,
          keyHash,
          keyPrefix,
          `${p.appName} — env sync (…${last4}) [${p.envVar}]`,
          JSON.stringify(p.scopes),
        ],
      );
      synced++;
    } catch (err: unknown) {
      failed++;
      logger.warn('env_key_sync_row_failed', {
        envVar: p.envVar,
        clientId: p.clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('env_sdk_key_sync_complete', { synced, skipped, failed });
  return { synced, skipped, failed };
}

export const nvEnvSdkKeySync = {
  async bootstrap(): Promise<{ synced: number; skipped: number; failed: number }> {
    if (_synced) return { synced: 0, skipped: 0, failed: 0 };
    const result = await syncEnvSdkKeysToDb();
    _synced = true;
    return result;
  },
};

export default nvEnvSdkKeySync;
