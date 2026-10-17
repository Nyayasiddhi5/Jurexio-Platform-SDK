#!/usr/bin/env bash
# Read-only data-consistency probe (providers, statutes/courts by jurisdiction).
set +e
DBU="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"
if [ -z "$DBU" ]; then DBU="$(grep -E '^DATABASE_URL=' /app/.env 2>/dev/null | head -1 | sed -E 's/^DATABASE_URL=//')"; fi
DBU="${DBU%\"}"; DBU="${DBU#\"}"
DBU="$(echo "$DBU" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/')"
echo "URL_LEN=${#DBU}"
q() {
  docker run --rm --network host -e PGURL="$DBU" -e SQL="$1" postgres:16-alpine \
    sh -c 'psql "$PGURL" -At -F "|" -v ON_ERROR_STOP=0 -c "$SQL"' 2>&1
}
echo "=== nv_llm_providers regclass ==="
q "SELECT to_regclass('public.nv_llm_providers')::text;"
echo "=== nv_llm_providers rows ==="
q "SELECT count(*) FROM nv_llm_providers;"
echo "=== nv_model_catalog by provider ==="
q "SELECT provider_id, count(*) AS models, bool_or(is_active) AS any_active FROM nv_model_catalog GROUP BY 1 ORDER BY 1;"
echo "=== nv_statutes by jurisdiction ==="
q "SELECT UPPER(jurisdiction) AS j, count(*) FROM nv_statutes GROUP BY 1 ORDER BY 1;"
echo "=== nv_courts by jurisdiction ==="
q "SELECT UPPER(jurisdiction) AS j, count(*) FROM nv_courts GROUP BY 1 ORDER BY 1;"
