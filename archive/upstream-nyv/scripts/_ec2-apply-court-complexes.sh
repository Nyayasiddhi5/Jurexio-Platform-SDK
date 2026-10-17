#!/usr/bin/env bash
# NV-COURT-MASTER-P0-001 — apply nv_court_complexes DDL + seed on NYV RDS (nysdev).
# Runs on the EC2 host via SSM. Downloads the generated seed SQL (DDL + upserts)
# from the deploy S3 bucket and applies it idempotently against the gateway's
# admin Postgres DSN. Reference data only — never touches secrets or SDK keys
# (NV-DEMO-SESSION-001), never sets claimEcourts.
#
# Args: $1 = S3 bucket, $2 = S3 key, $3 = AWS region (default ap-south-1)
set -euo pipefail
BUCKET="${1:?bucket required}"
KEY="${2:?key required}"
REGION="${3:-ap-south-1}"
echo "=== NV court-complexes apply $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "s3://$BUCKET/$KEY region=$REGION"

aws s3 cp "s3://$BUCKET/$KEY" /tmp/jrx-ccx-seed.sql.gz --region "$REGION"
gunzip -f /tmp/jrx-ccx-seed.sql.gz
echo "sql_bytes=$(wc -c </tmp/jrx-ccx-seed.sql)"

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null || true)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "admin_dsn_len=${#ADM}"

echo "=== before count (table may not exist) ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_court_complexes;" 2>/dev/null || echo "count=NA(new table)"'

echo "=== applying DDL + seed ==="
docker run --rm --network host -v /tmp:/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /mig/jrx-ccx-seed.sql' 2>&1 | tail -6

echo "=== after counts ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT COUNT(*) AS complexes FROM public.nv_court_complexes;"
psql "$PGURL" -At -c "SELECT COUNT(DISTINCT (state_code, district_code)) AS districts FROM public.nv_court_complexes;"
psql "$PGURL" -At -c "SELECT COUNT(DISTINCT state_code) AS states FROM public.nv_court_complexes;"
psql "$PGURL" -At -c "SELECT COUNT(*) AS prefix_rules_unchanged FROM public.nv_cnr_prefix_rules;"
'
echo "=== done ==="
