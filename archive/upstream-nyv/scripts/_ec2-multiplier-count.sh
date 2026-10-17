#!/usr/bin/env bash
# NV-MULTIPLIER-COUNT-001 — count REAL provider completions per user request.
# Audit says CoT + maker-checker are forced on despite their flags reading OFF.
# Send exactly one request, then count provider calls attributable to it.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$CID" ] && { echo "gateway not found"; exit 0; }

# Mark the log position, fire ONE request, then diff.
BEFORE=$(docker logs --tail 100000 "$CID" 2>&1 | wc -l)
echo "=== firing ONE orchestrate request (no complexity passed -> defaults to moderate) ==="
START=$(date +%s)
curl -sS -m 240 -o /tmp/mc.json -w "wall=%{time_total}s\n" \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d '{"prompt":"Explain the anticipatory bail standard under BNSS 482 for economic offences.","jurisdiction":"IN"}' \
  "${API}/api/jrx/orchestrate" || echo "request failed"
END=$(date +%s)
sleep 3

docker logs --tail 100000 "$CID" 2>&1 | tail -n +"$BEFORE" > /tmp/win.log
echo
echo "=== provider completions in the window ==="
grep -oE '"model":"[^"]+"' /tmp/win.log | sed 's/"model":"//; s/"//' \
  | grep -v embedding | sort | uniq -c | sort -rn

echo
echo "=== hedge / cascade events ==="
grep -c 'hedge success' /tmp/win.log || echo 0

echo
echo "=== multiplier feature markers ==="
for p in 'chainOfThought' 'chain-of-thought' 'maker-checker' 'makerChecker' 'self-rag' 'selfRag' 'synthesis' 'queen'; do
  printf '%-22s %s\n' "$p" "$(grep -ci "$p" /tmp/win.log || echo 0)"
done

echo
echo "=== what the response envelope reports ==="
python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/mc.json"))
except Exception as e:
    print("parse fail", e); raise SystemExit
n = d.get("data") if isinstance(d.get("data"), dict) else d
tk = n.get("tokens") or {}
print(f"model      = {n.get('model')}")
print(f"tokens     = in {tk.get('prompt')} / out {tk.get('completion')}")
print(f"cot present= {bool(n.get('chainOfThought'))}")
cot = n.get('chainOfThought') or {}
if isinstance(cot, dict):
    print(f"cot steps  = {len(cot.get('steps') or [])}  strategy={cot.get('strategy')}")
print(f"makerCheck = {n.get('makerCheckerVerdict')}")
print(f"layersUsed = {n.get('layersUsed')}")
PY

echo
echo "NOTE: response 'tokens' reports ONE completion. Compare against the model"
echo "count above to see how many completions were actually billed."
