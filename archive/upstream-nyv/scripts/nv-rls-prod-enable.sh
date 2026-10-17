#!/usr/bin/env bash
# NV-RLS-PROD-001 — Verify RLS policies and document production cutover steps.
# Does NOT enable RLS on production without NYV_RLS_ENFORCE=1 + operator approval.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

DB_URL="${DATABASE_URL_ADMIN:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set DATABASE_URL_ADMIN or DATABASE_URL" >&2
  exit 1
fi

echo "[rls] checking policies on nv_users..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname IN ('public', 'nv_schema')
ORDER BY 1, 2, 3
LIMIT 30;
"

echo "[rls] verify app role exists..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('nv_app', 'nyv_app');" || true

echo ""
echo "Production cutover checklist (manual ops):"
echo "  1. Apply migrations/2026-06-29-nv-app-role-rls-enforce.sql if not applied"
echo "  2. Set NYV_RLS_ENFORCE=1 in gateway .env"
echo "  3. Ensure DATABASE_URL uses nv_app role (not superuser)"
echo "  4. Run npm run seed:demo-tenants with DATABASE_URL_ADMIN for seeds only"
echo "  5. Re-run npm run uat:p0-p1:close and product:readiness:10k"
echo "[rls] verification complete (enforcement unchanged unless NYV_RLS_ENFORCE=1)"
