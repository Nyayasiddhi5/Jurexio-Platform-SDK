#!/usr/bin/env bash
# NV-USAGE-CACHE-SPLIT-001 — apply cache token columns on nysdev RDS.
set -euo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null || true)"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "admin_dsn_len=${#ADM}"

MIG="/tmp/2026-09-30-sdk-usage-metering-cache-tokens.sql"
cat > "$MIG" <<'SQL'
-- NV-USAGE-CACHE-SPLIT-001 — separate prompt-cache reads/writes in sdk_usage_metering.
ALTER TABLE sdk_usage_metering
  ADD COLUMN IF NOT EXISTS tokens_cache_read INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sdk_usage_metering
  ADD COLUMN IF NOT EXISTS tokens_cache_write INTEGER NOT NULL DEFAULT 0;
SQL

echo "=== before columns ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'sdk_usage_metering'"'"' AND column_name LIKE '"'"'tokens_cache%'"'"' ORDER BY 1;" 2>/dev/null || true
'

echo "=== applying migration ==="
docker run --rm --network host -v /tmp:/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /mig/2026-09-30-sdk-usage-metering-cache-tokens.sql' 2>&1 | tail -12

echo "=== after columns ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'sdk_usage_metering'"'"' AND column_name LIKE '"'"'tokens_cache%'"'"' ORDER BY 1;"
'
echo "=== done ==="
