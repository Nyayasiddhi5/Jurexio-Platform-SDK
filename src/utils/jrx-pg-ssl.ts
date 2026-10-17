/**
 * NV-PG-SSL-VERIFY-2026-05-11 (task-142) — Postgres TLS-verification helper
 *
 * Bundles the AWS RDS global CA bundle into the runtime so the gateway can
 * connect to RDS with `sslmode=verify-full` (full TLS handshake, including
 * server-certificate verification) instead of the previous "encrypted but
 * unverified" stance (`ssl: { rejectUnauthorized: false }`).
 *
 * The CA bundle ships at `certs/rds-global-bundle.pem` (downloaded from
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem on
 * 2026-05-11). Override with the env var `NYV_RDS_CA_BUNDLE_PATH` if you
 * need to point at a newer bundle without rebuilding the image.
 *
 * Behaviour matrix:
 *   PGSSLMODE=disable                     → ssl: false
 *   NYV_PG_SSL_VERIFY=false               → ssl: { rejectUnauthorized: false }
 *                                            (legacy un-verified posture, kept
 *                                             as an emergency escape hatch)
 *   CA bundle present (default)           → ssl: { ca, rejectUnauthorized:true,
 *                                                  minVersion: 'TLSv1.2' }
 *   CA bundle missing + verify requested  → throws (fail-loud — do not
 *                                            silently downgrade in prod)
 *
 * The helper caches the CA file read so we touch the disk once per process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/utils/jrx-pg-ssl.ts → repo root is two levels up from src/utils
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CA_PATH = path.join(REPO_ROOT, 'certs', 'rds-global-bundle.pem');

export const RDS_CA_BUNDLE_PATH = process.env.NYV_RDS_CA_BUNDLE_PATH || DEFAULT_CA_PATH;

let cachedCa: string | null | undefined;

function readCaBundle(): string | null {
  if (cachedCa !== undefined) return cachedCa;
  try {
    cachedCa = fs.readFileSync(RDS_CA_BUNDLE_PATH, 'utf8');
  } catch {
    cachedCa = null;
  }
  return cachedCa;
}

export function shouldVerifyTls(connectionString?: string): boolean {
  if (process.env.PGSSLMODE === 'disable') return false;
  if (process.env.NYV_PG_SSL_VERIFY === 'false') return false;
  if (connectionString && /\bsslmode=disable\b/.test(connectionString)) return false;
  return true;
}

export type PgSslConfig =
  | false
  | { rejectUnauthorized: false }
  | { ca: string; rejectUnauthorized: true; minVersion: 'TLSv1.2' };

/**
 * Build the `ssl` value for `pg.Pool({ ssl })` based on env + the bundled
 * RDS CA. Returns `false` when SSL is explicitly disabled.
 */
export function getPgSslConfig(connectionString?: string): PgSslConfig {
  if (process.env.PGSSLMODE === 'disable') return false;
  if (connectionString && /\bsslmode=disable\b/.test(connectionString)) return false;

  if (process.env.NYV_PG_SSL_VERIFY === 'false') {
    return { rejectUnauthorized: false };
  }

  const ca = readCaBundle();
  if (!ca) {
    // Fail loud in prod-like environments; downgrade silently in dev/test
    // so an un-bundled local checkout still works against a local docker
    // Postgres without TLS verification.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[nv-pg-ssl] RDS CA bundle not found at ${RDS_CA_BUNDLE_PATH}. ` +
        `Either ship certs/rds-global-bundle.pem with the image, point ` +
        `NYV_RDS_CA_BUNDLE_PATH at a readable file, or set ` +
        `NYV_PG_SSL_VERIFY=false to opt out of cert verification.`,
      );
    }
    return { rejectUnauthorized: false };
  }
  return { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
}
