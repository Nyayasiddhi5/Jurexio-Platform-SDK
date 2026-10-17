#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$1" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$2\"" 2>&1; }
echo "=== PG version ==="; runq "$ADM" "SHOW server_version;"
echo "=== RLS on relevant relations ==="
runq "$ADM" "SELECT n.nspname||'.'||c.relname||' rls='||c.relrowsecurity||' forced='||c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='nv_schema' AND c.relname='ai_activity') OR (n.nspname='public' AND c.relname='nv_ai_activity');"
echo "=== public.nv_ai_activity (empty table) columns ==="
runq "$ADM" "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='nv_ai_activity' ORDER BY ordinal_position;"
echo "=== can nv_app SELECT nv_schema.ai_activity? (run as APP role) ==="
runq "$APP" "SELECT 'app_can_read', count(*) FROM nv_schema.ai_activity;"
echo "=== current app role name ==="
runq "$APP" "SELECT current_user;"
