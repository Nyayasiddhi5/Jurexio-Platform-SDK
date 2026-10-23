import crypto from 'crypto';
import type { Request } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('platform-uat-bypass');

const PLATFORM_KEY_ENV_NAMES = [
  'JRX_SDK_KEY_NSP',
  'JRX_SDK_KEY_NSPM',
  'JRX_SDK_KEY_NSI',
  'JRX_SDK_KEY_NSA',
  'JRX_SDK_KEY_NSM',
  'JRX_SDK_KEY_NYM',
  'JRX_SDK_KEY_JRX',
  'JRX_SDK_KEY_SHARED',
] as const;

export const NV_PLATFORM_UAT_BYPASS = process.env.NV_PLATFORM_UAT_BYPASS === '1';

const fingerprintSet: Set<string> = new Set();
const fingerprintToPlatform: Map<string, string> = new Map();

function fingerprint(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

if (NV_PLATFORM_UAT_BYPASS) {
  for (const envName of PLATFORM_KEY_ENV_NAMES) {
    const value = process.env[envName];
    if (typeof value === 'string' && value.trim().length > 0) {
      const fp = fingerprint(value.trim());
      fingerprintSet.add(fp);
      fingerprintToPlatform.set(fp, envName.replace('JRX_SDK_KEY_', ''));
    }
  }
  logger.warn(
    `NV_PLATFORM_UAT_BYPASS=1 ENABLED — rate-limit + scope-check bypass active for ${fingerprintSet.size}/${PLATFORM_KEY_ENV_NAMES.length} internal Jurexio platform keys. Auth, audit, RLS, PII redaction, and guardrails remain enforced.`
  );
}

export function isPlatformUatRequest(req: Request | undefined): boolean {
  if (!NV_PLATFORM_UAT_BYPASS || !req) return false;
  const xApiKey = req.headers?.['x-api-key'];
  let key: string | undefined;
  if (typeof xApiKey === 'string') {
    key = xApiKey.trim();
  } else {
    const auth = req.headers?.['authorization'];
    if (typeof auth === 'string') {
      const m = auth.match(/^Bearer\s+(\S+)$/i);
      if (m) key = m[1];
    }
  }
  if (!key) return false;
  const fp = fingerprint(key);
  return fingerprintSet.has(fp);
}

export function isPlatformUatKey(rawKey: string | null | undefined): boolean {
  if (!NV_PLATFORM_UAT_BYPASS || !rawKey) return false;
  return fingerprintSet.has(fingerprint(rawKey.trim()));
}

export function platformUatLabel(rawKey: string | null | undefined): string | null {
  if (!NV_PLATFORM_UAT_BYPASS || !rawKey) return null;
  return fingerprintToPlatform.get(fingerprint(rawKey.trim())) || null;
}

export function platformUatStatus(): { enabled: boolean; fingerprintCount: number; envExpected: number } {
  return {
    enabled: NV_PLATFORM_UAT_BYPASS,
    fingerprintCount: fingerprintSet.size,
    envExpected: PLATFORM_KEY_ENV_NAMES.length,
  };
}
