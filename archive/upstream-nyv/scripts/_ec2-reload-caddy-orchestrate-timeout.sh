#!/usr/bin/env bash
# On EC2: sync Caddyfile from live repo mount and reload Caddy (no SDK key changes).
set -euo pipefail

LIVE_DIR=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  if [ -f "${p}infra/caddy/Caddyfile" ]; then
    LIVE_DIR="${p%/}"
    break
  fi
done

if [ -z "$LIVE_DIR" ]; then
  echo "ERROR: cannot find live repo with infra/caddy/Caddyfile"
  exit 1
fi

echo "Live dir: $LIVE_DIR"
CADDYFILE="$LIVE_DIR/infra/caddy/Caddyfile"

if ! grep -q 'gateway_upstream_long' "$CADDYFILE" 2>/dev/null; then
  echo "Patching Caddyfile for long orchestrate upstream..."
  python3 "${PATCH_PY:-$LIVE_DIR/scripts/_patch-caddy-orchestrate-timeout.py}" "$CADDYFILE"
fi

if docker ps --format '{{.Names}}' | grep -qx 'nyv-caddy'; then
  CADDY_CTR=nyv-caddy
elif docker ps --format '{{.Names}}' | grep -q caddy; then
  CADDY_CTR=$(docker ps --format '{{.Names}}' | grep caddy | head -1)
else
  echo "INFO: no caddy container — skipping Caddy reload (console nginx handles edge on this host)"
  CADDY_CTR=""
fi

if [[ -n "$CADDY_CTR" ]]; then
  echo "Reloading $CADDY_CTR ..."
  docker exec "$CADDY_CTR" caddy validate --config /etc/caddy/Caddyfile
  docker exec "$CADDY_CTR" caddy reload --config /etc/caddy/Caddyfile
  echo "Caddy reload OK"
  grep -n 'orchestrate\|gateway_upstream_long' "$CADDYFILE" | head -15 || true
fi
