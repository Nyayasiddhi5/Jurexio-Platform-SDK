#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
BASE="http://127.0.0.1:5000"
ORG='https://api.nyayasiddhi.online'
code=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 20 -X POST "$BASE/api/jrx/auth/login" \
  -H 'Content-Type: application/json' -H "Origin: $ORG" \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}")
echo "login HTTP $code"
TOKEN="$(python3 -c 'import json;print(json.load(open("/tmp/login.json")).get("token") or json.load(open("/tmp/login.json")).get("accessToken") or "")' 2>/dev/null)"
echo "token_len=${#TOKEN}"
echo "=== GET /api/jrx/superadmin/llm-budget ==="
curl -s "$BASE/api/jrx/superadmin/llm-budget" -H "Authorization: Bearer $TOKEN" -H "Origin: $ORG" | python3 -m json.tool 2>/dev/null | head -50
