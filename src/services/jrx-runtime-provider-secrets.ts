/**
 * NV-PROVIDER-SECRETS-001 — Runtime overlay for LLM / provider API keys.
 * Stored in Redis (nv:provider-secrets:*) so dashboard can hot-apply without
 * CREATE TABLE privileges on RDS. resolveProviderSecret() prefers overlay → env.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('runtime-provider-secrets');
const REDIS_HASH = 'nv:provider-secrets:v1';
const REDIS_META = 'nv:provider-secrets:meta:v1';

export const PROVIDER_SECRET_CATALOG: Array<{
  providerId: string;
  label: string;
  envNames: string[];
  description: string;
}> = [
  { providerId: 'openai', label: 'OpenAI', envNames: ['OPENAI_API_KEY'], description: 'OpenAI GPT / embeddings' },
  { providerId: 'anthropic', label: 'Anthropic', envNames: ['ANTHROPIC_API_KEY'], description: 'Claude (direct API)' },
  { providerId: 'google', label: 'Google Gemini', envNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEYS'], description: 'Gemini chat + embeddings (comma-pool supported via GEMINI_API_KEYS)' },
  { providerId: 'openrouter', label: 'OpenRouter', envNames: ['OPENROUTER_API_KEY'], description: 'OpenRouter multi-model gateway' },
  { providerId: 'bedrock', label: 'AWS Bedrock', envNames: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_BEARER_TOKEN_BEDROCK_US_EAST_1', 'AWS_BEARER_TOKEN_BEDROCK_AP_SOUTH_1', 'BEDROCK_API_KEY'], description: 'Bedrock bearer tokens (regional)' },
  { providerId: 'serper', label: 'Serper (Google SERP)', envNames: ['SERPER_API_KEY'], description: 'Serper.dev web search API' },
  { providerId: 'groq', label: 'Groq', envNames: ['GROQ_API_KEY'], description: 'Groq fast inference' },
  { providerId: 'together', label: 'Together AI', envNames: ['TOGETHER_API_KEY'], description: 'Together open models' },
  { providerId: 'deepseek', label: 'DeepSeek', envNames: ['DEEPSEEK_API_KEY'], description: 'DeepSeek API' },
  { providerId: 'mistral', label: 'Mistral', envNames: ['MISTRAL_API_KEY'], description: 'Mistral API' },
  { providerId: 'sarvam', label: 'Sarvam AI', envNames: ['SARVAM_API_KEY'], description: 'Indian languages TTS/STT' },
  { providerId: 'nys_machine', label: 'NYS Machine Key', envNames: ['JRX_ECOSYSTEM_KNOWLEDGE_API_KEY'], description: 'NyayaSearch knowledge-plane machine auth' },
  { providerId: 'nys_case_api', label: 'NYS Case API Key', envNames: ['JRX_ECOSYSTEM_CASE_API_KEY'], description: 'JRX-Search case-api (nysapi) X-API-Key for CNR resolve' },
];

interface OverlayRow {
  providerId: string;
  envName: string;
  configured: boolean;
  last4: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  reason: string | null;
}

interface MetaRow {
  providerId: string;
  envName: string;
  last4: string;
  updatedBy?: string;
  updatedAt: string;
  reason?: string;
}

const cache = new Map<string, string>(); // envName -> plaintext
const metaCache = new Map<string, MetaRow>(); // `${providerId}:${envName}`
let booted = false;
let bootInflight: Promise<void> | null = null;
let redisClient: any = null;

function encryptionKey(): Buffer {
  const raw =
    process.env.JRX_SECRETS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    'jrx-dev-secrets-key-change-me';
  return createHash('sha256').update(String(raw)).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(blob: string): string {
  const [ver, ivB64, tagB64, dataB64] = String(blob).split(':');
  if (ver !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function fieldKey(providerId: string, envName: string): string {
  return `${providerId}::${envName}`;
}

async function getRedis(): Promise<any | null> {
  if (redisClient) return redisClient;
  try {
    const { resolveRedisTcpUrl } = await import('../utils/redis-tcp-url.js');
    const { Redis } = await import('ioredis');
    const tcp = resolveRedisTcpUrl();
    const url =
      (tcp.enabled && tcp.url ? tcp.url : null)
      || process.env.REDIS_URL
      || 'redis://jrx-redis:6379';
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
    });
    redisClient.on('error', () => { /* suppress noisy reconnect logs */ });
    // Wait briefly for ready
    await new Promise<void>((resolve) => {
      if (redisClient.status === 'ready') return resolve();
      const t = setTimeout(() => resolve(), 3000);
      redisClient.once('ready', () => { clearTimeout(t); resolve(); });
    });
    return redisClient;
  } catch (e: any) {
    logger.warn('provider_secrets_redis_unavailable', { error: e?.message });
    return null;
  }
}

