#!/usr/bin/env bash
# NV-CNR-FIELDS-P0-001 live verify — field key presence only (NV-SECRETS-001).
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
KEY="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\"' )"
echo "=== P0 FIELDS PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CURRENT_DEPLOY=$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $KEY" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"cnr":"TSWL000000742024","options":{"profile":"caseCreate","includeDocuments":true}}' \
  "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys
code, fpath = sys.argv[1:3]
d = json.load(open(fpath))
data = d.get("data") or {}
fields = data.get("fields") or {}
docs = data.get("documents") or []
print(f"http={code} status={data.get('status')}")
print(f"summary_key={'summary' in fields}")
print(f"registrationDate_key={'registrationDate' in fields}")
print(f"partyDetails_key={'partyDetails' in fields}")
summary = (fields.get("summary") or {}).get("value") or ""
print(f"summary_nonempty={bool(str(summary).strip())}")
print(f"registrationDate_val={(fields.get('registrationDate') or {}).get('value')}")
pd = (fields.get("partyDetails") or {}).get("value") or []
print(f"partyDetails_len={len(pd) if isinstance(pd, list) else 0}")
print(f"expiresIn={docs[0].get('expiresIn') if docs else None}")
PY
rm -f "$tmp"
