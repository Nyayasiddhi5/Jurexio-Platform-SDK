#!/usr/bin/env bash
# NYS-Search case-api E2E probe — localhost:8090 + public nysapi HTTPS.
# NV-SECRETS-001: never echo secret values; key lens = length only.
set -uo pipefail

probe_get() {
  local label="$1"; local url="$2"; local key="${3:-}"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  local hdr=()
  if [ -n "$key" ]; then hdr=(-H "X-API-Key: $key"); fi
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 "${hdr[@]}" "$url" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path, encoding='utf-8', errors='replace').read()
    j = json.loads(raw)
except Exception:
    print(f"PROBE {label} http={code} ms={ms} parse=non_json size={len(raw) if 'raw' in dir() else '?'}")
    sys.exit(0)

def count_fields(o):
    if isinstance(o, dict):
        return sum(count_fields(v) for v in o.values()) + len(o)
    if isinstance(o, list):
        return sum(count_fields(x) for x in o)
    return 0

hearings = acts = 0
status = court = cnr = backend = None
parties = {}
if isinstance(j, dict):
    if 'cases' in j and isinstance(j['cases'], list) and j['cases']:
        c = j['cases'][0]
        hearings = len(c.get('hearings') or [])
        acts = (c.get('counts') or {}).get('acts', 0)
        status = c.get('case_status')
        court = c.get('court_level')
        cnr = c.get('cnr')
        parties = {'petitioner': (c.get('petitioner') or '')[:30], 'respondent': (c.get('respondent') or '')[:30]}
        backend = (c.get('provenance') or {}).get('backend')
    elif 'cnr' in j or 'case_status' in j:
        hearings = len(j.get('hearings') or [])
        acts = (j.get('counts') or {}).get('acts', 0)
        status = j.get('case_status')
        court = j.get('court_level')
        cnr = j.get('cnr')
        parties = {'petitioner': (j.get('petitioner') or '')[:30], 'respondent': (j.get('respondent') or '')[:30]}
        backend = (j.get('provenance') or {}).get('backend')
    elif 'events' in j:
        hearings = len(j.get('events') or [])
    elif j.get('status') == 'ok':
        backend = f"table={j.get('table_version')} rds={j.get('rds_enabled')}"
    elif 'data' in j:
        d = j['data'] or {}
        status = d.get('status')
        backend = d.get('source')
        cnr = d.get('cnr')

print(
    f"PROBE {label} http={code} ms={ms} fields={count_fields(j)} "
    f"hearings={hearings} acts={acts} status={status!r} court={court!r} "
    f"cnr={cnr!r} backend={backend!r} parties={parties}"
)
PY
  rm -f "$tmp"
}

