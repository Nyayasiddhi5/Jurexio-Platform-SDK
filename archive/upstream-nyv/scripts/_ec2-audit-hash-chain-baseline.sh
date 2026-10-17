#!/usr/bin/env bash
set -euo pipefail
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null | tr -d '\r\n')"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "ADMIN_URL_LEN=${#ADM}"
TOTAL=$(docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -t -A -c "SELECT COUNT(*) FROM nv_schema.nv_audit_logs"' 2>/dev/null | tr -d '\r\n')
echo "table_total=${TOTAL}"
echo "=== hash_chain log tail ==="
docker logs nyv-gateway --since 4h 2>&1 | grep -E 'hash_chain_integrity_(ok|failure)' | tail -5 || echo "(none)"
echo "=== PROBE COMPLETE ==="
