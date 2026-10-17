#!/usr/bin/env bash
# NV-ECOURTSINDIA-CNR-PROBE-001 — resolve via gateway after India tier enabled.
set -euo pipefail
CNR="${1:-TSWL000000742024}"
NSP_KEY="$(grep -E '^NYV_SDK_KEY_NSP=' /opt/Nyayavigya/secrets/.env.production | head -1 | sed 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//')"
echo "NSP_key_len=${#NSP_KEY}"
HTTP="$(curl -sS -o /tmp/eci_cnr_resolve.json -w '%{http_code}' \
  -H "X-API-Key: ${NSP_KEY}" \
  -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"${CNR}\",\"options\":{\"profile\":\"default\",\"courtType\":\"dc\"}}" \
  http://127.0.0.1:5000/api/jrx/v1/sdk/cnr/resolve)"
echo "cnr_resolve_http=${HTTP}"
python3 - <<'PY'
import json
d=json.load(open("/tmp/eci_cnr_resolve.json"))
data=d.get("data") or {}
print("status", data.get("status"), "source", data.get("source"))
print("sourcesTried", (data.get("sourcesTried") or [])[:6])
print("claimEcourts", data.get("claimEcourts"))
PY
curl -sS -o /tmp/cnr_health.json -w 'cnr_health_http=%{http_code}\n' \
  -H "X-API-Key: ${NSP_KEY}" http://127.0.0.1:5000/api/jrx/v1/sdk/cnr/health
python3 - <<'PY'
import json
d=json.load(open("/tmp/cnr_health.json"))
data=d.get("data") or {}
case_api=data.get("caseApi") or {}
eci=data.get("ecourtsIndia") or {}
print("caseApi_ecourtsLiveFetch", case_api.get("ecourtsLiveFetch"))
print("ecourtsIndia", eci)
PY
