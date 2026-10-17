#!/usr/bin/env bash
# NV-DIARY-COURT-DEFAULT-001 — diary resolve without options.courtType (NV-SECRETS-001).
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

probe_json() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    status = data.get("status")
    source = data.get("source") or data.get("meta", {}).get("tier")
    diary = data.get("diaryNumber")
    cnr = data.get("cnr")
    print(f"PROBE {label} http={code} ms={ms} success={d.get('success')} status={status} source={source} diary={diary} cnr={cnr}")
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== DIARY COURT DEFAULT PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

probe_json "DIARY_17329_NO_COURT" \
  '{"diaryNumber":"17329/2025","options":{"profile":"caseCreate","includeDocuments":false}}'
probe_json "DIARY_17329_COURT_SC" \
  '{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":false}}'

echo "=== PROBE DONE ==="
