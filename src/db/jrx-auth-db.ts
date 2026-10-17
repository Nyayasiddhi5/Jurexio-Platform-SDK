/**
 * Admin DB handle for pre-tenant auth flows (login/register).
 *
 * Runtime `DATABASE_URL` connects as `nv_app` with RLS enforced on
 * `nv_users` — credential lookup by email returns zero rows when
 * `app.current_org_id` is unset. Auth must use `DATABASE_URL_ADMIN`
 * (nyvadmin / BYPASSRLS) for the lookup + password verify only.
 *
 * Never use this pool for general request handlers — tenant isolation
 * must stay on the runtime pool.
 */
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../shared/schema.js';
import { normalizePgConnectionString, upgradePgConnectionStringToVerifyFull } from '../utils/jrx-pg-url.js';
import { getPgSslConfig } from '../utils/jrx-pg-ssl.js';
import { createLogger } from '../utils/logger.js';
import { isPgAuthFailed } from '../utils/jrx-pg-auth-failed.js';
import { pool as runtimePool } from './index.js';

const logger = createLogger('./jrx-auth-db');

type AuthDb = NodePgDatabase<typeof schema>;

let authPool: Pool | null = null;
let authDb: AuthDb | null = null;
let authDbDisabled = false;

function buildAdminUrl(): string | null {
  const raw = process.env.DATABASE_URL_ADMIN?.trim();
  if (!raw) return null;
  const base = normalizePgConnectionString(raw);
  return process.env.NYV_PG_SSL_VERIFY === 'false'
    ? base
    : upgradePgConnectionStringToVerifyFull(base);
}

/** Lazy admin drizzle for auth credential lookups. Falls back to null when unset. */
export function getAuthDb(): AuthDb | null {
  if (authDbDisabled) return null;
  if (authDb) return authDb;
  const url = buildAdminUrl();
  if (!url) {
    logger.warn('[nv-auth-db] DATABASE_URL_ADMIN not set — auth flows use runtime pool (RLS may block login on enforced RDS)');
    return null;
  }
  authPool = new Pool({
    connectionString: url,
    ssl: getPgSslConfig(url),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  authPool.on('error', (err: Error) => {
    logger.error('[nv-auth-db] pool error:', err.message);
  });
  authDb = drizzlePg(authPool, { schema });
  logger.info('[nv-auth-db] admin auth pool initialised (RLS bypass for credential lookup)');
  return authDb;
}

function disableAuthDb(reason: string): void {
  authDbDisabled = true;
  logger.warn('[nv-auth-db] admin pool disabled; login will use org-scoped runtime lookup', {
    reason: reason.slice(0, 160),
  });
  if (authPool) {
    void authPool.end().catch(() => undefined);
  }
  authPool = null;
  authDb = null;
}

export interface AuthUserRow {
  id: string | number;
  email: string;
  password_hash: string;
  role: string;
  full_name: string | null;
  tier: string | null;
  org_id: number | string | null;
  is_active: boolean;
}

const USER_BY_EMAIL_SQL = `
  SELECT id, email, password_hash, role, full_name, tier, org_id, is_active
  FROM nv_users
  WHERE email = $1
`;

/**
 * Credential lookup that does not depend on a working nyvadmin password.
 * Prefers DATABASE_URL_ADMIN (BYPASSRLS). On 28P01, scans orgs in one
 * transaction with `app.current_org_id` so FORCE RLS still holds.
 */
export async function findUserByEmailForLogin(email: string): Promise<AuthUserRow | null> {
  const admin = getAuthDb();
  if (admin) {
    try {
      const result = await admin.execute(sql`
          SELECT id, email, password_hash, role, full_name, tier, org_id, is_active
          FROM nv_users
          WHERE email = ${email}
        `);
      const row = ((result as { rows?: AuthUserRow[] }).rows || (result as unknown as AuthUserRow[]))[0];
      return row ?? null;
    } catch (err) {
      if (isPgAuthFailed(err)) {
        disableAuthDb('28P01');
      } else {
        throw err;
      }
    }
  }

  if (!runtimePool || typeof (runtimePool as { connect?: unknown }).connect !== 'function') {
    return null;
  }
  const client = await (runtimePool as Pool).connect();
  try {
    await client.query('BEGIN');
    const orgs = await client.query<{ id: number }>(
      'SELECT id FROM nv_organizations ORDER BY id ASC LIMIT 80',
    );
    for (const org of orgs.rows) {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [String(org.id)]);
      const r = await client.query<AuthUserRow>(USER_BY_EMAIL_SQL, [email]);
      if (r.rows[0]) {
        await client.query('COMMIT');
        return r.rows[0];
      }
    }
    await client.query('ROLLBACK');
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const USER_BY_ID_SQL = `
  SELECT id, email, password_hash, role, full_name, tier, org_id, is_active
  FROM nv_users
  WHERE id = $1
`;

/** Session restore: same admin → 28P01 → org-scoped runtime lookup as login. */
export async function findUserByIdForSession(
  userId: string | number,
  orgId: number | string | null,
): Promise<AuthUserRow | null> {
  const admin = getAuthDb();
  if (admin) {
    try {
      const result = await admin.execute(sql`
          SELECT id, email, password_hash, role, full_name, tier, org_id, is_active
          FROM nv_users
          WHERE id = ${userId}
        `);
      const row = ((result as { rows?: AuthUserRow[] }).rows || (result as unknown as AuthUserRow[]))[0];
      return row ?? null;
    } catch (err) {
      if (isPgAuthFailed(err)) disableAuthDb('28P01');
      else throw err;
    }
  }

  if (!runtimePool || typeof (runtimePool as { connect?: unknown }).connect !== 'function') {
    return null;
  }
  const client = await (runtimePool as Pool).connect();
  try {
    await client.query('BEGIN');
    const orgCandidates: Array<number | string> = [];
    if (orgId != null && orgId !== '') orgCandidates.push(orgId);
    const orgs = await client.query<{ id: number }>('SELECT id FROM nv_organizations ORDER BY id ASC LIMIT 80');
    for (const org of orgs.rows) {
      if (!orgCandidates.some((c) => String(c) === String(org.id))) orgCandidates.push(org.id);
    }
    for (const oid of orgCandidates) {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [String(oid)]);
      const r = await client.query<AuthUserRow>(USER_BY_ID_SQL, [userId]);
      if (r.rows[0]) {
        await client.query('COMMIT');
        return r.rows[0];
      }
    }
    await client.query('ROLLBACK');
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function touchLastLogin(userId: string | number, orgId: number | string | null): Promise<void> {
  const admin = getAuthDb();
  if (admin) {
    try {
      await admin.execute(sql`UPDATE nv_users SET last_login_at = NOW() WHERE id = ${userId}`);
      return;
    } catch (err) {
      if (isPgAuthFailed(err)) disableAuthDb('28P01');
      else throw err;
    }
  }
  if (!runtimePool || typeof (runtimePool as { connect?: unknown }).connect !== 'function') return;
  const client = await (runtimePool as Pool).connect();
  try {
    await client.query('BEGIN');
    if (orgId != null && orgId !== '') {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [String(orgId)]);
    }
    await client.query('UPDATE nv_users SET last_login_at = NOW() WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
}

export async function closeAuthDb(): Promise<void> {
  if (authPool) {
    await authPool.end();
    authPool = null;
    authDb = null;
  }
}
