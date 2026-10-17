#!/usr/bin/env bash
# Apply migrations/2026-06-25-statutes-expansion.sql (now incl. Vol.5 IN + Vol.6 US) on RDS as admin.
set +e
REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
echo "=== repo: $REPO"
echo "=== migration header (expansion counts) ==="
head -3 "${REPO%/}/migrations/2026-06-25-statutes-expansion.sql"
echo "=== migration INSERT count ==="
grep -c "INSERT INTO" "${REPO%/}/migrations/2026-06-25-statutes-expansion.sql"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
echo "=== applying statutes-expansion migration"
docker run --rm --network host -v "${REPO%/}/migrations":/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /mig/2026-06-25-statutes-expansion.sql' 2>&1 | tail -6
echo "=== nv_statutes counts by jurisdiction ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT jurisdiction, count(*) FROM public.nv_statutes WHERE is_repealed=false GROUP BY jurisdiction ORDER BY 1;"' 2>&1
echo "=== nv_statutes total ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -c "SELECT count(*) FROM public.nv_statutes WHERE is_repealed=false;"' 2>&1
echo "=== distinct acts per jurisdiction ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT jurisdiction, count(DISTINCT act_short_title) FROM public.nv_statutes GROUP BY jurisdiction ORDER BY 1;"' 2>&1
