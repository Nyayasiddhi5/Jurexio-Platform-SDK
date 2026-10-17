#!/usr/bin/env bash
# NV-BEDROCK-CLAUDE55-PROBE-001 — InvokeModel matrix on nysdev (gateway creds, no secret echo).
set -euo pipefail
echo "=== BEDROCK CLAUDE 5.5 PROBE (EC2) ==="

gw_container() {
  docker ps --format '{{.Names}}' | grep -E '(^|_)nyv-gateway$' | head -1
}

GW="$(gw_container || true)"
[ -n "$GW" ] || { echo "FATAL: no nyv-gateway container"; exit 1; }
echo "gateway_container=${GW}"

if [ -n "${NV_BEDROCK_CLAUDE55_PROBE:-}" ] && [ -f "$NV_BEDROCK_CLAUDE55_PROBE" ]; then
  docker cp "$NV_BEDROCK_CLAUDE55_PROBE" "${GW}:/app/scripts/jrx-bedrock-claude55-probe.mjs"
  docker exec -w /app "$GW" node scripts/jrx-bedrock-claude55-probe.mjs
  exit $?
fi

if docker exec "$GW" test -f /app/scripts/jrx-bedrock-claude55-probe.mjs 2>/dev/null; then
  docker exec -w /app "$GW" node scripts/jrx-bedrock-claude55-probe.mjs
  exit $?
fi

echo "FATAL: nyv-gateway missing or probe script not in image — deploy NV-BEDROCK-CLAUDE55-001 first"
exit 1
