#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1; }
echo "=== ai_activity columns ==="
runq "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_schema='nv_schema' AND table_name='ai_activity' ORDER BY ordinal_position;"
echo "=== ai_activity breakdown by likely source/platform/type cols (sampled) ==="
runq "SELECT 'activity_type', activity_type, count(*) FROM nv_schema.ai_activity GROUP BY activity_type ORDER BY 3 DESC LIMIT 15;"
echo "--- by platform (if col exists) ---"
runq "SELECT 'platform', platform, count(*) FROM nv_schema.ai_activity GROUP BY platform ORDER BY 3 DESC LIMIT 15;"
echo "=== nv_audit_logs columns ==="
runq "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_schema='nv_schema' AND table_name='nv_audit_logs' ORDER BY ordinal_position;"
echo "=== nv_audit_logs recent action breakdown ==="
runq "SELECT 'action', action, count(*) FROM nv_schema.nv_audit_logs GROUP BY action ORDER BY 3 DESC LIMIT 12;"
echo "=== sdk_api_request_logs (public) columns + last platforms ==="
runq "SELECT column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='sdk_api_request_logs' ORDER BY ordinal_position;"
runq "SELECT 'platform_last', platform, count(*), max(created_at) FROM public.sdk_api_request_logs GROUP BY platform ORDER BY 3 DESC LIMIT 10;"
