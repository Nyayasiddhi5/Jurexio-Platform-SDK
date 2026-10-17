#!/usr/bin/env bash
# Authenticated nysapi E2E using CASE_API_API_KEYS from running uvicorn (no echo of values).
set -uo pipefail

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -z "$pid" ]; then echo "ERR no uvicorn pid"; exit 1; fi

CASE_KEY=""
while IFS= read -r line; do
  case "$line" in
    CASE_API_API_KEYS=*)
      CASE_KEY="${line#CASE_API_API_KEYS=}"
      CASE_KEY="${CASE_KEY%%,*}"
      break
      ;;
  esac
done < <(tr '\0' '\n' < "/proc/$pid/environ")

echo "AUTH_KEY_LEN=$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')"
echo "REQUIRE_AUTH=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_REQUIRE_AUTH=' | cut -d= -f2-)"

probe_get() {
  local label="$1"; local url="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 \
    -H "X-API-Key: $CASE_KEY" "$url" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
raw = open(path, encoding='utf-8', errors='replace').read()
try:
    j = json.loads(raw)
except Exception:
    print(f"AUTH {label} http={code} ms={ms} non_json size={len(raw)}")
    sys.exit(0)

def count_fields(o):
    if isinstance(o, dict):
        return sum(count_fields(v) for v in o.values()) + len(o)
    if isinstance(o, list):
        return sum(count_fields(x) for x in o)
    return 0

hearings = acts = returned = 0
status = court = cnr = backend = error = None
parties = {}
if isinstance(j, dict):
    if 'cases' in j:
        returned = j.get('returned') or len(j.get('cases') or [])
        if j.get('cases'):
            c0 = j['cases'][0]
            hearings = len(c0.get('hearings') or [])
            acts = (c0.get('counts') or {}).get('acts', 0)
            status = c0.get('case_status')
            court = c0.get('court_level')
            cnr = c0.get('cnr')
            parties = {'petitioner': (c0.get('petitioner') or '')[:35], 'respondent': (c0.get('respondent') or '')[:35]}
            backend = (c0.get('provenance') or {}).get('backend')
    elif 'events' in j:
        hearings = len(j.get('events') or [])
        cnr = j.get('cnr')
    elif j.get('error'):
        error = j.get('error')
    else:
        hearings = len(j.get('hearings') or [])
        acts = (j.get('counts') or {}).get('acts', 0)
        status = j.get('case_status')
        court = j.get('court_level')
        cnr = j.get('cnr')
        parties = {'petitioner': (j.get('petitioner') or '')[:35], 'respondent': (j.get('respondent') or '')[:35]}
        backend = (j.get('provenance') or {}).get('backend')

print(
    f"AUTH {label} http={code} ms={ms} fields={count_fields(j)} returned={returned} "
    f"hearings={hearings} acts={acts} status={status!r} court={court!r} cnr={cnr!r} "
    f"backend={backend!r} error={error!r} parties={parties}"
)
PY
  rm -f "$tmp"
}

BASE_LOCAL="http://127.0.0.1:8090"
BASE_PUB="https://nysapi.jurexio.com"

echo "=== LOCAL 8090 authenticated ==="
probe_get "cnr-TSWL" "$BASE_LOCAL/v1/cases/TSWL000000742024"
probe_get "cnr-RJHC" "$BASE_LOCAL/v1/cases/RJHC010324382023"
probe_get "cnr-GJHC" "$BASE_LOCAL/v1/cases/GJHC240256342024"
probe_get "cnr-negative" "$BASE_LOCAL/v1/cases/ZZZZ000000000000"
probe_get "search-DC-party" "$BASE_LOCAL/v1/cases?court_type=DC&party_name=kumar&page=1&page_size=5&want_total=false"
probe_get "search-HC-party" "$BASE_LOCAL/v1/cases?court_type=HC&party_name=singh&page=1&page_size=5&want_total=false"
probe_get "search-SC-diary" "$BASE_LOCAL/v1/cases?court_type=SC&diary_no=17329/2025&page=1&page_size=5&want_total=false"
probe_get "timeline-GJHC" "$BASE_LOCAL/v1/cases/GJHC240256342024/timeline"

echo "=== PUBLIC nysapi authenticated ==="
probe_get "cnr-TSWL-pub" "$BASE_PUB/v1/cases/TSWL000000742024"
probe_get "cnr-RJHC-pub" "$BASE_PUB/v1/cases/RJHC010324382023"
probe_get "cnr-GJHC-pub" "$BASE_PUB/v1/cases/GJHC240256342024"
probe_get "cnr-negative-pub" "$BASE_PUB/v1/cases/ZZZZ000000000000"
probe_get "search-DC-pub" "$BASE_PUB/v1/cases?court_type=DC&party_name=kumar&page=1&page_size=5&want_total=false"
probe_get "timeline-GJHC-pub" "$BASE_PUB/v1/cases/GJHC240256342024/timeline"
