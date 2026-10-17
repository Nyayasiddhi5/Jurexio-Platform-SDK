#!/usr/bin/env bash
# Read-only: nv_hc_order_s3_map location + count on nysdev gateway DB.
set -euo pipefail
echo "=== NV HC ORDER MAP COUNT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null || true)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
echo "admin_dsn_len=${#ADM}"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT current_database();"
psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_hc_order_s3_map;"
'
echo "=== DONE ==="
