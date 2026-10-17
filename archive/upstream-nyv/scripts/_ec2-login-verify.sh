#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
echo "DATABASE_URL_ADMIN in canon:" $(grep -c '^DATABASE_URL_ADMIN=' "$CANON" || echo 0)
echo "DATABASE_URL_ADMIN in gateway env:" $(docker exec nyv-gateway sh -c 'grep -c ^DATABASE_URL_ADMIN= /app/.env 2>/dev/null || echo 0')
docker logs --tail 20 nyv-gateway 2>&1 | grep -i 'auth-db\|auth pool' || echo "no auth-db log lines"
bash /opt/Nyayavigya/repo/*/scripts/_ec2-login-test.sh 2>/dev/null || true
CANON="$CANON" bash -c '
NV_DEMO_PW=$(grep -E "^NV_DEMO_PASSWORD=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d "\r\n")
code=$(curl -sS -o /tmp/l.json -w "%{http_code}" -m 15 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H "Content-Type: application/json" -H "Origin: https://api.nyayasiddhi.online" \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}")
echo "login: $code"
python3 -c "import json; d=json.load(open(\"/tmp/l.json\")); print(d.get(\"success\"), d.get(\"error\",\"\")[:60])" 2>/dev/null || cat /tmp/l.json | head -c 200
'
