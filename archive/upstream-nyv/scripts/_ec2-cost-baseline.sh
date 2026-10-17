#!/usr/bin/env bash
# NV-COST-BASELINE-001 — per-request token + cost baseline across the real task
# mix, so the 70% reduction claim has a measured "before" to prove against.
# Prints no secret values.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

run() {
  local label="$1" prompt="$2"
  curl -sS -m 240 -o /tmp/cb.json -w "t=%{time_total} " \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN"}))' "$prompt")" \
    "${API}/api/jrx/orchestrate" >/tmp/cb.hdr 2>/dev/null || echo "t=ERR " >/tmp/cb.hdr
  python3 - "$label" "$prompt" <<'PY'
import json, sys
label, prompt = sys.argv[1], sys.argv[2]
t = open("/tmp/cb.hdr").read().strip()
try:
    d = json.load(open("/tmp/cb.json"))
except Exception:
    print(f"{label:34s} {t} PARSE_FAIL"); raise SystemExit
n = d.get("data") if isinstance(d.get("data"), dict) else d
tk = n.get("tokens") or {}
pin, pout = tk.get("prompt") or 0, tk.get("completion") or 0
# user prompt token estimate (~4 chars/token)
uest = max(1, len(prompt) // 4)
infl = round(pin / uest, 1) if pin else 0
print(f"{label:34s} {t} model={str(n.get('model'))[:34]:34s} in={pin:6d} out={pout:5d} user~{uest:4d} inflation={infl}x")
PY
}

echo "=== per-task token baseline (inflation = prompt tokens / user tokens) ==="
run "micro-FAQ statute"        "What is BNS 103?"
run "mapping (fast path)"      "What BNS section replaced IPC 302?"
run "short chat"               "Is anticipatory bail available for BNS 318(4) cheating?"
run "classify/extract style"   "Classify this query into a legal practice area: tenant refuses to vacate after notice."
run "research"                 "Summarise the leading Supreme Court authorities on anticipatory bail in economic offences and how BNSS 482 changed the position."
run "drafting"                 "Draft an anticipatory bail application under BNSS 482 for a first-time accused in a Telangana cheating case."

echo
echo "=== repeat the micro-FAQ 3x (does anything cache?) ==="
for i in 1 2 3; do run "micro-FAQ repeat #${i}" "What is BNS 103?"; done
