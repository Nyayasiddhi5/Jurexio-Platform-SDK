#!/usr/bin/env bash
# Compare default vs caseCreate profiles — counts only, NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== CNR PROFILE COMPARE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

probe() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, fpath = sys.argv[1:5]
try:
    d = json.load(open(fpath))
    data = d.get('data') or {}
    fields = data.get('fields') or {}
    acts = fields.get('actsSections', {}).get('value') or []
    hearings = fields.get('hearings', {}).get('value') or []
    cc = data.get('caseCreate') or {}
    tl = cc.get('timeline') or []
    docs = data.get('documents') or []
    ep = data.get('extractPreview')
    field_keys = sorted(fields.keys()) if fields else []
    print(f"=== {label} http={code} ms={ms} status={data.get('status')} source={data.get('source')} ===")
    print(f"  fields_count={len(field_keys)} keys={field_keys}")
    print(f"  acts={len(acts) if isinstance(acts,list) else 0} hearings={len(hearings) if isinstance(hearings,list) else 0}")
    print(f"  caseCreate={'yes' if cc else 'no'} timeline={len(tl)} clients={len(cc.get('clients') or [])} manifest={bool(cc.get('fieldManifest'))}")
    print(f"  docs={len(docs)} extractPreview={'yes' if ep else 'no'} sourcesTried={data.get('sourcesTried')}")
    print(f"  cnr={data.get('cnr')!r} diary={data.get('diaryNumber')!r}")
except Exception as e:
    print(f"ERR {label} http={code} ms={ms} {e}")
PY
  rm -f "$tmp"
}

probe "TSWL_default" '{"cnr":"TSWL000000742024","options":{"profile":"default","includeDocuments":true}}'
probe "TSWL_caseCreate" '{"cnr":"TSWL000000742024","options":{"profile":"caseCreate","includeDocuments":true}}'
probe "diary_default" '{"diaryNumber":"173292025","options":{"courtType":"sc","profile":"default","includeDocuments":false}}'
probe "diary_caseCreate" '{"diaryNumber":"173292025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":true}}'
echo "=== PROBE DONE ==="
