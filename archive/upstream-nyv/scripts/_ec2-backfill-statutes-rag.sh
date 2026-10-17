#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
login() {
  curl -sS -o /tmp/login.json -w '%{http_code}' -m 20 \
    -X POST http://127.0.0.1:5000/api/jrx/auth/login \
    -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
    -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}"
}
code=$(login); echo "login HTTP ${code}"
TOKEN="$(python3 -c 'import json,sys;print(json.load(open("/tmp/login.json")).get("token") or json.load(open("/tmp/login.json")).get("accessToken") or "")' 2>/dev/null)"
if [ -z "$TOKEN" ]; then echo "no token; body:"; head -c 300 /tmp/login.json; echo; exit 1; fi
echo "token_len=${#TOKEN}"

backfill() {
  local JUR="$1"
  local hc=$(curl -sS -o /tmp/bf.json -w '%{http_code}' -m 600 \
    -X POST http://127.0.0.1:5000/api/jrx/rag/collections/backfill-statutes \
    -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" \
    -H 'Origin: https://api.nyayasiddhi.online' \
    -d "{\"jurisdiction\":\"${JUR}\",\"limit\":5000,\"dryRun\":false}")
  echo "[$JUR] HTTP $hc -> $(cat /tmp/bf.json | head -c 400)"
}

for J in UK US EU SG GC IN; do backfill "$J"; done

echo "=== knowledge_chunks total (after) ==="
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "SELECT count(*) FROM knowledge_chunks;"' 2>&1
