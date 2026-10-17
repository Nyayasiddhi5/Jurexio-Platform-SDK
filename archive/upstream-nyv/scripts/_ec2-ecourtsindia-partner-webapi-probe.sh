#!/usr/bin/env bash
# NV-ECOURTSINDIA-WEBAPI-PROBE-001 — from nysdev host, hit partner API using gateway env (no key echo).
set -euo pipefail
GW="${NYV_GATEWAY_CONTAINER:-nyv-gateway}"
KEY="$(docker exec "$GW" printenv NYV_ECOURTSINDIA_API_KEY 2>/dev/null | tr -d '\r\n' || true)"
echo "container_india_key_len=${#KEY}"
[ "${#KEY}" -gt 20 ] || { echo "ECOURTSINDIA_WEBAPI_PROBE=FAIL no_key"; exit 1; }
CNR="${1:-TSWL000000742024}"
BASE="https://webapi.ecourtsindia.com"
FAIL=0
for path in \
  "/api/partner/search/capabilities" \
  "/api/partner/enums" \
  "/api/partner/causelist/court-structure/states" \
  "/api/partner/acts/status" \
  "/api/partner/legal-check/models" \
  "/api/partner/search?q=${CNR}&page_size=1" \
  "/api/partner/case/${CNR}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${KEY}" \
    "${BASE}${path}")
  echo "GET ${path%%\?*} http=${code}"
  [ "$code" = "200" ] || FAIL=1
done
[ "$FAIL" -eq 0 ] && echo "ECOURTSINDIA_WEBAPI_PROBE=PASS" || { echo "ECOURTSINDIA_WEBAPI_PROBE=FAIL"; exit 1; }
