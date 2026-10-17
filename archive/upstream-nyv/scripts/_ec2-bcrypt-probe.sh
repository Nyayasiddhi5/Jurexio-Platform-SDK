#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"

docker exec \
  -e "NV_DEMO_PASSWORD=${NV_DEMO_PW}" \
  -e "DATABASE_URL_ADMIN=${DB_ADMIN}" \
  -e "DATABASE_URL=${DB_RUNTIME}" \
  -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
import bcrypt from 'bcrypt';
const demo = process.env.NV_DEMO_PASSWORD || '';
async function run(url, label) {
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const r = await pool.query(
      \"SELECT id, email, is_active, org_id, password_hash FROM nv_users WHERE email = 'admin@nyayavigya.in'\"
    );
    const row = r.rows[0];
    if (!row) { console.log(label + ': NO ROW'); return; }
    const ok = demo && row.password_hash ? await bcrypt.compare(demo, row.password_hash) : false;
    console.log(label + ':', { id: row.id, is_active: row.is_active, org_id: row.org_id, bcrypt_ok: ok });
  } finally { await pool.end(); }
}
await run(process.env.DATABASE_URL_ADMIN, 'admin');
await run(process.env.DATABASE_URL, 'runtime');
"
