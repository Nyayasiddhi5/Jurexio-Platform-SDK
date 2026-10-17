#!/usr/bin/env bash
# Probe NYV /api/jrx/v1/sdk/cnr/resolve with case-api flag (NV-SECRETS-001: no key values).
set -uo pipefail

API="${NYV_API_BASE:-https://api.nyayasiddhi.online}"
ENVF="${NYV_ENV_FILE:-/opt/Nyayavigya/secrets/.env.production}"

read_canon_key() {
  local k="$1"
  if [ -f "$ENVF" ]; then
    grep -E "^${k}=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' || true
  fi
}

NSP_KEY="$(read_canon_key NYV_SDK_KEY_NSP)"
CASE_FLAG="$(read_canon_key NYV_F_CASE_API_CNR)"
CASE_KEY_LEN="$(read_canon_key NYS_CASE_API_KEY | wc -c | tr -d ' ')"

echo "API=$API"
echo "NYV_F_CASE_API_CNR=${CASE_FLAG:-unset}"
echo "NYS_CASE_API_KEY_LEN=${CASE_KEY_LEN}"

probe_cnr() {
  local label="$1" body="$2"
  tmp=$(mktemp)
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 90 -X POST \
    -H "X-API-Key: $NSP_KEY" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "${API}/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" "POST resolve" <<'PY'
import json, sys
label, code, ms, path, route = sys.argv[1:6]
try:
    d = json.load(open(path))
    data = d.get('data') or {}
    cc = data.get('caseCreate') or {}
    tl = len(cc.get('timeline') or [])
    hearings = data.get('fields') or {}
    hlen = len((hearings.get('hearings') or {}).get('value') or [])
    meta = data.get('meta') or {}
    print(
        f"NYV_CNR {label} route={route} http={code} ms={ms} success={d.get('success')} "
        f"top_source={d.get('source')} status={data.get('status')} tier={data.get('source')} "
        f"meta_tier={meta.get('tier')} meta_source={meta.get('source')} "
        f"timeline={tl} hearings={hlen} claimEcourts={d.get('claimEcourts')}"
    )
except Exception as e:
    print(f"NYV_CNR {label} route={route} http={code} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

probe_cnr_get() {
  local label="$1" cnr="$2" qs="${3:-}"
  tmp=$(mktemp)
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 90 \
    -H "X-API-Key: $NSP_KEY" -H "X-NYV-Platform: nsp" \
    "${API}/api/jrx/v1/sdk/cnr/${cnr}${qs}" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" "GET :cnr" <<'PY'
import json, sys
label, code, ms, path, route = sys.argv[1:6]
try:
    d = json.load(open(path))
    data = d.get('data') or {}
    meta = data.get('meta') or {}
    print(
        f"NYV_CNR {label} route={route} http={code} ms={ms} success={d.get('success')} "
        f"top_source={d.get('source')} status={data.get('status')} tier={data.get('source')} "
        f"meta_tier={meta.get('tier')} meta_source={meta.get('source')} "
        f"claimEcourts={d.get('claimEcourts')}"
    )
except Exception as e:
    print(f"NYV_CNR {label} route={route} http={code} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

if [ "$(printf %s "$NSP_KEY" | wc -c | tr -d ' ')" -lt 8 ]; then
  echo "SKIP=no_nsp_key"
  exit 0
fi

for pair in \
  "TSWL|{\"cnr\":\"TSWL000000742024\",\"options\":{\"includeDocuments\":false}}" \
  "RJHC|{\"cnr\":\"RJHC010324382023\",\"options\":{\"includeDocuments\":false}}" \
  "GJHC|{\"cnr\":\"GJHC240256342024\",\"options\":{\"includeDocuments\":false}}" \
  "GJHC_cc|{\"cnr\":\"GJHC240256342024\",\"options\":{\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
  "ZZZZ|{\"cnr\":\"ZZZZ000000000000\",\"options\":{\"includeDocuments\":false}}"; do
  probe_cnr "${pair%%|*}" "${pair#*|}"
done

probe_cnr_get "GJHC_GET" "GJHC240256342024"
probe_cnr_get "TSWL_cc_GET" "TSWL000000742024" "?profile=caseCreate"
probe_cnr_get "ZZZZ_GET" "ZZZZ000000000000"

tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 60 \
  -H "X-API-Key: $NSP_KEY" -H "X-NYV-Platform: nsp" \
  "${API}/api/jrx/v1/sdk/cnr/search?court_type=HC&party_name=patel&page=1&page_size=3&want_total=false" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    data = d.get('data') or {}
    returned = data.get('returned') or len(data.get('cases') or [])
    print(f"NYV_CNR search_HC http={code} success={d.get('success')} top_source={d.get('source')} returned={returned}")
except Exception as e:
    print(f"NYV_CNR search_HC http={code} parse_err={e}")
PY
rm -f "$tmp"
