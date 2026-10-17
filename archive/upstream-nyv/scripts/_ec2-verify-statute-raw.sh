#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
curl -sS -o /tmp/login.json -m 20 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" >/dev/null
TOKEN="$(python3 -c 'import json;d=json.load(open("/tmp/login.json"));print(d.get("token") or d.get("accessToken") or "")')"
echo "token_len=${#TOKEN}"
echo "=== RAW auto/retrieve UK ==="
curl -sS -m 60 -X POST http://127.0.0.1:5000/api/jrx/rag/collections/auto/retrieve \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' \
  -d '{"query":"corporate failure to prevent bribery","jurisdiction":"UK","topK":5}' | head -c 900
echo; echo "=== RAW statutes/search bribery ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/statutes/search?q=bribery&limit=3" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' | head -c 900
echo; echo "=== RAW GET /api/jrx/statutes?jurisdiction=UK&limit=3 ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/statutes?jurisdiction=UK&limit=3" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' | head -c 700
echo; echo "=== RAW statutes/_summary ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/statutes/_summary" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' | head -c 700
echo
