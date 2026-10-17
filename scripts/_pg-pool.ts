/**
 * Jurexio Platform 3.1.2 — pg.Pool tagged-template shim
 * JRX-SCRIPT-PG-POOL-001 (T-DLR-02)
 *
 * Mimics the @neondatabase/serverless tagged-template API on top of node-postgres.
 *
 *   import { makePgSql } from './_pg-pool.js';
 *   const sql = makePgSql();
 *   const rows = await sql`SELECT 1 as one`;
 *   await sql.end();              // close the pool when the seeder finishes
 *
 * Why: seeders previously imported `neon()` which assumes a Neon HTTP endpoint.
 * For non-Neon Postgres targets (RDS / local docker) we need a real pg pool.
 * The shim keeps the call sites unchanged so the diff is one-line per file.
 */

import pg from 'pg';
import {
  normalizePgConnectionString,
  upgradePgConnectionStringToVerifyFull,
} from '../src/utils/jrx-pg-url.js';
import { getPgSslConfig } from '../src/utils/jrx-pg-ssl.js';

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>) & {
  end: () => Promise<void>;
  pool: pg.Pool;
};

export function makePgSql(connectionString?: string): SqlFn {
  const rawConn = connectionString ?? process.env.DATABASE_URL;
  if (!rawConn) {
    throw new Error('makePgSql: DATABASE_URL is not set');
  }

  // NV-PG-SSL-VERIFY-2026-05-11 (task-142): full TLS verification against
  // managed Postgres (RDS / Neon). The bundled CA at
  // certs/rds-global-bundle.pem feeds `ssl: { ca, rejectUnauthorized:true }`
  // and the URL's sslmode is upgraded prefer/require/verify-ca →
  // verify-full so libpq-style tooling sees the same intent. Set
  // JRX_PG_SSL_VERIFY=false (or PGSSLMODE=disable) to opt back to the
  // legacy un-verified posture from task-135.
  const normalized = normalizePgConnectionString(rawConn);
  const conn = process.env.JRX_PG_SSL_VERIFY === 'false'
    ? normalized
    : upgradePgConnectionStringToVerifyFull(normalized);

  const pool = new pg.Pool({
    connectionString: conn,
    ssl: getPgSslConfig(conn),
    max: 4,
  });

  async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
    let text = '';
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const res = await pool.query(text, values as any[]);
    return res.rows;
  }

  (sql as SqlFn).end = () => pool.end();
  (sql as SqlFn).pool = pool;
  return sql as SqlFn;
}
