#!/usr/bin/env bash
# C-08 — SC diary timeline unblock probe (localhost nysapi, no secret echo).
set -uo pipefail
echo "=== SC DIARY TIMELINE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fi
echo "case_api_key_len=$(printf %s "$KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$KEY" | wc -c)" -le 8 ]; then echo "SKIP no key"; exit 1; fi

probe() {
  local label="$1" diary="$2"
  local enc="${diary//\//%2F}"
  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 45 \
    -H "X-API-Key: $KEY" \
    "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=$enc&page_size=1" 2>/dev/null || echo ERR)
  python3 - "$label" "$code" "$tmp" <<'PY'
import json, sys, urllib.request
label, code, path = sys.argv[1:4]
raw = open(path).read()
try:
    d = json.loads(raw) if raw.strip() else {}
except Exception:
    print(f"{label} search http={code} parse_err body={raw[:120]}")
    raise SystemExit(0)
cases = d.get("cases") or []
print(f"{label} search http={code} n={len(cases)}")
if not cases:
    print(json.dumps({"error": d.get("error"), "detail": d.get("detail")}))
    raise SystemExit(0)
c = cases[0]
cnr = (c.get("cnr") or c.get("cnr_no") or "").strip()
print(f"  cnr_present={bool(cnr)} case_number={c.get('case_number') or c.get('case_no')}")
if not cnr:
    print("  timeline_skip reason=no_cnr")
    raise SystemExit(0)
# timeline by CNR
import os
key = os.environ.get("CASE_PROBE_KEY", "")
PY
  rm -f "$tmp"
  export CASE_PROBE_KEY="$KEY"
  local cnr
  cnr=$(python3 - "$tmp" <<'PY2'
import json, sys
# re-fetch from last tmp not available — use curl inline below
PY2
)
}

# inline python with key from env
export CASE_PROBE_KEY="$KEY"
python3 <<'PY'
import json, os, urllib.request
KEY = os.environ.get("CASE_PROBE_KEY", "")
BASE = "http://127.0.0.1:8090"
diaries = [("17329/2025", "DIARY_17329"), ("264/2024", "DIARY_264")]

def get(path):
    req = urllib.request.Request(BASE + path, headers={"X-API-Key": KEY})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.status, r.read().decode()

for diary, label in diaries:
    enc = diary.replace("/", "%2F")
    try:
        st, body = get(f"/v1/cases?court_type=SC&diary_no={enc}&page_size=1")
        d = json.loads(body)
        cases = d.get("cases") or []
        print(f"{label} search http={st} n={len(cases)}")
        if not cases:
            print(" ", d.get("error") or d.get("detail"))
            continue
        c = cases[0]
        cnr = (c.get("cnr") or c.get("cnr_no") or "").strip()
        print(f"  cnr_len={len(cnr)} case_no={c.get('case_number') or c.get('case_no')}")
        if not cnr:
            print("  timeline=SKIP no_cnr")
            continue
        st2, body2 = get(f"/v1/cases/{cnr}/timeline?page_size=5")
        t = json.loads(body2) if body2.strip() else {}
        events = t.get("events") or t.get("timeline") or []
        print(f"  timeline http={st2} events={len(events) if isinstance(events, list) else 'shape?'}")
        if isinstance(events, list) and events:
            print("  first_event_keys", sorted(events[0].keys())[:8])
    except Exception as e:
        print(f"{label} ERR {e}")
PY
echo "=== SC DIARY TIMELINE DONE ==="
