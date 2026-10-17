#!/usr/bin/env bash
# Session-79 / NV-GAP-CLOSURE-DEPLOY-001 — parse guide + DC TSWL spot-check. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== SESSION79 GAP VERIFY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

resolve_probe() {
  local label="$1"
  local body="$2"
  local tmp
  tmp=$(mktemp)
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  python3 - "$label" "$code" "$tmp" <<'PY'
import json, sys
label, code, path = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(path))
data = d.get("data") or {}
fields = data.get("fields") or {}
guide = data.get("nspParseGuide") or {}
print(f"--- {label} ---")
print(f"http={code} status={data.get('status') or '-'}")
print(f"nspParseGuide_keys={len(guide)}")
if guide:
    print(f"sample_guide_key=linkedMatters cardinality={(guide.get('linkedMatters') or {}).get('cardinality')}")
lm = fields.get("linkedMatters") or {}
print(f"linkedMatters_present={'value' in lm}")
inc = fields.get("incidentDate") or {}
print(f"incidentDate_value={inc.get('value')!r}")
cc = fields.get("courtCode") or {}
cx = fields.get("complexCode") or {}
print(f"courtCode={cc.get('value')!r} source={cc.get('source')}")
print(f"complexCode={cx.get('value')!r} source={cx.get('source')}")
PY
  rm -f "$tmp"
}

# Parse guide (APHC — fast HC corpus hit)
resolve_probe "parse-guide-aphc" \
  '{"identifier":"APHC010000832023","options":{"includeParseGuide":true},"includeTimeline":false,"includeDocuments":false}'

# DC TSWL sample from demo probe corpus
resolve_probe "dc-tswl" \
  '{"identifier":"TSWL000000742024","profile":"default","options":{"includeParseGuide":false},"includeTimeline":false,"includeDocuments":false}'
