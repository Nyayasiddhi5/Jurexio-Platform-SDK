#!/usr/bin/env bash
# User SC diary format probe — runs ON nysdev EC2. NV-SECRETS-001: no key echo.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NYSAPI="https://nysapi.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
CASE_API_KEY="$(read_canon_key NYS_CASE_API_KEY)"

DIARIES=(
  173292025
  508502026
  451552024
  444182026
  405312026
  73192026
  460242024
  467712026
  252932024
  465692024
)

probe_one() {
  local label="$1" timeout="$2" method="$3" url="$4" body="${5:-}" auth="${6:-nyv}"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  local curl_auth=()
  if [[ "$auth" == "nyv" ]]; then
    curl_auth=(-H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp")
  elif [[ "$auth" == "caseapi" ]]; then
    curl_auth=(-H "X-API-Key: $CASE_API_KEY")
  fi
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  if [[ "$method" == "POST" ]]; then
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" -X POST \
      "${curl_auth[@]}" -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null || echo ERR)
  else
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" \
      "${curl_auth[@]}" "$url" 2>/dev/null || echo ERR)
  fi
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
    source = data.get("source") or (data.get("meta") or {}).get("tier")
    title = None
    fields = data.get("fields") or {}
    if isinstance(fields.get("caseTitle"), dict):
        title = fields["caseTitle"].get("value")
    cases = data.get("cases") or []
    if not title and cases:
        title = cases[0].get("case_title")
    diary = data.get("diaryNumber") or (cases[0].get("diary_no") if cases else None)
    returned = data.get("returned") or len(cases)
    print(f"RESULT {label} http={code} ms={ms} success={d.get('success')} status={status} source={source} returned={returned} diary={diary} title={str(title)[:60] if title else None}")
except Exception as e:
    print(f"RESULT {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

normalize_compact() {
  python3 - "$1" <<'PY'
import sys, re
raw = sys.argv[1].strip()
if "/" in raw or not re.fullmatch(r"\d{6,12}", raw):
    print(raw)
    raise SystemExit(0)
year = int(raw[-4:])
if year < 1950 or year > 2100:
    print(raw)
    raise SystemExit(0)
num = raw[:-4].lstrip("0") or raw[:-4]
print(f"{num}/{year}")
PY
}

echo "=== USER SC DIARY FORMAT PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ') case_api_key_len=$(printf %s "$CASE_API_KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

for d in "${DIARIES[@]}"; do
  norm="$(normalize_compact "$d")"
  echo "--- diary=$d normalized=$norm ---"
  probe_one "NYV_RAW_${d}" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
    "{\"diaryNumber\":\"$d\",\"options\":{\"courtType\":\"sc\",\"profile\":\"caseCreate\",\"includeDocuments\":false}}"
  if [[ "$norm" != "$d" ]]; then
    probe_one "NYV_NORM_${d}" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
      "{\"diaryNumber\":\"$norm\",\"options\":{\"courtType\":\"sc\",\"profile\":\"caseCreate\",\"includeDocuments\":false}}"
  fi
  if [ "$(printf %s "$CASE_API_KEY" | wc -c)" -gt 8 ]; then
    enc_raw="${d//\//%2F}"
    enc_norm="${norm//\//%2F}"
    probe_one "NYSAPI_RAW_${d}" 30 GET \
      "$NYSAPI/v1/cases?court_type=SC&diary_no=$enc_raw&page_size=3" "" caseapi
    if [[ "$norm" != "$d" ]]; then
      probe_one "NYSAPI_NORM_${d}" 30 GET \
        "$NYSAPI/v1/cases?court_type=SC&diary_no=$enc_norm&page_size=3" "" caseapi
    fi
  fi
done

echo "=== PROBE DONE ==="
