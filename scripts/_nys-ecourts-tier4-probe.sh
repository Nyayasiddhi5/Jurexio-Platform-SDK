#!/usr/bin/env bash
# Tier-4 live eCourts status + opt-in resolve probe (caselaw-worker localhost).
set -uo pipefail
cd /opt/nyv/api || exit 1

KEY=$(node -e "
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  if (line.startsWith('NYS_SDK_API_KEYS=')) {
    const v=line.split('=').slice(1).join('=').trim().replace(/^[\"']|[\"']$/g,'');
    console.log(v.split(',')[0].trim()); break;
  }
}")

echo "=== ecourts-status (authed) ==="
curl -sS -H "X-API-Key: $KEY" http://127.0.0.1:8080/api/cnr/ecourts-status
echo ""
echo "=== live opt-in bogus CNR ==="
curl -sS -m 45 -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"cnr":"ZZZZNOTEXIST999999","options":{"live":true,"profile":"default"}}' \
  http://127.0.0.1:8080/api/cnr/resolve | python3 - <<'PY'
import json,sys
d=json.load(sys.stdin)
data=d.get("data") or {}
err=d.get("error") or {}
print("http_body status=", data.get("status"), "claimEcourts=", data.get("claimEcourts"), "badge=", (data.get("ui") or {}).get("badge"), "err=", err.get("code"))
PY
echo "ECOURTS_PROBE_DONE"
