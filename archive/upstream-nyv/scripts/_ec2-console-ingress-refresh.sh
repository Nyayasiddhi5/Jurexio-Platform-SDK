#!/usr/bin/env bash
# NV-CONSOLE-INGRESS-REFRESH-001 — bridge gateway network + recreate console (post manual gateway restart).
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
DEST="/opt/Nyayavigya/repo/${DEP}"
LIVE_DIR="$(find "$DEST" -maxdepth 2 -type d -name 'nyayavigya-platform-312' | head -1)"
[ -n "$LIVE_DIR" ] || LIVE_DIR="$DEST"
cd "$LIVE_DIR"

LEGACY_NET="nyayavigya-platform-312_nyv-net"
if docker network inspect "$LEGACY_NET" >/dev/null 2>&1; then
  if ! docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${LEGACY_NET}\""; then
    docker network connect --alias gateway "$LEGACY_NET" nyv-gateway 2>/dev/null || true
    echo "bridged_nyv-gateway_to=${LEGACY_NET}"
  else
    echo "bridge_skip=already_on_legacy_net"
  fi
fi

docker compose -f docker-compose.aws-dev.yml up -d --no-deps console
sleep 8
if [ -f scripts/jrx-verify-ingress.sh ]; then
  NV_INGRESS_ATTEMPTS=12 bash scripts/jrx-verify-ingress.sh 2>&1 | tail -25
else
  curl -sS -o /dev/null -w "ingress_health=%{http_code}\n" http://127.0.0.1/health || true
fi