# Discover case-api key on box (names only in output)
CASE_KEY=""
for envfile in /etc/systemd/system/case-api-duckdb.service.d/*.conf /home/ec2-user/scripts/build/start_api_with_rds.sh /opt/nyv/api/.env; do
  [ -f "$envfile" ] || continue
  if grep -qE 'CASE_API|NYSAPI|API_KEY' "$envfile" 2>/dev/null; then
    echo "KEYFILE_CANDIDATE=$envfile"
  fi
done
# common env locations
for var in CASE_API_PUBLIC_KEY CASE_API_API_KEY NYSAPI_KEY API_KEY; do
  val="${!var:-}"
  if [ -n "$val" ]; then CASE_KEY="$val"; echo "KEY_SOURCE=$var len=$(printf %s "$val" | wc -c | tr -d ' ')"; break; fi
done
if [ -z "$CASE_KEY" ] && [ -f /opt/nyv/api/.env ]; then
  CASE_KEY=$(grep -E '^NYS_SDK_API_KEYS=' /opt/nyv/api/.env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'' ]+//; s/["'\'' ,].*$//' || true)
  echo "KEY_SOURCE=NYS_SDK_API_KEYS len=$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')"
fi

echo "=== LOCAL 8090 (case-api, no auth per handover) ==="
probe_get "health-8090" "http://127.0.0.1:8090/health"
probe_get "cnr-TSWL" "http://127.0.0.1:8090/v1/cases/TSWL000000742024"
probe_get "cnr-RJHC" "http://127.0.0.1:8090/v1/cases/RJHC010324382023"
probe_get "cnr-GJHC" "http://127.0.0.1:8090/v1/cases/GJHC240256342024"
probe_get "cnr-negative" "http://127.0.0.1:8090/v1/cases/ZZZZ000000000000"
probe_get "search-DC-party" "http://127.0.0.1:8090/v1/cases?court_type=DC&party_name=kumar&page=1&page_size=5&want_total=false"
probe_get "search-HC-party" "http://127.0.0.1:8090/v1/cases?court_type=HC&party_name=singh&page=1&page_size=5&want_total=false"
probe_get "timeline-GJHC" "http://127.0.0.1:8090/v1/cases/GJHC240256342024/timeline"

echo "=== PUBLIC nysapi HTTPS ==="
probe_get "health-public" "https://nysapi.nyayasiddhi.online/health"
if [ "$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')" -gt 8 ]; then
  probe_get "cnr-TSWL-public" "https://nysapi.nyayasiddhi.online/v1/cases/TSWL000000742024" "$CASE_KEY"
  probe_get "cnr-RJHC-public" "https://nysapi.nyayasiddhi.online/v1/cases/RJHC010324382023" "$CASE_KEY"
  probe_get "cnr-GJHC-public" "https://nysapi.nyayasiddhi.online/v1/cases/GJHC240256342024" "$CASE_KEY"
  probe_get "cnr-negative-public" "https://nysapi.nyayasiddhi.online/v1/cases/ZZZZ000000000000" "$CASE_KEY"
  probe_get "search-DC-public" "https://nysapi.nyayasiddhi.online/v1/cases?court_type=DC&party_name=kumar&page=1&page_size=5&want_total=false" "$CASE_KEY"
  probe_get "timeline-GJHC-public" "https://nysapi.nyayasiddhi.online/v1/cases/GJHC240256342024/timeline" "$CASE_KEY"
else
  echo "PUBLIC_SKIP=no_case_api_key_on_box"
fi

echo "=== LEGACY nyv-api 8080 CNR resolve (NSP contract) ==="
NYS_KEY=$(grep -E '^NYS_SDK_API_KEYS=' /opt/nyv/api/.env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'' ]+//; s/["'\'' ,].*$//' || true)
echo "NYS8080_KEY_LEN=$(printf %s "$NYS_KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$NYS_KEY" | wc -c | tr -d ' ')" -gt 8 ]; then
  for pair in "TSWL_default|{\"cnr\":\"TSWL000000742024\",\"options\":{\"includeDocuments\":false}}" \
              "RJHC_default|{\"cnr\":\"RJHC010324382023\",\"options\":{\"includeDocuments\":false}}" \
              "RJHC_caseCreate|{\"cnr\":\"RJHC010324382023\",\"options\":{\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
              "GJHC_default|{\"cnr\":\"GJHC240256342024\",\"options\":{\"includeDocuments\":false}}" \
              "ZZZZ_negative|{\"cnr\":\"ZZZZ000000000000\",\"options\":{\"includeDocuments\":false}}"; do
    label="${pair%%|*}"; body="${pair#*|}"
    tmp=$(mktemp)
    start=$(python3 -c 'import time; print(int(time.time()*1000))')
    code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 90 -X POST \
      -H "X-API-Key: $NYS_KEY" -H "Content-Type: application/json" \
      -d "$body" "http://127.0.0.1:8080/api/cnr/resolve" 2>/dev/null || echo ERR)
    end=$(python3 -c 'import time; print(int(time.time()*1000))')
    ms=$((end - start))
    python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json,sys
label,code,ms,path=sys.argv[1:5]
try:
 d=json.load(open(path))
 data=d.get('data') or {}
 cc=data.get('caseCreate') or {}
 tl=len(cc.get('timeline') or [])
 print(f"CNR8080 {label} http={code} ms={ms} status={data.get('status')} source={data.get('source')} match={data.get('matchType')} timeline={tl} fields={len(data.get('fields') or {})}")
except Exception as e:
 print(f"CNR8080 {label} http={code} ms={ms} parse_err={e}")
PY
    rm -f "$tmp"
  done
fi

echo "=== SERVICE STATUS ==="
systemctl is-active case-api-duckdb.service 2>/dev/null || echo "case-api-duckdb=unknown"
systemctl is-active nyv-api.service 2>/dev/null || echo "nyv-api=unknown"
ss -tlnp 2>/dev/null | grep -E ':8090|:8080' || netstat -tlnp 2>/dev/null | grep -E ':8090|:8080' || true
