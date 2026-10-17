#!/usr/bin/env bash
# TSWL positive control — GET /sdk/cnr/search?court_type=dc&cnr=TSWL000000742024&page_size=1
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//')"
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 -G \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
  --data-urlencode "court_type=dc" \
  --data-urlencode "cnr=TSWL000000742024" \
  --data-urlencode "page_size=1" \
  "$API/api/jrx/v1/sdk/cnr/search" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
raw = open(path).read()
try:
    d = json.loads(raw) if raw.strip() else {}
except Exception as e:
    print(f"TSWL_SEARCH FAIL http={code} parse_err={e}")
    raise SystemExit(1)
cases = (d.get("data") or {}).get("cases") or []
c0 = cases[0] if cases else {}
first = c0.get("cnr") or c0.get("CNR") or ""
ok = code == "200" and d.get("success") is True and first == "TSWL000000742024"
print(
    f"TSWL_SEARCH http={code} success={d.get('success')} "
    f"first_cnr={first!r} count={len(cases)} "
    f"sourcesTried_present={'sourcesTried' in d} "
    f"VERDICT={'PASS' if ok else 'FAIL'}"
)
raise SystemExit(0 if ok else 1)
PY
rm -f "$tmp"
