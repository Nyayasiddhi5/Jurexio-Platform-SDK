#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
LIVE=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  [ -f "${p}docker-compose.aws-dev.yml" ] && LIVE="${p%/}" && break
done
[ -n "$LIVE" ] || exit 1
cp "$CANON" "$LIVE/.env"
grep -q '^DATABASE_URL_ADMIN=' "$LIVE/.env" && echo "live .env has DATABASE_URL_ADMIN" || echo "MISSING DATABASE_URL_ADMIN in live .env"
cd "$LIVE"
docker stop nyv-gateway && docker rm nyv-gateway
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
sleep 20
if docker exec nyv-gateway printenv DATABASE_URL_ADMIN >/dev/null 2>&1; then
  echo "container DATABASE_URL_ADMIN: set"
else
  echo "container DATABASE_URL_ADMIN: MISSING"
fi
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
code=$(curl -sS -o /tmp/l.json -w '%{http_code}' -m 15 \
  -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" || echo 000)
echo "login HTTP $code"
