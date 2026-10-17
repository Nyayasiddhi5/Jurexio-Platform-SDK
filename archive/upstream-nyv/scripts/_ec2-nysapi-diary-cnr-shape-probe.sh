#!/usr/bin/env bash
# nysapi diary row CNR field shape — runs ON nysdev EC2. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NYSAPI="https://nysapi.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

CASE_API_KEY="$(read_canon_key NYS_CASE_API_KEY)"
echo "=== NYSAPI DIARY CNR SHAPE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "case_api_key_len=$(printf %s "$CASE_API_KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$CASE_API_KEY" | wc -c)" -le 8 ]; then echo "SKIP no case api key"; exit 1; fi

probe_diary() {
  local label="$1" diary="$2"
  local tmp; tmp=$(mktemp)
  local enc="${diary//\//%2F}"
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 \
    -H "X-API-Key: $CASE_API_KEY" \
    "$NYSAPI/v1/cases?court_type=SC&diary_no=$enc&page_size=1" 2>/dev/null || echo ERR)
  python3 - "$label" "$code" "$tmp" <<'PY'
import json, sys
label, code, path = sys.argv[1:4]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    cases = d.get("cases") or []
    print(f"=== {label} http={code} returned={len(cases)} ===")
    if not cases:
        print(json.dumps({"error": d.get("error"), "detail": d.get("detail")}, indent=2))
        raise SystemExit(0)
    c = cases[0]
    cnr_keys = [k for k in sorted(c.keys()) if "cnr" in k.lower()]
    id_keys = [k for k in sorted(c.keys()) if any(x in k.lower() for x in ("case", "diary", "number", "no"))]
    print("cnr_related_keys:", cnr_keys)
    print("identifier_keys:", id_keys)
    summary = {}
    for k in sorted(c.keys()):
        if any(x in k.lower() for x in ("cnr", "diary", "case_number", "case_no", "case_type", "case_title", "petitioner", "respondent", "court", "status", "synthetic")):
            v = c.get(k)
            if isinstance(v, str) and len(v) > 120:
                v = v[:120] + "..."
            summary[k] = v
    print(json.dumps(summary, indent=2, default=str))
except Exception as e:
    print(f"ERR {label} http={code} err={e} body={open(path).read()[:200]}")
PY
  rm -f "$tmp"
}

probe_diary "DIARY_17329" "17329/2025"
probe_diary "DIARY_264" "264/2024"
probe_diary "DIARY_50850" "50850/2026"

echo "=== PROBE DONE ==="
