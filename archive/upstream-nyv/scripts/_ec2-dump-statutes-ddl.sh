#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1; }
echo "=== columns ==="
runq "SELECT column_name||' | '||data_type||' | nullable='||is_nullable||' | default='||COALESCE(column_default,'(none)') FROM information_schema.columns WHERE table_schema='public' AND table_name='nv_statutes' ORDER BY ordinal_position;"
echo "=== indexes/constraints ==="
runq "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='nv_statutes';"
echo "=== sequence owned ==="
runq "SELECT c.relname FROM pg_class c WHERE c.relkind='S' AND c.relname LIKE 'nv_statutes%';"
