#!/usr/bin/env bash
# Recovery: recreate gateway from 2026-09-12T0845Z deploy dir, fix ingress, update CURRENT_DEPLOY.
set -euo pipefail

TARGET_DEPLOY="2026-09-12T0845Z-aws-ssm-94bececc"
CANON="/opt/Nyayavigya/secrets/.env.production"
NET="nyayavigya-platform-312_nyv-net"
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312

echo "=== PRE-RECOVERY LENS ==="
echo "CURRENT_DEPLOY=$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "LAST_GOOD=$(cat /opt/Nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"
docker ps -a --format '{{.Names}} {{.Status}}' | grep nyv || true
echo "gateway healthcheck: $(docker inspect nyv-gateway --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)"
echo ":5000 health HTTP $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo FAIL)"
echo ":80 health HTTP $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health || echo FAIL)"
echo "health body (5000):"
curl -sS -m 5 http://127.0.0.1:5000/api/jrx/health 2>/dev/null | head -c 500 || echo "(no body)"
echo ""

LIVE_DIR="/opt/Nyayavigya/repo/${TARGET_DEPLOY}"
if [ ! -d "$LIVE_DIR" ]; then
  echo "FATAL: deploy dir missing: $LIVE_DIR"
  ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -5
  exit 1
fi
echo "TARGET_DIR=$LIVE_DIR"
cd "$LIVE_DIR"
cp "$CANON" .env

echo "=== GATEWAY RECREATE from $TARGET_DEPLOY ==="
DRAIN_TIMEOUT=25
if docker ps --format '{{.Names}}' | grep -qx nyv-gateway; then
  docker stop -t "$DRAIN_TIMEOUT" nyv-gateway 2>/dev/null || true
fi
docker rm nyv-gateway 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway

echo "=== POLL :5000 health (120s) ==="
HEALTH_OK=0
for i in $(seq 1 24); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)
  hc=$(docker inspect nyv-gateway --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)
  echo "  attempt $i: HTTP $code docker_health=$hc"
  if [ "$code" = "200" ]; then HEALTH_OK=1; break; fi
  sleep 5
done
if [ "$HEALTH_OK" != "1" ]; then
  echo "FATAL: gateway :5000 not 200"
  docker logs --tail 40 nyv-gateway 2>&1 | sed 's/\(password\|secret\|key\)=[^ ]*/\1=<redacted>/gi'
  exit 1
fi

echo "=== NETWORK BRIDGE ==="
if docker network inspect "$NET" >/dev/null 2>&1; then
  if ! docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${NET}\""; then
    docker network connect --alias gateway --alias nyv-gateway "$NET" nyv-gateway 2>/dev/null || true
    echo "bridged nyv-gateway -> $NET"
  else
    echo "already on $NET"
  fi
fi

echo "=== CONSOLE RECREATE ==="
docker stop nyv-console 2>/dev/null || true
docker rm nyv-console 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps console
sleep 8

echo "=== INGRESS POLL :80 (90s) ==="
PROXY_OK=0
for i in $(seq 1 18); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health 2>/dev/null || echo 000)
  echo "  attempt $i: HTTP $code"
  [ "$code" = "200" ] && PROXY_OK=1 && break
  sleep 5
done

echo "=== UPDATE CURRENT_DEPLOY ==="
echo "$TARGET_DEPLOY" > /opt/Nyayavigya/CURRENT_DEPLOY
if [ "$PROXY_OK" = "1" ]; then
  echo "$TARGET_DEPLOY" > /opt/Nyayavigya/LAST_GOOD_DEPLOY
fi
echo "$(date -u +%FT%TZ) | RECOVER-0845 | 94bececc | $LIVE_DIR | gw=OK ingress=$([ "$PROXY_OK" = "1" ] && echo OK || echo WARN)" >> /opt/Nyayavigya/deploys.log

echo "=== POST-RECOVERY ==="
echo "CURRENT_DEPLOY=$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
echo "gateway: $(docker inspect nyv-gateway --format '{{.State.Status}} health={{.State.Health.Status}}' 2>/dev/null)"
echo "console: $(docker inspect nyv-console --format '{{.State.Status}} health={{.State.Health.Status}}' 2>/dev/null)"
echo ":5000 HTTP $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health)"
echo ":80 HTTP $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health)"

[ "$HEALTH_OK" = "1" ] || exit 1
[ "$PROXY_OK" = "1" ] || exit 2
