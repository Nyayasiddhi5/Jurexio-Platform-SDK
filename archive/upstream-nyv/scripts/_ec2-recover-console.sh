#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
LIVE_DIR=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  if [ -f "${p}docker-compose.aws-dev.yml" ]; then LIVE_DIR="${p%/}"; break; fi
done
[ -n "$LIVE_DIR" ] || { echo FATAL: no compose dir; exit 1; }
cd "$LIVE_DIR"
cp "$CANON" .env
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
NET="nyayavigya-platform-312_nyv-net"
if docker network inspect "${NET}" >/dev/null 2>&1; then
  if ! docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${NET}\""; then
    docker network connect --alias gateway "${NET}" nyv-gateway 2>/dev/null || true
    echo "=== bridged gateway to ${NET} ==="
  fi
fi
echo "=== recreate console ==="
docker stop nyv-console 2>/dev/null || true
docker rm nyv-console 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps console
sleep 8
echo "=== proxy check ==="
for i in $(seq 1 6); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health || echo 000)
  echo "  attempt $i: HTTP $code"
  [ "$code" = "200" ] && break
  sleep 5
done
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" )"
LOGIN=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 15 \
  -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" || echo 000)
echo "  login (direct :5000) HTTP $LOGIN"
curl -sS http://127.0.0.1:5000/api/jrx/health/full | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  health/full:', d.get('status'))
"
