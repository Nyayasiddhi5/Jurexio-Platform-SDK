#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1; }

echo "=== counts + max(created_at-ish) per key table ==="
for T in \
  "nv_schema.sdk_api_request_logs" "public.sdk_api_request_logs" \
  "nv_schema.ai_activity" "public.nv_ai_activity" \
  "nv_schema.nv_audit_logs" "public.nv_audit_logs" \
  "nv_schema.agent_audit_log" "nv_schema.usage_logs" \
  "nv_schema.agui_events" "nv_schema.explainability_logs" "nv_schema.vector_search_logs" ; do
  # discover a timestamp column
  SCH="${T%%.*}"; TB="${T##*.}"
  TS=$(runq "SELECT column_name FROM information_schema.columns WHERE table_schema='$SCH' AND table_name='$TB' AND (column_name ILIKE '%created%' OR column_name ILIKE '%timestamp%' OR column_name ILIKE '%_at' OR column_name='ts') ORDER BY ordinal_position LIMIT 1;")
  if [ -n "$TS" ]; then
    echo "[$T] ts=$TS -> $(runq "SELECT count(*)||' | last='||COALESCE(max($TS)::text,'NULL')||' | last24h='||count(*) FILTER (WHERE $TS > now()-interval '24 hours') FROM $T;")"
  else
    echo "[$T] (no ts col) -> $(runq "SELECT count(*) FROM $T;")"
  fi
done
