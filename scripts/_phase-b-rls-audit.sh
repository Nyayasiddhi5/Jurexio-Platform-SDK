#!/usr/bin/env bash
# Phase B RLS audit — list org_id tables without FORCE RLS on nysdev
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"

docker exec -e "DB=${DB_ADMIN}" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DB, ssl: { rejectUnauthorized: false } });
const q = \`
  SELECT c.relname AS table_name,
         n.nspname AS schema_name,
         c.relrowsecurity AS rls_on,
         c.relforcerowsecurity AS rls_force,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN information_schema.columns ic
    ON ic.table_schema = n.nspname AND ic.table_name = c.relname AND ic.column_name = 'org_id'
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND (c.relname LIKE 'nv\\_%' ESCAPE '\\\\' OR c.relname LIKE 'ns\\_%' ESCAPE '\\\\'
         OR c.relname LIKE 'ni\\_%' ESCAPE '\\\\' OR c.relname LIKE 'nm\\_%' ESCAPE '\\\\'
         OR c.relname IN ('sdk_applications','sdk_api_request_logs','sdk_usage_metering','sdk_workflows','sdk_workflow_executions'))
  ORDER BY c.relforcerowsecurity ASC, c.relrowsecurity ASC, c.relname
\`;
const r = await pool.query(q);
console.log('TOTAL org_id tenant tables:', r.rows.length);
const unprotected = r.rows.filter(x => !x.rls_force);
console.log('WITHOUT FORCE RLS:', unprotected.length);
for (const row of unprotected.slice(0, 30)) {
  console.log(JSON.stringify(row));
}
const enforced = r.rows.filter(x => x.rls_force);
console.log('--- ENFORCED (' + enforced.length + ') ---');
for (const row of enforced) {
  console.log(JSON.stringify(row));
}
await pool.end();
"