export async function bootProviderSecretsOverlay(): Promise<void> {
  if (booted) return;
  if (bootInflight) return bootInflight;
  bootInflight = (async () => {
    try {
      const r = await getRedis();
      if (!r) {
        booted = true;
        logger.info('provider_secrets_overlay_ready', { backend: 'memory-env-only', count: 0 });
        return;
      }
      const all = await r.hgetall(REDIS_HASH);
      const metaRaw = await r.hgetall(REDIS_META);
      for (const [fk, ciphertext] of Object.entries(all || {})) {
        const [providerId, envName] = String(fk).split('::');
        if (!providerId || !envName) continue;
        try {
          const plain = decrypt(String(ciphertext));
          cache.set(envName, plain);
          process.env[envName] = plain;
          const meta = metaRaw?.[fk] ? JSON.parse(String(metaRaw[fk])) as MetaRow : null;
          if (meta) metaCache.set(fk, meta);
        } catch (e: any) {
          logger.warn('provider_secret_decrypt_failed', { providerId, envName, error: e?.message });
        }
      }
      booted = true;
      logger.info('provider_secrets_overlay_ready', { backend: 'redis', count: cache.size });
    } catch (e: any) {
      logger.warn('provider_secrets_boot_failed', { error: e?.message || String(e) });
      booted = true;
    } finally {
      bootInflight = null;
    }
  })();
  return bootInflight;
}

export function resolveProviderSecret(...envNames: string[]): string | undefined {
  for (const name of envNames) {
    const fromCache = cache.get(name);
    if (fromCache) return fromCache;
    const fromEnv = process.env[name];
    if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  }
  return undefined;
}

export async function listProviderSecretStatus(): Promise<OverlayRow[]> {
  await bootProviderSecretsOverlay();
  const out: OverlayRow[] = [];
  for (const entry of PROVIDER_SECRET_CATALOG) {
    for (const envName of entry.envNames) {
      const fk = fieldKey(entry.providerId, envName);
      const meta = metaCache.get(fk);
      const envSet = !!(process.env[envName] && String(process.env[envName]).trim());
      const overlaySet = cache.has(envName) || !!meta;
      out.push({
        providerId: entry.providerId,
        envName,
        configured: overlaySet || envSet,
        last4: meta?.last4 || (envSet ? 'env' : null),
        updatedBy: meta?.updatedBy || null,
        updatedAt: meta?.updatedAt || null,
        reason: meta?.reason || (envSet && !overlaySet ? 'from_environment' : null),
      });
    }
  }
  return out;
}

export async function upsertProviderSecret(opts: {
  providerId: string;
  envName: string;
  value: string;
  updatedBy?: string;
  reason?: string;
}): Promise<{ ok: true; last4: string }> {
  await bootProviderSecretsOverlay();
  const catalog = PROVIDER_SECRET_CATALOG.find((c) => c.providerId === opts.providerId);
  if (!catalog || !catalog.envNames.includes(opts.envName)) {
    throw new Error(`Unknown provider/env: ${opts.providerId}/${opts.envName}`);
  }
  const value = String(opts.value || '').trim();
  if (value.length < 8) throw new Error('Secret value too short');
  const ciphertext = encrypt(value);
  const last4 = value.slice(-4);
  const fk = fieldKey(opts.providerId, opts.envName);
  const meta: MetaRow = {
    providerId: opts.providerId,
    envName: opts.envName,
    last4,
    updatedBy: opts.updatedBy,
    updatedAt: new Date().toISOString(),
    reason: opts.reason,
  };
  const r = await getRedis();
  if (r) {
    await r.hset(REDIS_HASH, fk, ciphertext);
    await r.hset(REDIS_META, fk, JSON.stringify(meta));
  }
  cache.set(opts.envName, value);
  metaCache.set(fk, meta);
  process.env[opts.envName] = value;
  logger.info('provider_secret_upserted', {
    providerId: opts.providerId,
    envName: opts.envName,
    updatedBy: opts.updatedBy,
    backend: r ? 'redis' : 'memory',
  });
  return { ok: true, last4 };
}

export async function clearProviderSecret(opts: {
  providerId: string;
  envName: string;
  updatedBy?: string;
}): Promise<void> {
  await bootProviderSecretsOverlay();
  const fk = fieldKey(opts.providerId, opts.envName);
  const r = await getRedis();
  if (r) {
    await r.hdel(REDIS_HASH, fk);
    await r.hdel(REDIS_META, fk);
  }
  cache.delete(opts.envName);
  metaCache.delete(fk);
  logger.info('provider_secret_cleared', {
    providerId: opts.providerId,
    envName: opts.envName,
    updatedBy: opts.updatedBy,
  });
}
