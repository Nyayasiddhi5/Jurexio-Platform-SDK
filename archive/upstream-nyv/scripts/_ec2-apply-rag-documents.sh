#!/usr/bin/env bash
# Apply migrations/2026-06-26-rag-documents.sql on RDS as admin, then verify.
set +e
REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
echo "=== repo: $REPO"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
MIG="${REPO%/}/migrations/2026-06-26-rag-documents.sql"
echo "=== applying rag-documents migration"
docker run --rm --network host -v "${REPO%/}/migrations":/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /mig/2026-06-26-rag-documents.sql' 2>&1 | tail -10
echo "=== verify rag_documents exists + nv_app can read"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT to_regclass('"'"'public.rag_documents'"'"'), count(*) FROM rag_documents;"' 2>&1
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT '"'"'app_read'"'"', count(*) FROM public.rag_documents;"' 2>&1
