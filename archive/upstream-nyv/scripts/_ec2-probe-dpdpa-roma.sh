#!/usr/bin/env bash
# Probe DPDPA + ROMA endpoints after backfill — no secrets printed.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
BASE="http://127.0.0.1:5000"
ORIGIN="https://console.nyayasiddhi.online"
curl -sS -o /tmp/jrx-login.json -w 'login_http=%{http_code}\n' -m 20 \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"$PW\"}" \
  "$BASE/api/jrx/auth/login"
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/jrx-login.json')).get('token',''))" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  curl -sS -o /tmp/jrx-login.json -w 'login_alt_http=%{http_code}\n' -m 20 \
    -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
    -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"$PW\"}" \
    "$BASE/api/auth/login"
  TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/jrx-login.json')).get('token',''))" 2>/dev/null || echo "")
fi
if [ -z "$TOKEN" ]; then echo "dpdpa_probe=SKIP(no_token)"; echo "roma_probe=SKIP(no_token)"; exit 0; fi
curl -sS -o /tmp/jrx-dpdpa.json -w 'dpdpa_http=%{http_code}\n' -m 20 \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/jrx/compliance/dpdpa?days=7&jurisdiction=ALL"
python3 - <<'PY'
import json
d=json.load(open("/tmp/jrx-dpdpa.json"))
c=d.get("consents") or {}
print("dpdpa_total_rows=", c.get("total_rows", "ABSENT"))
print("dpdpa_granted=", c.get("total_granted", "ABSENT"))
print("dpdpa_status=", d.get("status", "ABSENT"))
print("dpdpa_degraded=", bool(d.get("degraded")))
PY
curl -sS -o /tmp/jrx-roma.json -w 'roma_http=%{http_code}\n' -m 20 \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/jrx/admin/roma-l5/stats"
python3 - <<'PY'
import json
d=json.load(open("/tmp/jrx-roma.json"))
meta=d.get("meta") or {}
print("roma_agentSource=", meta.get("agentSource", "ABSENT"))
data=d.get("data") or {}
print("roma_totalAgents=", data.get("totalAgents", "ABSENT"))
print("roma_requestsToday=", data.get("totalRequestsToday", "ABSENT"))
PY
