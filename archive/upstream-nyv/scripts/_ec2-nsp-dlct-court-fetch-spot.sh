#!/usr/bin/env bash
# NSP escalation spot — NYV gateway + corpus + DLCT court-fetch (CNR resolve).
# Runs ON nysdev EC2. NV-SECRETS-001: key length only, no secret values.
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
CNR="DLCT010000012024"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

echo "=== NSP DLCT COURT-FETCH SPOT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "gateway=$(docker inspect nyv-gateway --format '{{.State.Status}}' 2>/dev/null || echo missing)"
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

pass=1
mark() {
  local label="$1" code="$2" expect="$3"
  if [ "$code" = "$expect" ]; then
    echo "PASS $label http=$code"
  else
    echo "FAIL $label http=$code expect=$expect"
    pass=0
  fi
}

tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 20 "$API/api/jrx/health" 2>/dev/null || echo ERR)
mark "nyv_health" "$code" "200"
rm -f "$tmp"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then
  echo "FAIL nsp_key missing_in_canon"
  exit 2
fi

tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
  "$API/api/jrx/knowledge/caselaw/search?q=DLCT010000012024&mode=fts&limit=2" 2>/dev/null || echo ERR)
mark "nyv_corpus_caselaw_fts" "$code" "200"
rm -f "$tmp"

tmp=$(mktemp)
start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d "{\"cnr\":\"$CNR\",\"claimEcourts\":false}" \
  "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
ms=$((end_ms - start_ms))

python3 - "$CNR" "$code" "$ms" "$tmp" <<'PY'
import json, sys
cnr, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    fields = data.get("fields") or {}
    fd = (fields.get("filingDate") or {}).get("value")
    dd = (fields.get("decisionDate") or {}).get("value")
    ct = (fields.get("courtType") or {}).get("value")
    print(
        f"COURT_FETCH cnr={cnr} http={code} ms={ms} success={d.get('success')} "
        f"status={data.get('status')} source={data.get('source')} "
        f"courtType={ct} filingDate={fd} decisionDate={dd} "
        f"err={(d.get('error') or {}).get('code')}"
    )
    if code != "200":
        sys.exit(1)
    if not d.get("success") and data.get("status") not in ("found", "suggested"):
        sys.exit(1)
except Exception as e:
    print(f"COURT_FETCH cnr={cnr} http={code} ms={ms} parse_err={e}")
    sys.exit(1)
PY
cf=$?
if [ "$code" != "200" ] || [ "$cf" -ne 0 ]; then
  echo "FAIL court_fetch_dlct_resolve http=$code"
  pass=0
else
  echo "PASS court_fetch_dlct_resolve http=200"
fi
rm -f "$tmp"

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fi
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 45 \
    -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/$CNR" 2>/dev/null || echo ERR)
  python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    c = d.get("case") or {}
    print(f"NYSAPI cases/{c.get('cnr','?')} http={code} court_level={c.get('court_level')} filing_date={c.get('filing_date')} decision_date={c.get('decision_date')}")
except Exception as e:
    print(f"NYSAPI http={code} parse_err={e}")
PY
  mark "nysapi_v1_cases_dlct" "$code" "200"
  rm -f "$tmp"
else
  echo "SKIP nysapi_local (no case_api key in proc env)"
fi

if [ "$pass" -eq 1 ]; then
  echo "=== SPOT VERDICT: PASS (no 502/503 on NYV health, corpus FTS, DLCT court-fetch) ==="
  exit 0
fi
echo "=== SPOT VERDICT: FAIL ==="
exit 1
