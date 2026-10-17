#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
read -r -d '' SQL <<'PLSQL'
DO $$
DECLARE
  r RECORD;
  ids text[] := ARRAY(SELECT id::text FROM nv_users WHERE email ILIKE 'sme-smoke-%@example.com');
  delcount int;
BEGIN
  IF array_length(ids,1) IS NULL THEN RAISE NOTICE 'no stale users found'; RETURN; END IF;
  RAISE NOTICE 'stale user ids: %', ids;
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.column_name IN ('user_id','owner_id','created_by') AND c.table_name <> 'nv_users'
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE %I::text = ANY($1)', r.table_name, r.column_name) USING ids;
      GET DIAGNOSTICS delcount = ROW_COUNT;
      IF delcount > 0 THEN RAISE NOTICE 'deleted % rows from %.%', delcount, r.table_name, r.column_name; END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skipped %.% : %', r.table_name, r.column_name, SQLERRM;
    END;
  END LOOP;
  DELETE FROM nv_users WHERE id::text = ANY(ids);
  GET DIAGNOSTICS delcount = ROW_COUNT;
  RAISE NOTICE 'deleted % stale users', delcount;
END $$;
PLSQL
docker run --rm --network host -e PGURL="$ADM" -e SQL="$SQL" postgres:16-alpine \
  sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -c "$SQL"' 2>&1 | tail -40
echo "=== users after cleanup ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "
SELECT '\''TOTAL_USERS'\'', count(*) FROM nv_users;
SELECT '\''REMAINING_SMOKE'\'', count(*) FROM nv_users WHERE email ILIKE '\''sme-smoke-%@example.com'\'';
SELECT '\''USERS'\'', email, role FROM nv_users ORDER BY id;"' 2>&1
