#!/usr/bin/env bash
# Apply Phase B RLS pilot migration 0016 on nysdev
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
# libpq sidecar rejects sslmode=no-verify
DB_PSQL="${DB_ADMIN/sslmode=no-verify/sslmode=require}"

echo "=== ROW COUNTS (pilot tables) ==="
bash /tmp/rc.sh 2>/dev/null || bash "$(dirname "$0")/_phase-b-rls-rowcounts.sh"

echo "=== APPLY drizzle/0016_rls_pilot_five_tables.sql ==="
psql "$DB_PSQL" -v ON_ERROR_STOP=1 -f /tmp/0016.sql

echo "=== VERIFY PILOT RLS ==="
docker exec -e "DB=${DB_ADMIN}" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DB, ssl: { rejectUnauthorized: false } });
const tables = [
  ['nv_schema','nv_clawdbot_conversations'],
  ['nv_schema','nv_openbot_inbox'],
  ['nv_schema','nv_openbot_channels'],
  ['nv_schema','nv_clawdbot_bots'],
  ['public','nv_org_console_layout'],
];
for (const [schema, table] of tables) {
  const r = await pool.query(
    \`SELECT c.relrowsecurity rls, c.relforcerowsecurity force,
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) policies
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=\$1 AND c.relname=\$2\`, [schema, table]);
  console.log(schema+'.'+table, r.rows[0]);
}
await pool.end();
"
echo "=== RLS PILOT APPLY COMPLETE ==="
