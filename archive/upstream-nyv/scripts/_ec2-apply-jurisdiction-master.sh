#!/usr/bin/env bash
# NV-CASE-MASTER-DATA-001 — apply migrations/2026-09-24-nv-jurisdiction-master.sql on NYV RDS (nysdev).
set -euo pipefail
REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
MIGFILE="2026-09-24-nv-jurisdiction-master.sql"
MIGPATH="${REPO%/}/migrations/$MIGFILE"
echo "=== NV jurisdiction master apply $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "repo=${REPO:-NONE}"

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "admin_dsn_len=${#ADM}"

if [ ! -f "$MIGPATH" ]; then
  echo "MIGRATION_MISSING path=$MIGPATH"
  exit 4
fi

echo "=== before counts (tables may not exist) ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT to_regclass('"'"'public.nv_cnr_prefix_rules'"'"');" 2>/dev/null || true
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_cnr_prefix_rules;" 2>/dev/null || echo "prefix_rules_count=NA"
'

echo "=== applying $MIGFILE ==="
docker run --rm --network host -v "$(dirname "$MIGPATH")":/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c "psql \"\$PGURL\" -v ON_ERROR_STOP=1 -f /mig/$(basename "$MIGPATH")" 2>&1 | tail -30

echo "=== after counts ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_cnr_prefix_rules;"
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_court_jurisdictions;"
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_case_type_codes;"
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_district_master;"
psql "$PGURL" -At -c "SELECT cnr_prefix, court_type, state_code FROM public.nv_cnr_prefix_rules WHERE cnr_prefix='"'"'APHC'"'"';"
'

echo "=== done ==="
