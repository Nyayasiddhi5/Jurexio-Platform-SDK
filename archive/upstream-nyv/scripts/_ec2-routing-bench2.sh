#!/usr/bin/env bash
# NV-ROUTING-BENCH-002 — Bedrock Claude without deprecated `temperature`
# (matches bedrock-request-builder omitTemperature), same prompt as bench-001.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
BT=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

PROMPT='You are Indian counsel. In under 400 words give the anticipatory bail strategy under BNSS 482 for a first-time accused in an economic offence in Telangana. Cite only the statutory provisions you are certain of.'

bed() {
  local m="$1" region="${2:-us-east-1}"
  printf '%-42s ' "$m"
  curl -sS -m 300 -o /tmp/bb2.json -w "HTTP %{http_code} t=%{time_total} " \
    "https://bedrock-runtime.${region}.amazonaws.com/model/${m}/converse" \
    -H "Authorization: Bearer ${BT}" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"messages":[{"role":"user","content":[{"text":sys.argv[1]}]}],"inferenceConfig":{"maxTokens":2048}}))' "$PROMPT")" \
    || printf 'HTTP 000 '
  python3 - <<'PY'
import json
d = json.load(open("/tmp/bb2.json"))
if d.get("message") and not d.get("output"):
    print("ERR", str(d.get("message"))[:90]); raise SystemExit
u = d.get("usage") or {}
blocks = ((d.get("output") or {}).get("message") or {}).get("content") or []
txt = "".join(b.get("text", "") for b in blocks)
print(f"in={u.get('inputTokens')} out={u.get('outputTokens')} chars={len(txt)} stop={d.get('stopReason')}")
PY
}

echo "### BEDROCK (no temperature) ###"
for m in us.anthropic.claude-opus-5 global.anthropic.claude-sonnet-5 global.anthropic.claude-opus-4-8 global.anthropic.claude-haiku-4-5-20251001-v1:0 us.amazon.nova-pro-v1:0 global.amazon.nova-2-lite-v1:0; do bed "$m"; done
