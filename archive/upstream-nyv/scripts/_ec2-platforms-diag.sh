#!/usr/bin/env bash
# NYV-PLATFORMS-SEED diag: introspect nv_sdk_applications on EC2 RDS and
# reproduce the ecosystem seed insert to capture the exact failure that leaves
# the Platform Registry empty (GET /api/jrx/platforms -> total 0).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"

docker exec \
  -e "DATABASE_URL=${DB_RUNTIME}" \
  -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const reg = await pool.query(\"SELECT to_regclass('public.nv_sdk_applications') AS t\");
  console.log('regclass:', reg.rows[0].t);
  const cols = await pool.query(
    \"SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='nv_sdk_applications' ORDER BY ordinal_position\"
  );
  console.log('columns:');
  for (const c of cols.rows) console.log('  -', c.column_name, '|', c.data_type, '| null='+c.is_nullable, '| def='+(c.column_default||'NULL'));
  const cnt = await pool.query('SELECT COUNT(*)::int c FROM nv_sdk_applications');
  console.log('row_count:', cnt.rows[0].c);
  // Reproduce one seed insert exactly as the route does.
  try {
    await pool.query('BEGIN');
    const r = await pool.query(
      \`INSERT INTO nv_sdk_applications (name, display_name, app_type, platform_type, jurisdiction, jurisdictions, tier, is_active, environment, modules_enabled, agents_allowed, is_provisioned, settings, created_at, updated_at)
        SELECT \$1,\$2,'platform',\$3,\$4,\$5::text[],\$6,true,\$7,\$8::jsonb,ARRAY['*']::text[],false,'{}'::jsonb,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM nv_sdk_applications WHERE name=\$1) RETURNING id\`,
      ['__diag_probe__','Diag Probe','custom','IN',['IN'],'pro','production','{}']
    );
    console.log('SEED_INSERT_OK rows=', r.rowCount);
    await pool.query('ROLLBACK');
  } catch (e) {
    await pool.query('ROLLBACK').catch(()=>{});
    console.log('SEED_INSERT_ERROR:', e.message);
  }
} finally { await pool.end(); }
"
