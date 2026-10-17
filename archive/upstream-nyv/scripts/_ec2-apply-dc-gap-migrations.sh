#!/usr/bin/env bash
# NV-GAP-CLOSURE-DEPLOY-001 — apply 2026-09-25 DC gap migrations on NYV RDS (nysdev).
# Uses latest deploy tree under /opt/Nyayavigya/repo/ or S3 fallback (pre-deploy).
# Args: $1 = S3 bucket (optional), $2 = prefix (default migrations/2026-09-25-gap-closure)
set -euo pipefail
BUCKET="${1:-nyayavigya-sdk-devapp}"
PREFIX="${2:-migrations/2026-09-25-gap-closure}"
REGION="${NYV_AWS_REGION:-ap-south-1}"

REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
MIG1="${REPO:+${REPO%/}/migrations/2026-09-25-nv-dc-case-status-codes.sql}"
MIG2="${REPO:+${REPO%/}/migrations/2026-09-25-nv-dc-establishment-crosswalk.sql}"

echo "=== NV DC gap migrations apply $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "repo=${REPO:-NONE} bucket=${BUCKET:-none}"

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null || true)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "admin_dsn_len=${#ADM}"

fetch_mig() {
  local name="$1"
  local dest="/tmp/$name"
  if [ -n "${REPO:-}" ] && [ -f "${REPO%/}/migrations/$name" ]; then
    cp "${REPO%/}/migrations/$name" "$dest"
    echo "source=repo file=$name"
    return 0
  fi
  if [ -n "$BUCKET" ]; then
    aws s3 cp "s3://$BUCKET/$PREFIX/$name" "$dest" --region "$REGION"
    echo "source=s3 file=$name"
    return 0
  fi
  echo "MIGRATION_MISSING name=$name"
  exit 4
}

fetch_mig "2026-09-25-nv-dc-case-status-codes.sql"
fetch_mig "2026-09-25-nv-dc-establishment-crosswalk.sql"

echo "=== before (tables may not exist) ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT to_regclass('"'"'public.nv_dc_case_status_codes'"'"');" 2>/dev/null || true
psql "$PGURL" -At -c "SELECT to_regclass('"'"'public.nv_dc_establishment_crosswalk'"'"');" 2>/dev/null || true
'

for f in 2026-09-25-nv-dc-case-status-codes.sql 2026-09-25-nv-dc-establishment-crosswalk.sql; do
  echo "=== applying $f ==="
  docker run --rm --network host -v /tmp:/mig -e PGURL="$ADM" postgres:16-alpine \
    sh -c "psql \"\$PGURL\" -v ON_ERROR_STOP=1 -f /mig/$f" 2>&1 | tail -8
done

echo "=== after counts ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT COUNT(*) AS dc_status_codes FROM public.nv_dc_case_status_codes;"
psql "$PGURL" -At -c "SELECT COUNT(*) AS crosswalk_rows FROM public.nv_dc_establishment_crosswalk;"
psql "$PGURL" -At -c "SELECT state_letters, estab_letters, state_code, district_code, complex_code, court_code FROM public.nv_dc_establishment_crosswalk WHERE state_letters='"'"'TS'"'"' AND estab_letters='"'"'WL'"'"';"
'
echo "=== done ==="
