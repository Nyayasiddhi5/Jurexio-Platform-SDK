#!/usr/bin/env bash
# Session-77 post-deploy: APHC010000832023 resolve field spot-check. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== SESSION77 APHC PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
BODY='{"identifier":"APHC010000832023","profile":"caseCreate","includeTimeline":false,"includeDocuments":false}'
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d "$BODY" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))
data = d.get("data") or {}
fields = data.get("fields") or {}
status = data.get("status") or "-"
meta = data.get("meta") or {}

def fv(key):
    f = fields.get(key) or {}
    v = f.get("value")
    src = f.get("source")
    return v, src

nh, nh_src = fv("nextHearingDate")
ct, ct_src = fv("courtType")
cn, cn_src = fv("courtName")
sn, sn_src = fv("stateName")
hcd = fields.get("hcCategoryDetails") or {}
hcd_v = hcd.get("value")
fo = fields.get("finalOrders") or {}
fo_n = len(fo.get("value") or []) if isinstance(fo.get("value"), list) else 0
print(f"http={code} status={status}")
print(f"nextHearingDate={nh!r} source={nh_src}")
print(f"courtType={ct!r} source={ct_src}")
print(f"courtName={cn!r} source={cn_src}")
print(f"stateName={sn!r} source={sn_src}")
print(f"hcCategoryDetails_present={hcd_v is not None}")
print(f"finalOrders_count={fo_n}")
print(f"fieldAvailability_keys={sorted((meta.get('fieldAvailability') or {}).keys())[:8]}")
PY
rm -f "$tmp"
