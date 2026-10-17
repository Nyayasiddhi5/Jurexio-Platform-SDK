#!/usr/bin/env bash
# Bump console nginx /api/ proxy timeouts for long Queen orchestration runs.
set -euo pipefail

CONF="/etc/nginx/conf.d/nyayavigya.conf"

if ! docker ps --format '{{.Names}}' | grep -qx 'nyv-console'; then
  echo "ERROR: nyv-console not running"
  docker ps --format '{{.Names}}'
  exit 1
fi

echo "Current /api/ timeouts:"
docker exec nyv-console grep -E 'proxy_(read|send)_timeout' "$CONF" | head -4 || true

docker exec nyv-console sed -i \
  -e 's/proxy_read_timeout 300s/proxy_read_timeout 600s/g' \
  -e 's/proxy_read_timeout 180s/proxy_read_timeout 600s/g' \
  -e 's/proxy_read_timeout 60s/proxy_read_timeout 600s/g' \
  -e 's/proxy_send_timeout 300s/proxy_send_timeout 600s/g' \
  -e 's/proxy_send_timeout 180s/proxy_send_timeout 600s/g' \
  -e 's/proxy_send_timeout 60s/proxy_send_timeout 600s/g' \
  "$CONF"

docker exec nyv-console nginx -t
docker exec nyv-console nginx -s reload

echo "Updated /api/ timeouts:"
docker exec nyv-console grep -E 'proxy_(read|send)_timeout' "$CONF" | head -4

# Optional Caddy reload if present (ecosystem compose)
if docker ps --format '{{.Names}}' | grep -qx 'nyv-caddy'; then
  echo "Reloading nyv-caddy ..."
  docker exec nyv-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec nyv-caddy caddy reload --config /etc/caddy/Caddyfile
fi

echo "Console nginx reload OK"
