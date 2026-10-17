#!/usr/bin/env bash
# NYV-PLATFORMS-RLS: relax the strict per-org tenant_isolation policy on
# nv_sdk_applications so the GLOBAL Platform Registry is readable by the runtime
# role. Migration 0004 force-enabled `tenant_isolation` (org_id::text =
# current_setting('app.current_org_id')) on every org_id table, but the platform
# registry is global super-admin config (NOT per-tenant data — platform API key
# SECRETS live in the separate sdk_app_api_keys/nv_api_keys tables, which keep
# their own protection). With the runtime pool's fail-closed default
# (app.current_org_id=''), the registry returned 0 rows. This adds two
# non-destructive escapes — explicit super-admin context and the global
# app_type='platform' class — leaving strict per-org isolation intact for every
# other (tenant) row. The canonical SDK gateway reads sdk_applications, not this
# deprecated table, so blast radius is limited to the registry. Idempotent.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_URL="${DB_ADMIN:-$DB_RUNTIME}"

docker exec -e "DB_URL=${DB_URL}" -e "R=${DB_RUNTIME}" -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
const admin = new pg.Pool({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
try {
  await admin.query(\"DROP POLICY IF EXISTS tenant_isolation ON nv_sdk_applications\");
  await admin.query(\`
    CREATE POLICY tenant_isolation ON nv_sdk_applications
      USING (
        org_id::text = current_setting('app.current_org_id', true)
        OR current_setting('app.is_super_admin', true) = 'true'
        OR app_type = 'platform'
      )
      WITH CHECK (
        org_id::text = current_setting('app.current_org_id', true)
        OR current_setting('app.is_super_admin', true) = 'true'
        OR app_type = 'platform'
      )\`);
  console.log('policy updated');
} finally { await admin.end(); }

// Verify as the RUNTIME role with the fail-closed default context.
const rt = new pg.Pool({ connectionString: process.env.R, ssl: { rejectUnauthorized: false } });
try {
  await rt.query(\"SET app.current_org_id = ''\");
  const c = await rt.query(\"SELECT COUNT(*)::int c FROM nv_sdk_applications WHERE app_type='platform'\");
  console.log('runtime_platform_visible:', c.rows[0].c);
  const e = await rt.query(\"SELECT COUNT(*)::int c FROM nv_sdk_applications WHERE platform_type IS NOT NULL AND platform_type<>'custom'\");
  console.log('runtime_ecosystem_visible:', e.rows[0].c);
} finally { await rt.end(); }
"
