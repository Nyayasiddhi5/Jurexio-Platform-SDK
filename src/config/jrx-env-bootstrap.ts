/**
 * JRX-ENV-BOOTSTRAP-001 — Jurexio Enterprise Platform env (JRX_* SSoT).
 * Maps JRX_* → legacy internal names at process start until Phase 2 rename completes.
 * Jurexio deploy templates must use JRX_* only; NYV_* is never required in .env examples.
 */
const PAIRS: Array<[jrx: string, legacy: string]> = [
  ['JRX_PORT_GATEWAY', 'NYV_PORT_GATEWAY'],
  ['JRX_PORT_ORCH', 'NYV_PORT_ORCH'],
  ['JRX_PUBLIC_API_URL', 'NYV_PUBLIC_API_URL'],
  ['JRX_DATABASE_URL', 'NYV_DATABASE_URL'],
  ['JRX_DATABASE_URL', 'DATABASE_URL'],
  ['JRX_REDIS_TCP_URL', 'NYV_REDIS_TCP_URL'],
  ['JRX_REDIS_TCP_URL', 'REDIS_URL'],
  ['JRX_JWT_SECRET', 'NYV_JWT_SECRET'],
  ['JRX_JWT_REFRESH_SECRET', 'NYV_JWT_REFRESH_SECRET'],
  ['JRX_PII_ENCRYPTION_KEY', 'NV_PII_ENCRYPTION_KEY'],
  ['JRX_CORS_ORIGINS', 'NYV_CORS_ORIGINS'],
  ['JRX_SEARCH_BASE_URL', 'NYS_API_BASE_URL'],
  ['JRX_SEARCH_BASE_URL', 'NYV_KNOWLEDGE_BASE_URL'],
  ['JRX_SEARCH_API_KEY', 'NYS_API_KEY'],
  ['JRX_SEARCH_API_KEY', 'NYV_KNOWLEDGE_API_KEY'],
];

function copyIfMissing(jrxKey: string, legacyKey: string): void {
  const jrx = process.env[jrxKey];
  if (jrx == null || jrx === '') return;
  if (process.env[legacyKey] == null || process.env[legacyKey] === '') {
    process.env[legacyKey] = jrx;
  }
}

export function bootstrapJurexioEnv(): void {
  if (process.env.JUREXIO_PLATFORM !== '1') {
    process.env.JUREXIO_PLATFORM = '1';
  }
  for (const [jrx, legacy] of PAIRS) {
    copyIfMissing(jrx, legacy);
  }
  if (!process.env.JRX_API_PREFIX && !process.env.NYV_API_PREFIX) {
    process.env.JRX_API_PREFIX = '/api/jrx';
  }
}

bootstrapJurexioEnv();
