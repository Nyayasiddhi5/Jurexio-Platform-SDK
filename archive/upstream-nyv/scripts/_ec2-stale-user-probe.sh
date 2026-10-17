#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "
-- hard-FK child rows owned by stale users
SELECT '\''SDK_APPS_OWNED'\'', count(*) FROM nv_sdk_applications WHERE owner_id IN (SELECT id FROM nv_users WHERE email ILIKE '\''sme-smoke-%@example.com'\'');
-- discover any public column literally named user_id/owner_id/created_by and whether table has stale rows
SELECT '\''SOFT_REF_TABLE'\'', c.table_name, c.column_name
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema AND t.table_type='\''BASE TABLE'\''
WHERE c.table_schema='\''public'\'' AND c.column_name IN ('\''user_id'\'',  '\''owner_id'\'',  '\''created_by'\'')
ORDER BY c.table_name;
-- session/token tables that might exist
SELECT '\''SESS_TABLES'\'', table_name FROM information_schema.tables WHERE table_schema='\''public'\'' AND (table_name ILIKE '\''%session%'\'' OR table_name ILIKE '\''%refresh%token%'\'');
"' 2>&1
