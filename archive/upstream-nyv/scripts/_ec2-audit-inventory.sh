#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "
-- every table whose name hints at audit/activity/log/event across schemas
SELECT '\''TBL'\'', table_schema, table_name
FROM information_schema.tables
WHERE table_type='\''BASE TABLE'\''
  AND (table_name ILIKE '\''%audit%'\'' OR table_name ILIKE '\''%activity%'\'' OR table_name ILIKE '\''%_log%'\'' OR table_name ILIKE '\''%_logs%'\'' OR table_name ILIKE '\''%event%'\'' OR table_name ILIKE '\''%_trail%'\'')
ORDER BY table_schema, table_name;
"' 2>&1
