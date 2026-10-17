#!/usr/bin/env bash
set -uo pipefail
PROBE="${FB399_PROBE_SCRIPT:-/tmp/jrx-fb399/probe.mjs}"
G=$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1)
if [ ! -f "$PROBE" ]; then
  LIVE=$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1)
  PROBE="${LIVE}/scripts/probe-fb399-counsel-durable.mjs"
fi
[ -f "$PROBE" ] || { echo "MISSING_PROBE"; exit 2; }
[ -n "$G" ] || { echo "NO_GATEWAY"; exit 3; }

docker cp "$PROBE" "$G:/tmp/probe-fb399.mjs"
docker exec "$G" node /tmp/probe-fb399.mjs
