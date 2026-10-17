#!/usr/bin/env bash
# Phase B row counts for unprotected RLS pilot tables
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"

docker exec -e "DB=${DB_ADMIN}" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DB, ssl: { rejectUnauthorized: false } });
const tables = [
  ['nv_schema','nv_clawdbot_conversations'],
  ['nv_schema','nv_openbot_inbox'],
  ['nv_schema','nv_openbot_channels'],
  ['nv_schema','nv_clawdbot_bots'],
  ['public','nv_org_console_layout'],
  ['nv_schema','nv_openbot_routes'],
  ['nv_schema','nv_twindesk_twins'],
  ['public','nv_legal_intel_digests'],
];
for (const [schema, table] of tables) {
  try {
    const r = await pool.query(\`SELECT count(*)::int c FROM \${schema}.\${table}\`);
    console.log(schema+'.'+table, r.rows[0].c);
  } catch (e) { console.log(schema+'.'+table, 'ERR', e.message); }
}
await pool.end();
"
