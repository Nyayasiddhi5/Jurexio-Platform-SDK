#!/usr/bin/env bash
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
[ -n "$NSPK" ] || { echo "FAIL no NSP key"; exit 1; }

echo "=== HEALTH ==="
curl -sS -m 10 -o /dev/null -w 'health=%{http_code}\n' "$API/api/jrx/health"

echo "=== LEGAL-CHAT-FAST ==="
curl -sS -m 120 \
  -H "X-API-Key: ${NSPK}" \
  -H "X-NYV-Platform: nsp" \
  -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"In one sentence: what is anticipatory bail under BNSS?","taskType":"legal-chat-fast","jurisdiction":"IN"}' \
  "$API/api/jrx/orchestrate" > /tmp/lcf.json

python3 - <<'PY'
import json
d = json.load(open("/tmp/lcf.json"))
print("success", d.get("success"))
data = d.get("data") or {}
ex = data.get("extras") or {}
meta = data.get("metadata") or {}
routing = data.get("routing") or {}
model = (
    ex.get("modelUsed") or meta.get("modelUsed") or meta.get("model")
    or routing.get("model") or routing.get("modelId") or d.get("modelUsed") or "ABSENT"
)
prov = ex.get("provider") or meta.get("provider") or routing.get("provider") or "?"
ans = (data.get("answer") or data.get("content") or d.get("answer") or "")
print("modelUsed", model)
print("provider", prov)
print("answer_len", len(ans))
print("preview", ans[:140])
if d.get("error"):
    print("error", str(d.get("error"))[:200])
PY

echo "=== ROUTER EXPLAIN (lead) ==="
curl -sS -m 30 \
  -H "X-API-Key: ${NSPK}" \
  -H "Content-Type: application/json" \
  -d '{"tier":"enterprise","jurisdiction":"IN","taskKind":"legal_research","app":"NSP","promptTokens":400,"expectedOutputTokens":200}' \
  "$API/api/jrx/v1/sdk/llm/router/explain" > /tmp/explain.json

python3 - <<'PY'
import json
d = json.load(open("/tmp/explain.json"))
seq = (d.get("data") or {}).get("sequence") or d.get("sequence") or []
primary = (d.get("data") or {}).get("primary") or d.get("primary") or {}
print("primary", primary.get("provider"), primary.get("id"))
print("lead", " -> ".join(f"{m.get('provider')}:{m.get('id')}" for m in seq[:6]))
PY

echo "=== CASCADE ENV (keys only) ==="
grep -E '^(NYV_LLM_CASCADE_LEAD|NYV_PARTNER_LEGAL_PREMIUM_MODELS|NYV_GEMINI_STT_MODEL)=' "$CANON" \
  | sed 's/=.*/=<set>/'
