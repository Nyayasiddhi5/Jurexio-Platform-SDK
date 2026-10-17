#!/usr/bin/env bash
# NYV-PLATFORMS-SEED reconcile: the EC2 RDS `nv_sdk_applications` table predates
# the Platform Registry feature and is missing the platform_* columns. The
# gateway runtime DB role cannot ALTER (DDL is admin-only on RDS), so the route's
# self-heal ADD COLUMNs are silently denied and the ecosystem seed INSERT fails
# ("column platform_type does not exist"), leaving the registry empty.
#
# This reconciles the drift the documented way: additive `ADD COLUMN IF NOT
# EXISTS` via DATABASE_URL_ADMIN (non-destructive, PK type preserved), then seeds
# the 5 ecosystem platforms idempotently. Safe to re-run.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
# Prefer the admin role for DDL; fall back to runtime if admin is unset.
DB_URL="${DB_ADMIN:-$DB_RUNTIME}"

docker exec \
  -e "DB_URL=${DB_URL}" \
  -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
const ADD = [
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS platform_type VARCHAR(60) DEFAULT 'custom'\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS jurisdictions TEXT[] DEFAULT ARRAY['IN']\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'sandbox'\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS modules_enabled JSONB DEFAULT '{}'::jsonb\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS agents_allowed TEXT[] DEFAULT ARRAY['*']\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS llm_config JSONB DEFAULT '{}'::jsonb\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS rate_limits_config JSONB DEFAULT '{}'::jsonb\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS is_provisioned BOOLEAN NOT NULL DEFAULT FALSE\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS key_expires_at TIMESTAMP\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS org_id INTEGER DEFAULT 1\",
  \"ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS owner_id INTEGER\",
];
const SEED = [
  ['Nyayamitra','Nyayamitra (Citizen Legal Aid)','nyayamitra','pro','IN',['IN'],'production',{clawdbot:true,nyayarag:true,doc_intelligence:true,voice_ai:true,hitl:true}],
  ['Nyayasiddhi Professional','Nyayasiddhi Professional (Practice Mgmt)','nyayasiddhi-professional','pro','IN',['IN','UK','US','EU','GC','SG'],'production',{automateai:true,twindesk:true,skillshop:true,nyayarag:true,doc_intelligence:true,voice_ai:true,hitl:true,sdk_intelligence:true}],
  ['Nyayasiddhi Institutional','Nyayasiddhi Institutional (Enterprise GC)','nyayasiddhi-institution','enterprise','IN',['IN','UK','US','EU','GC','SG'],'production',{clawdbot:true,openbot:true,automateai:true,twindesk:true,skillshop:true,nyayarag:true,doc_intelligence:true,voice_ai:true,hitl:true,sdk_intelligence:true}],
  ['Nyayasiddhi Academy','Nyayasiddhi Academy (Education)','nyayasiddhi-academy','plus','IN',['IN','UK','US','EU','GC','SG'],'production',{skillshop:true,nyayarag:true,doc_intelligence:true}],
  ['Nyayasiddhi Ministry','Nyayasiddhi Ministry (Sovereign / Regulator)','nyayasiddhi-ministry','government','IN',['IN'],'production',{automateai:true,nyayarag:true,doc_intelligence:true,voice_ai:true,hitl:true,sdk_intelligence:true}],
];
try {
  const who = await pool.query('SELECT current_user');
  console.log('ddl_user:', who.rows[0].current_user);
  for (const stmt of ADD) {
    try { await pool.query(stmt); } catch (e) { console.log('ALTER_WARN:', e.message); }
  }
  console.log('columns reconciled');
  let inserted = 0;
  for (const s of SEED) {
    const r = await pool.query(
      \`INSERT INTO nv_sdk_applications (name, display_name, app_type, platform_type, jurisdiction, jurisdictions, tier, is_active, environment, modules_enabled, agents_allowed, is_provisioned, settings, created_at, updated_at)
        SELECT \$1::varchar,\$2::varchar,'platform',\$3::varchar,\$5::varchar,\$6::text[],\$4::varchar,true,\$7::varchar,\$8::jsonb,ARRAY['*']::text[],false,'{}'::jsonb,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM nv_sdk_applications WHERE name=\$1::varchar) RETURNING id\`,
      [s[0], s[1], s[2], s[3], s[4], s[5], s[6], JSON.stringify(s[7])]
    );
    inserted += r.rowCount;
  }
  console.log('seeded_now:', inserted);
  const cnt = await pool.query(\"SELECT COUNT(*)::int c FROM nv_sdk_applications WHERE platform_type IS NOT NULL AND platform_type <> 'custom'\");
  console.log('ecosystem_total:', cnt.rows[0].c);
  const list = await pool.query('SELECT platform_type, display_name FROM nv_sdk_applications ORDER BY created_at');
  for (const row of list.rows) console.log('  -', row.platform_type, '|', row.display_name);
} finally { await pool.end(); }
"
