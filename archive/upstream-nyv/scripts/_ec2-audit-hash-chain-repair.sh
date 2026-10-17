#!/usr/bin/env bash
# EC2 diagnose/repair for nv_audit_logs hash chain (GAP-002 / UAT-SEC-002).
# Keys stay on EC2 — reads DATABASE_URL_ADMIN from gateway container / canonical env.
set -euo pipefail

MODE="${1:-diagnose}"
CANON="/opt/Nyayavigya/secrets/.env.production"
DEPLOY_ROOT="$(ls -dt /opt/nyayavigya/repo/*/ 2>/dev/null | head -1)"
DEPLOY_ROOT="${DEPLOY_ROOT%/}"

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null | tr -d '\r\n')"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/')"

if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "ADMIN_URL_LEN=${#ADM}"
echo "deploy_root=${DEPLOY_ROOT:-none} mode=${MODE}"

if [ -z "$DEPLOY_ROOT" ] || [ ! -f "$DEPLOY_ROOT/scripts/jrx-audit-hash-chain-repair.ts" ]; then
  echo "FATAL: repair script not in current deploy — run full deploy first"
  exit 4
fi

EXTRA=""
case "$MODE" in
  diagnose) EXTRA="--diagnose" ;;
  repair)   EXTRA="--repair" ;;
  *) echo "usage: $0 [diagnose|repair]"; exit 2 ;;
esac

docker exec -e DATABASE_URL_ADMIN="$ADM" nyv-gateway \
  npx tsx "/app/scripts/jrx-audit-hash-chain-repair.ts" $EXTRA --full

echo "=== gateway hash_chain log tail (4h window approx) ==="
docker logs nyv-gateway --since 4h 2>&1 | grep -E 'hash_chain_integrity_(ok|failure)' | tail -5 || echo "(no hash_chain lines in last 4h)"

echo "=== health ==="
curl -sS -o /dev/null -w 'health_http=%{http_code} ms=%{time_total}\n' http://127.0.0.1:5000/api/jrx/health || true

echo "=== PROBE COMPLETE ==="
