#!/usr/bin/env bash
set -euo pipefail
NET="nyayavigya-platform-312_nyv-net"
GW="nyv-gateway"
CON="nyv-console"
CANON="/opt/Nyayavigya/secrets/.env.production"
DEPLOY="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || true)"
LIVE_DIR="/opt/Nyayavigya/repo/${DEPLOY}"
[ -f "${LIVE_DIR}/docker-compose.aws-dev.yml" ] || LIVE_DIR="${LIVE_DIR}/nyayavigya-platform-312"
cd "$LIVE_DIR"
cp "$CANON" .env
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312

echo "=== networks ==="
docker network ls | grep nyv || true
echo "=== bridge gateway to ${NET} ==="
if docker network inspect "${NET}" >/dev/null 2>&1; then
  if ! docker inspect "${GW}" --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${NET}\""; then
    docker network connect --alias gateway "${NET}" "${GW}" || true
    echo "connected ${GW} -> ${NET}"
  else
    echo "${GW} already on ${NET}"
  fi
else
  echo "WARN: ${NET} missing; creating via compose"
fi

echo "=== recreate console with fixed project name ==="
docker stop "${CON}" 2>/dev/null || true
docker rm "${CON}" 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml build console 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps console
sleep 10

echo "=== checks ==="
docker ps --filter name=nyv-console --format '{{.Names}} {{.Status}}'
for i in 1 2 3 4 5 6; do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health || echo 000)
  echo "  proxy attempt $i: HTTP $code"
  [ "$code" = "200" ] && break
  sleep 5
done
