#!/usr/bin/env bash
# NV-ECOURTSINDIA-PROBE-001 — partner WebAPI smoke (key from env only; never print value).
set -euo pipefail
KEY="${NYV_ECOURTSINDIA_API_KEY:-${NYV_ECOURTS_API_KEY:-}}"
KEY="$(printf '%s' "$KEY" | tr -d '\r\n')"
echo "key_len=${#KEY}"
[ "${#KEY}" -gt 20 ] || { echo "FATAL: set NYV_ECOURTSINDIA_API_KEY"; exit 1; }
CNR="${1:-TSWL000000742024}"
BASE="${NYV_ECOURTSINDIA_BASE_URL:-https://webapi.ecourtsindia.com}"
BASE="${BASE%/}"

probe_get() {
  local path="$1"
  local code
  code=$(curl -sS -o /tmp/eci_probe.json -w '%{http_code}' \
    -H "Authorization: Bearer ${KEY}" \
    -H "Accept: application/json" \
    "${BASE}${path}")
  echo "GET ${path} http=${code}"
  [ "$code" = "200" ] || return 1
}

FAIL=0
probe_get "/api/partner/search/capabilities" || FAIL=1
probe_get "/api/partner/enums" || FAIL=1
probe_get "/api/partner/causelist/court-structure/states" || FAIL=1
probe_get "/api/partner/acts/status" || FAIL=1
probe_get "/api/partner/legal-check/models" || FAIL=1
probe_get "/api/partner/search?q=${CNR}&page_size=1" || FAIL=1
probe_get "/api/partner/case/${CNR}" || FAIL=1

if [ "$FAIL" -ne 0 ]; then
  echo "ECOURTSINDIA_PROBE=FAIL"
  exit 1
fi
echo "ECOURTSINDIA_PROBE=PASS"
