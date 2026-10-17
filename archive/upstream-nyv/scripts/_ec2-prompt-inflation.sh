#!/usr/bin/env bash
# NV-PROMPT-INFLATION-001 — measure how many tokens our own layers add to a
# 48-token user question, and whether the LM cache ever serves a repeat.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

Q='Under BNSS 482 what are the factors a court weighs for anticipatory bail?'

probe() {
  local label="$1"; shift
  local payload="$1"
  printf '%-40s ' "$label"
  curl -sS -m 200 -o /tmp/pi.json -w "HTTP %{http_code} t=%{time_total} " \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$payload" "${API}/api/jrx/orchestrate" || printf 'HTTP 000 '
  python3 - <<'PY'
import json
d = json.load(open("/tmp/pi.json"))
n = d.get("data") if isinstance(d.get("data"), dict) else d
tk = n.get("tokens") or {}
print(f"in={tk.get('prompt')} out={tk.get('completion')} model={n.get('model')}")
PY
}

echo "=== prompt-token inflation by knob (user prompt is ~20 tokens) ==="
probe "default (all layers)"            "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN"}))' "$Q")"
probe "enableRAG=false"                 "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN","enableRAG":False}))' "$Q")"
probe "enableRAG=false enableMemory=false" "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN","enableRAG":False,"enableMemory":False}))' "$Q")"
probe "own systemPrompt (skip overlay)" "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN","systemPrompt":"You are Indian counsel. Be precise and cite statute.","enableRAG":False,"enableMemory":False}))' "$Q")"
probe "repeat of default (cache test)"  "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN"}))' "$Q")"

echo
echo "=== LM cache stats endpoint (if exposed) ==="
curl -sS -m 20 -o /tmp/lc.json -w "HTTP %{http_code}\n" -H "X-API-Key: ${NSPK}" \
  "${API}/api/jrx/admin/lm-cache/stats" 2>/dev/null || echo "HTTP 000"
head -c 400 /tmp/lc.json 2>/dev/null; echo

echo
echo "=== router decision aggregates (fallback levels / models) ==="
curl -sS -m 20 -o /tmp/rs.json -w "HTTP %{http_code}\n" -H "X-API-Key: ${NSPK}" \
  "${API}/api/jrx/admin/router/stats" 2>/dev/null || echo "HTTP 000"
python3 - <<'PY' 2>/dev/null || head -c 300 /tmp/rs.json
import json
d = json.load(open("/tmp/rs.json"))
n = d.get("data") or d
for k in ("successRate", "fallbackLevelDistribution", "byModel"):
    v = n.get(k)
    if v is not None:
        print(k, json.dumps(v)[:400])
PY
