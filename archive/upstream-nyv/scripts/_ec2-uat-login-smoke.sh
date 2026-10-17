#!/usr/bin/env bash
# Public API login smoke with CSRF Origin (no password echo).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
ORIGIN="${CONSOLE_URL:-https://console.nyayasiddhi.online}"
for EMAIL in admin@nyayavigya.in legalchat-sme-a-uat@nyayavigya.in; do
  CODE=$(curl -sS -o /tmp/jrx-login.json -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -H "Origin: $ORIGIN" \
    -H "Referer: ${ORIGIN}/" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$NV_DEMO_PW\"}" \
    https://api.nyayasiddhi.online/api/jrx/auth/login)
  HAS=$(python3 -c "import json; d=json.load(open('/tmp/jrx-login.json')); print('token' if d.get('token') else str(d.get('error','?'))[:50])" 2>/dev/null || echo '?')
  echo "$EMAIL HTTP $CODE $HAS"
done
