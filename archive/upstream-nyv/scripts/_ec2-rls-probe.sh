#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"

docker exec \
  -e "DATABASE_URL_ADMIN=${DB_ADMIN}" \
  -e "DATABASE_URL=${DB_RUNTIME}" \
  -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
async function meta(url, label) {
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const u = await pool.query('SELECT current_user, current_database()');
    console.log(label + ' user:', u.rows[0]);
    const rls = await pool.query(
      \"SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='nv_users'\"
    );
    console.log(label + ' rls:', rls.rows[0] || 'no table');
    const cnt = await pool.query('SELECT COUNT(*)::int c FROM nv_users');
    console.log(label + ' count:', cnt.rows[0].c);
  } finally { await pool.end(); }
}
await meta(process.env.DATABASE_URL_ADMIN, 'admin');
await meta(process.env.DATABASE_URL, 'runtime');
"
