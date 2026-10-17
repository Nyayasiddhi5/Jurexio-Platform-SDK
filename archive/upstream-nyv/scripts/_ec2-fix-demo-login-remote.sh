#!/usr/bin/env bash
# Run ON EC2 — re-seed demo users + login smoke (no password echoed).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
echo "demo_pw_len=${#NV_DEMO_PW}"

docker exec \
  -e "NV_DEMO_PASSWORD=${NV_DEMO_PW}" \
  -e "DATABASE_URL=${DB_ADMIN}" \
  -e "DATABASE_URL_ADMIN=${DB_ADMIN}" \
  -e "NODE_ENV=production" \
  -w /app nyv-gateway \
  npx tsx scripts/jrx-seed-users.ts 2>&1 | sed 's/[Pp]assword[^ ]*/password=<redacted>/g'

test_login() {
  local email="$1" pw="$2"
  local code
  code=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 15 \
    -X POST http://127.0.0.1:5000/api/auth/login \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://console.nyayasiddhi.online' \
    -d "{\"email\":\"${email}\",\"password\":\"${pw}\"}" || echo 000)
  echo "login ${email} HTTP ${code}"
}

test_login "admin@nyayavigya.in" "$NV_DEMO_PW"
test_login "manager@demo.nyayavigya.in" "$NV_DEMO_PW"
test_login "legalchat-admin-uat@nyayavigya.in" "Nyv!UAT#Admin@2026#A1"
