#!/usr/bin/env bash
set -uo pipefail
pid=$(pgrep -f 'uvicorn.*8090' | head -1)
CASE_KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | cut -d= -f2- | sed 's/,.*//')

summarize() {
  local label="$1"; local url="$2"
  tmp=$(mktemp)
  start=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -H "X-API-Key: $CASE_KEY" "$url")
  end=$(python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
j = json.load(open(path))
if j.get('error'):
    print(f"SHAPE {label} http={code} ms={ms} error={j.get('error')}")
    sys.exit(0)
c = j.get('case') or j
cnr = c.get('cnr')
court = c.get('court_level')
status = c.get('case_status')
pet = (c.get('petitioner') or '')[:40]
resp = (c.get('respondent') or '')[:40]
hearings = len(c.get('hearings') or [])
acts = (c.get('counts') or {}).get('acts')
backend = (c.get('provenance') or {}).get('backend')
elapsed = (c.get('provenance') or {}).get('elapsed_ms')
fa = list((c.get('field_availability') or {}).keys())[:3]
print(
    f"SHAPE {label} http={code} ms={ms} cnr={cnr!r} court={court!r} status={status!r} "
    f"hearings={hearings} acts={acts} backend={backend!r} elapsed_ms={elapsed} "
    f"pet={pet!r} resp={resp!r} fa_sample={fa}"
)
PY
  rm -f "$tmp"
}

BASE="https://nysapi.jurexio.com"
for pair in \
  "TSWL|$BASE/v1/cases/TSWL000000742024" \
  "RJHC|$BASE/v1/cases/RJHC010324382023" \
  "GJHC|$BASE/v1/cases/GJHC240256342024" \
  "ZZZZ|$BASE/v1/cases/ZZZZ000000000000"; do
  summarize "${pair%%|*}" "${pair#*|}"
done
