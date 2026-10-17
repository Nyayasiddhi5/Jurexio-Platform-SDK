#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "
-- 1) identify the user table(s) and stale test accounts
SELECT '\''USER_TABLES'\'', table_schema, table_name FROM information_schema.tables WHERE table_name IN ('\''nv_users'\'',  '\''users'\'') ;
-- 2) stale test accounts by email pattern
SELECT '\''STALE_SMOKE'\'', count(*) FROM nv_users WHERE email ILIKE '\''sme-smoke-%@example.com'\'' OR email ILIKE '\''%smoke%@example.com'\'';
SELECT '\''STALE_SAMPLE'\'', email, id, role, created_at FROM nv_users WHERE email ILIKE '\''sme-smoke-%@example.com'\'' ORDER BY created_at DESC LIMIT 10;
SELECT '\''TOTAL_USERS'\'', count(*) FROM nv_users;
-- 3) all FKs that reference nv_users (so we know cascade surface)
SELECT '\''FK_TO_USERS'\'', tc.table_schema||'\''.'\''||tc.table_name AS child, kcu.column_name AS child_col, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = '\''FOREIGN KEY'\'' AND ccu.table_name = '\''nv_users'\''
ORDER BY child;
"' 2>&1
