#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
echo "demo pw len: ${#NV_DEMO_PW}"

docker exec \
  -e "NV_DEMO_PASSWORD=${NV_DEMO_PW}" \
  -e "DATABASE_URL=${DB_ADMIN}" \
  -e "NODE_ENV=production" \
  -w /app nyv-gateway \
  npx tsx scripts/jrx-seed-users.ts 2>&1 | sed 's/[Pp]assword[^ ]*/password=<redacted>/g'

docker run --rm postgres:16-alpine \
  psql "$DB_ADMIN" -v ON_ERROR_STOP=1 -c \
  "UPDATE nv_users SET is_active = true, org_id = COALESCE(org_id, 1)
   WHERE email LIKE '%@nyayavigya.in' OR email LIKE '%@demo.nyayavigya.in';
   SELECT email, is_active, org_id, length(password_hash::text) AS hl
   FROM nv_users WHERE email = 'admin@nyayavigya.in';"

LOGIN=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 15 \
  -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" || echo 000)
echo "login HTTP $LOGIN"
if [ "$LOGIN" = "200" ]; then echo "login PASS"; else
  echo "login body:"; python3 -c "import json; print(json.load(open('/tmp/login.json')).get('error','')[:80])" 2>/dev/null || head -c 120 /tmp/login.json
fi
