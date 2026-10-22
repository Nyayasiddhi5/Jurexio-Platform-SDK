/**
 * JRX-ENV-BOOTSTRAP-001 — Jurexio Enterprise Platform env (JRX_* SSoT).
 * Maps JRX_* → legacy internal names at process start until Phase 2 rename completes.
 * Jurexio deploy templates must use JRX_* only; JRX_* is never required in .env examples.
 */
const PAIRS: Array<[jrx: string, legacy: string]> = [
  ['JRX_PORT_GATEWAY', 'JRX_PORT_GATEWAY'],
  ['JRX_PORT_ORCH', 'JRX_PORT_ORCH'],
  ['JRX_PUBLIC_API_URL', 'JRX_PUBLIC_API_URL'],
  ['JRX_DATABASE_URL', 'JRX_DATABASE_URL'],
  ['JRX_DATABASE_URL', 'DATABASE_URL'],
  ['JRX_REDIS_TCP_URL', 'JRX_REDIS_TCP_URL'],
  ['JRX_REDIS_TCP_URL', 'REDIS_URL'],
  ['JRX_JWT_SECRET', 'JRX_JWT_SECRET'],
  ['JRX_JWT_REFRESH_SECRET', 'JRX_JWT_REFRESH_SECRET'],
  ['JRX_PII_ENCRYPTION_KEY', 'NV_PII_ENCRYPTION_KEY'],
  ['JRX_CORS_ORIGINS', 'JRX_CORS_ORIGINS'],
  ['JRX_SEARCH_BASE_URL', 'JRX_ECOSYSTEM_API_BASE_URL'],
  ['JRX_SEARCH_BASE_URL', 'JRX_KNOWLEDGE_BASE_URL'],
  ['JRX_SEARCH_API_KEY', 'JRX_ECOSYSTEM_API_KEY'],
  ['JRX_SEARCH_API_KEY', 'JRX_KNOWLEDGE_API_KEY'],
];

function copyIfMissing(jrxKey: string, legacyKey: string): void {
  const jrx = process.env[jrxKey];
  if (jrx == null || jrx === '') return;
  if (process.env[legacyKey] == null || process.env[legacyKey] === '') {
    process.env[legacyKey] = jrx;
  }
}

function assertProductionA2aHmac(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const requireHmac =
    process.env.JRX_A2A_HMAC_REQUIRED === '1' || process.env.JRX_A2A_REQUIRE_HMAC === '1';
  if (!requireHmac) return;
  const secret = process.env.A2A_HMAC_SECRET;
  if (secret && secret.length >= 32) return;
  throw new Error(
    'JRX_A2A_HMAC_REQUIRED=1 in production but A2A_HMAC_SECRET is missing or shorter than 32 chars. ' +
      'Set A2A_HMAC_SECRET via SSM (/jurexio/prod/*) before enabling Queen multi-agent A2A.',
  );
}

export function bootstrapJurexioEnv(): void {
  if (process.env.JUREXIO_PLATFORM !== '1') {
    process.env.JUREXIO_PLATFORM = '1';
  }
  for (const [jrx, legacy] of PAIRS) {
    copyIfMissing(jrx, legacy);
  }
  if (!process.env.JRX_API_PREFIX && !process.env.JRX_API_PREFIX) {
    process.env.JRX_API_PREFIX = '/api/jrx';
  }
  assertProductionA2aHmac();
}

bootstrapJurexioEnv();
