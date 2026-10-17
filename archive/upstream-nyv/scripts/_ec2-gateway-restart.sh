#!/usr/bin/env bash
# Reset in-process NYS knowledge circuit breakers (gateway-only, no redeploy).
set -uo pipefail
DRAIN="${NYV_GATEWAY_DRAIN_SEC:-30}"
echo "=== gateway restart $(date -u +%Y-%m-%dT%H:%M:%SZ) drain=${DRAIN}s ==="
if docker ps --format '{{.Names}}' | grep -qx nyv-gateway; then
  docker stop -t "$DRAIN" nyv-gateway
  docker start nyv-gateway
else
  echo "nyv-gateway not running — attempting compose start"
  LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
  if [ -n "$LIVE" ] && [ -f "$LIVE/docker-compose.aws-dev.yml" ]; then
    cd "$LIVE"
    export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
    docker compose -f docker-compose.aws-dev.yml up -d gateway
  else
    echo "FAIL: cannot locate compose file"
    exit 1
  fi
fi
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_attempt_$i=$code"
  [ "$code" = "200" ] && break
  sleep 3
done
LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [ -n "$LIVE" ] && [ -f "$LIVE/scripts/jrx-verify-ingress.sh" ]; then
  bash "$LIVE/scripts/jrx-verify-ingress.sh" 2>&1 | tail -8
fi
echo "=== circuit reset complete (fresh gateway process) ==="
