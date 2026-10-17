#!/usr/bin/env bash
# nysapi live endpoint probes — runs ON nysdev EC2. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NYSAPI="${NYS_CASE_API_BASE_URL:-https://nysapi.nyayasiddhi.online}"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

CASE_API_KEY="$(read_canon_key NYS_CASE_API_KEY)"
NSP_KEY="$(read_canon_key NYV_SDK_KEY_NSP)"
API="${NYV_API_BASE:-https://api.nyayasiddhi.online}"

echo "=== NYSAPI LIVE FRESHNESS $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "nysapi_base=$NYSAPI"
echo "case_api_key_len=$(printf %s "$CASE_API_KEY" | wc -c | tr -d ' ')"
echo "nsp_key_len=$(printf %s "$NSP_KEY" | wc -c | tr -d ' ')"

probe_http() {
  local label="$1" url="$2" auth="${3:-}"
  local tmp; tmp=$(mktemp)
  local hdr=()
  [ -n "$auth" ] && hdr=(-H "X-API-Key: $auth")
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 "${hdr[@]}" "$url" 2>/dev/null || echo ERR)
  local ms
  ms=$(curl -sS -o /dev/null -w '%{time_total}' --max-time 60 "${hdr[@]}" "$url" 2>/dev/null || echo 0)
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip().startswith(("{","[")) else {"raw": raw[:200]}
    keys = list(d.keys())[:8] if isinstance(d, dict) else []
    print(f"{label} http={code} latency_s={ms} keys={keys}")
    if label.startswith("HEALTH"):
        print(json.dumps(d, default=str)[:300])
except Exception as e:
    print(f"{label} http={code} latency_s={ms} parse_err={e} body={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

# nysapi health variants
for path in /health /healthz /v1/health /; do
  probe_http "NYSAPI_HEALTH${path//\//_}" "$NYSAPI$path" "$CASE_API_KEY"
done

probe_cnr() {
  local label="$1" cnr="$2" court="$3"
  local tmp; tmp=$(mktemp)
  local t0=$(python3 -c 'import time; print(int(time.time()*1000))')
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 \
    -H "X-API-Key: $CASE_API_KEY" \
    "$NYSAPI/v1/cases/$cnr" 2>/dev/null || echo ERR)
  local t1=$(python3 -c 'import time; print(int(time.time()*1000))')
  python3 - "$label" "$court" "$code" "$((t1-t0))" "$tmp" <<'PY'
import json, sys
label, court, code, ms, path = sys.argv[1:6]
try:
    d = json.load(open(path))
    c = d if isinstance(d, dict) and "cnr" in d else (d.get("case") or d.get("data") or d)
    print(
        f"NYSAPI_CNR {label} court={court} http={code} ms={ms} "
        f"cnr={c.get('cnr')} court_level={c.get('court_level')} "
        f"decision_date={c.get('decision_date')} filing_date={c.get('filing_date')} "
        f"status={c.get('case_status')} provenance={((c.get('provenance') or {}).get('backend'))}"
    )
except Exception as e:
    print(f"NYSAPI_CNR {label} court={court} http={code} ms={ms} err={e}")
PY
  rm -f "$tmp"
}

if [ "$(printf %s "$CASE_API_KEY" | wc -c)" -gt 8 ]; then
  probe_cnr "SC_SAMPLE" "SCIN010000000000" "SC" 2>/dev/null || true
  probe_cnr "HC_TSWL" "TSWL000000742024" "HC"
  probe_cnr "HC_RJHC" "RJHC010324382023" "HC"
  probe_cnr "HC_GJHC" "GJHC240256342024" "HC"
  probe_cnr "DC_SAMPLE" "DLCT010000000000" "DC" 2>/dev/null || true

  # Diary resolve SC
  tmp=$(mktemp)
  t0=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 \
    -H "X-API-Key: $CASE_API_KEY" \
    "$NYSAPI/v1/cases?court_type=SC&diary_no=17329%2F2025&page_size=1" 2>/dev/null || echo ERR)
  t1=$(python3 -c 'import time; print(int(time.time()*1000))')
  python3 - "$code" "$((t1-t0))" "$tmp" <<'PY'
import json, sys
code, ms, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    cases = d.get("cases") or []
    c = cases[0] if cases else {}
    print(f"NYSAPI_DIARY SC 17329/2025 http={code} ms={ms} returned={len(cases)} cnr={c.get('cnr')} diary_no={c.get('diary_no')} case_number={c.get('case_number')}")
except Exception as e:
    print(f"NYSAPI_DIARY err={e} http={code}")
PY
  rm -f "$tmp"
else
  echo "SKIP nysapi probes — no case api key"
fi

# NYV wrapper path
if [ "$(printf %s "$NSP_KEY" | wc -c)" -gt 8 ]; then
  for pair in "TSWL|HC" "RJHC|HC" "17329|DIARY"; do
    label="${pair%%|*}"; kind="${pair##*|}"
    tmp=$(mktemp)
    t0=$(python3 -c 'import time; print(int(time.time()*1000))')
    if [ "$kind" = "DIARY" ]; then
      body='{"diaryNumber":"17329/2025","options":{"courtType":"sc"}}'
    else
      body="{\"cnr\":\"${label}000000742024\",\"options\":{\"includeDocuments\":false}}"
      [ "$label" = "RJHC" ] && body='{"cnr":"RJHC010324382023","options":{"includeDocuments":false}}'
      [ "$label" = "TSWL" ] && body='{"cnr":"TSWL000000742024","options":{"includeDocuments":false}}'
    fi
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
      -H "X-API-Key: $NSP_KEY" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
    t1=$(python3 -c 'import time; print(int(time.time()*1000))')
    python3 - "$label" "$kind" "$code" "$((t1-t0))" "$tmp" <<'PY'
import json, sys
label, kind, code, ms, path = sys.argv[1:6]
try:
    d = json.load(open(path))
    data = d.get("data") or {}
    meta = data.get("meta") or {}
    print(f"NYV_CNR {label} kind={kind} http={code} ms={ms} success={d.get('success')} status={data.get('status')} tier={meta.get('tier')} source={data.get('source')}")
except Exception as e:
    print(f"NYV_CNR {label} http={code} ms={ms} err={e}")
PY
    rm -f "$tmp"
  done
fi

echo "=== NYSAPI PROBE DONE ==="
