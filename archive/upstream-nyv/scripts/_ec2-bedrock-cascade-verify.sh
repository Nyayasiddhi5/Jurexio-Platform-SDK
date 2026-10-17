#!/usr/bin/env bash
# Confirm live cascade lead after Claude update. Never echo secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
echo "=== HEALTH ==="
curl -sS -o /tmp/jrx-health.json -w 'HTTP %{http_code}\n' -m 20 "${API}/api/jrx/health"
python3 -c 'import json;d=json.load(open("/tmp/jrx-health.json"));print("agents",d.get("totalAgents"),"ver",d.get("version"))'
echo "=== LIVE FLAGS ==="
docker exec nyv-gateway sh -c 'node -e "
const ks=[\"NYV_LLM_CASCADE_LEAD\",\"NYV_PARTNER_LEGAL_PREMIUM_MODELS\",\"NYV_PARTNER_LEGAL_PREMIUM_FIRST\",\"AWS_BEDROCK_REGION\"];
for (const k of ks) console.log(k+\"=\"+(process.env[k]||\"(unset)\"));
"'
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
echo "=== ROUTER EXPLAIN ==="
curl -sS -o /tmp/explain.json -w 'HTTP %{http_code}\n' -m 30 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"tier":"enterprise","jurisdiction":"IN","taskKind":"legal_research","app":"NSP","promptTokens":400,"expectedOutputTokens":200}' \
  "${API}/api/jrx/v1/sdk/llm/router/explain"
python3 - <<'PY'
import json
d=json.load(open("/tmp/explain.json"))
seq=(d.get("data") or {}).get("sequence") or d.get("sequence") or []
primary=(d.get("data") or {}).get("primary") or d.get("primary") or {}
print("primary=%s:%s"%(primary.get("provider"), primary.get("id")))
print("lead="+" -> ".join("%s:%s"%(m.get("provider"), m.get("id")) for m in seq[:7]))
PY
