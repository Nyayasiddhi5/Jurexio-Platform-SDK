#!/usr/bin/env bash
set -euo pipefail
docker logs --tail 40 nyv-gateway 2>&1 | grep -E 'auth-db|auth pool|nv-auth-db' || echo "no auth-db logs"
docker exec nyv-gateway test -f /app/src/db/jrx-auth-db.ts && echo "./jrx-auth-db.ts present" || echo "./jrx-auth-db.ts MISSING"
docker exec nyv-gateway grep -c 'getAuthDb' /app/src/routes/jrx-auth-routes.ts || true
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
code=$(curl -sS -o /tmp/l.json -w '%{http_code}' -m 15 \
  -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}")
echo "login HTTP ${code}"
head -c 150 /tmp/l.json; echo
