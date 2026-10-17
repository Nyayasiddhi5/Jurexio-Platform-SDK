/**
 * JRX CORS Config — production-grade origin allowlist
 * ALL allowed origins live here. NEVER use wildcard '*' in production.
 *
 * GUARDRAIL: Any new frontend domain MUST be added here AND set via env var.
 * Never hardcode production domain strings in index.ts or middleware.
 *
 * @file src/config/cors-config.ts
 */

const isDev = process.env.NODE_ENV !== 'production';

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3004',
  'http://localhost:5000',
  'http://localhost:4000',
  'http://localhost:4001',
];

const PROD_ORIGINS = [
  'https://nyayasiddhi.com',
  'https://www.nyayasiddhi.com',
  'https://app.nyayasiddhi.com',
  'https://institutional.nyayasiddhi.com',
  'https://jurexio-citizen.com',
  'https://www.jurexio-citizen.com',
];

function parseEnvOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

const envOrigins = parseEnvOrigins();

export const ALLOWED_ORIGINS = new Set<string>([
  ...(isDev ? DEV_ORIGINS : []),
  ...PROD_ORIGINS,
  ...envOrigins,
].filter(Boolean));

export function corsOriginValidator(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  if (!origin) {
    return callback(null, true);
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    return callback(null, true);
  }
  if (isDev) {
    return callback(null, true);
  }
  return callback(new Error(`CORS blocked: origin '${origin}' is not in the allowlist`));
}

export const CORS_OPTIONS = {
  origin: corsOriginValidator,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-JRX-Signature', 'X-Request-ID', 'X-JRX-Trace-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-JRX-Trace-ID'],
  maxAge: 86400,
} as const;
