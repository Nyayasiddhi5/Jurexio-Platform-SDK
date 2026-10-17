#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1; }
echo "=== RLS flags on sdk_api_request_logs ==="
runq "SELECT relname||' rls='||relrowsecurity||' forced='||relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='sdk_api_request_logs';"
echo "=== policies (name | permissive | cmd | roles | qual | with_check) ==="
runq "SELECT policyname||' | '||permissive||' | '||cmd||' | '||array_to_string(roles,',')||' | USING='||COALESCE(qual,'(none)')||' | CHECK='||COALESCE(with_check,'(none)') FROM pg_policies WHERE schemaname='public' AND tablename='sdk_api_request_logs';"
echo "=== nv_app grants on the table ==="
runq "SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='sdk_api_request_logs' AND grantee='nv_app' ORDER BY 1;"
echo "=== does nv_app have rolbypassrls? ==="
runq "SELECT rolname||' bypassrls='||rolbypassrls FROM pg_roles WHERE rolname IN ('nv_app','nyvadmin');"
