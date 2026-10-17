#!/usr/bin/env bash
# NV-ROUTING-BENCH-001 — direct-provider latency/quality/cost baseline for a real
# legal prompt, so routing decisions are made on measured numbers not vibes.
# Prints no secret values.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
BT=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

PROMPT='You are Indian counsel. In under 400 words give the anticipatory bail strategy under BNSS 482 for a first-time accused in an economic offence in Telangana. Cite only the statutory provisions you are certain of.'

echo "### GEMINI DIRECT ###"
gem() {
  local m="$1"
  printf '%-26s ' "$m"
  curl -sS -m 120 -o /tmp/gb.json -w "HTTP %{http_code} t=%{time_total} " \
    "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent" \
    -H "x-goog-api-key: ${GK}" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"contents":[{"parts":[{"text":sys.argv[1]}]}],"generationConfig":{"maxOutputTokens":2048,"temperature":0.2}}))' "$PROMPT")" \
    || printf 'HTTP 000 '
  python3 - <<'PY'
import json
d = json.load(open("/tmp/gb.json"))
if "error" in d:
    print("ERR", str(d["error"].get("message"))[:80]); raise SystemExit
u = d.get("usageMetadata") or {}
c = (d.get("candidates") or [{}])[0]
txt = "".join(p.get("text", "") for p in ((c.get("content") or {}).get("parts") or []))
print(f"in={u.get('promptTokenCount')} out={u.get('candidatesTokenCount')} think={u.get('thoughtsTokenCount')} chars={len(txt)}")
PY
}
for m in gemini-3.7-flash gemini-3.6-flash gemini-3.5-flash gemini-3.1-flash-lite gemini-3.1-pro-preview; do gem "$m"; done

echo
echo "### BEDROCK DIRECT (Converse) ###"
bed() {
  local m="$1" region="${2:-us-east-1}"
  printf '%-42s ' "$m"
  curl -sS -m 240 -o /tmp/bb.json -w "HTTP %{http_code} t=%{time_total} " \
    "https://bedrock-runtime.${region}.amazonaws.com/model/${m}/converse" \
    -H "Authorization: Bearer ${BT}" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"messages":[{"role":"user","content":[{"text":sys.argv[1]}]}],"inferenceConfig":{"maxTokens":2048,"temperature":0.2}}))' "$PROMPT")" \
    || printf 'HTTP 000 '
  python3 - <<'PY'
import json
d = json.load(open("/tmp/bb.json"))
if d.get("message") and not d.get("output"):
    print("ERR", str(d.get("message"))[:80]); raise SystemExit
u = d.get("usage") or {}
blocks = ((d.get("output") or {}).get("message") or {}).get("content") or []
txt = "".join(b.get("text", "") for b in blocks)
print(f"in={u.get('inputTokens')} out={u.get('outputTokens')} chars={len(txt)}")
PY
}
for m in us.anthropic.claude-opus-5 global.anthropic.claude-sonnet-5 us.amazon.nova-pro-v1:0; do bed "$m"; done
