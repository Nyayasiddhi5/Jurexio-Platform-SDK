#!/usr/bin/env bash
# Read-only: inspect the live edge (Caddy container + mounted Caddyfile + ALB).
set -uo pipefail
echo "=== caddy container ==="
CADDY=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1)
echo "container=$CADDY"
echo
echo "=== locate live Caddyfile ==="
LIVE=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  if [ -f "${p}infra/caddy/Caddyfile" ]; then LIVE="${p%/}"; break; fi
done
echo "live_dir=$LIVE"
CF="$LIVE/infra/caddy/Caddyfile"
echo "caddyfile=$CF"
echo
echo "=== api host handle blocks (host file) ==="
grep -nE 'api\.nyayasiddhi|handle |gateway_upstream|legal-chat|orchestrate|completions|research' "$CF" 2>/dev/null | head -40 || true
echo
echo "=== does host file already route legal-chat to long? ==="
grep -q '/api/jrx/legal-chat/\*' "$CF" && echo "LEGAL_CHAT_HANDLER=present" || echo "LEGAL_CHAT_HANDLER=absent"
echo
echo "=== container-mounted /etc/caddy/Caddyfile legal-chat check ==="
if [ -n "$CADDY" ]; then
  docker exec "$CADDY" sh -c "grep -c '/api/jrx/legal-chat/\\*' /etc/caddy/Caddyfile 2>/dev/null" || echo "0"
fi
echo "=== DONE ==="
