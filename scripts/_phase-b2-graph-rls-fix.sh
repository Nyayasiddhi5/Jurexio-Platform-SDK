#!/usr/bin/env bash
# Allow nv_app to read global citation graph rows (org_id IS NULL).
# Uses DATABASE_URL_ADMIN for DDL; verifies with DATABASE_URL (nv_app).
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_APP="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
if [ -z "$DB_ADMIN" ]; then echo "MISSING DATABASE_URL_ADMIN"; exit 1; fi

docker exec -i -e NYV_DB_APP="$DB_APP" -e NYV_DB_ADMIN="$DB_ADMIN" -w /app nyv-gateway node --input-type=module <<'NODE'
import pg from 'pg';

async function counts(url, label) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const role = await c.query('SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname=current_user');
  const e = await c.query('SELECT count(*)::bigint c FROM nv_schema.nv_legal_graph_entities');
  const g = await c.query('SELECT count(*)::bigint c FROM nv_schema.nv_legal_graph_edges');
  console.log(label, JSON.stringify({ role: role.rows[0].rolname, bypass: role.rows[0].rolbypassrls, entities: e.rows[0].c, edges: g.rows[0].c }));
  await c.end();
}

await counts(process.env.NYV_DB_APP, 'BEFORE_nv_app');
const admin = new pg.Client({ connectionString: process.env.NYV_DB_ADMIN, ssl: { rejectUnauthorized: false } });
await admin.connect();
for (const t of ['nv_legal_graph_entities', 'nv_legal_graph_edges']) {
  await admin.query(`DROP POLICY IF EXISTS tenant_isolation ON nv_schema.${t}`);
  await admin.query(`
    CREATE POLICY tenant_isolation ON nv_schema.${t}
      USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true))
      WITH CHECK (org_id IS NULL OR org_id = current_setting('app.current_org_id', true))
  `);
}
await admin.end();
await counts(process.env.NYV_DB_APP, 'AFTER_nv_app');
console.log('GRAPH_RLS_FIX_OK');
NODE
