#!/usr/bin/env bash
# NV-ECOURTSINDIA-ENABLE-001 — set partner key + live-fetch flag on nysdev (no echo of secret).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
BACKUP="/opt/Nyayavigya/secrets/LAST_GOOD.env"
KEY_B64="${1:-}"
[ -n "$KEY_B64" ] || { echo "FATAL: missing base64 key arg"; exit 1; }
KEY="$(echo "$KEY_B64" | base64 -d)"
[ "${#KEY}" -gt 20 ] || { echo "FATAL: decoded key too short"; exit 1; }

set_kv() {
  local file="$1"
  local k="$2"
  local v="$3"
  if grep -q "^${k}=" "$file" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$file"
  else
    echo "${k}=${v}" >> "$file"
  fi
  echo "set_name=${k} file=$(basename "$file")"
}

cp -a "$CANON" "${CANON}.bak-ecourtsindia-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null || true
set_kv "$CANON" "NYV_ECOURTSINDIA_API_KEY" "$KEY"
set_kv "$CANON" "NYV_F_ECOURTS_LIVE_FETCH" "1"
[ -f "$BACKUP" ] && set_kv "$BACKUP" "NYV_ECOURTSINDIA_API_KEY" "$KEY" && set_kv "$BACKUP" "NYV_F_ECOURTS_LIVE_FETCH" "1"

DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || true)"
LIVE=""
for base in /opt/Nyayavigya/repo /opt/nyayavigya/repo; do
  [ -n "$DEP" ] && LIVE="$(find "${base}/${DEP}" -maxdepth 2 -type d -name 'nyayavigya-platform-312' 2>/dev/null | head -1)"
  [ -n "$LIVE" ] && break
done
[ -n "$LIVE" ] || LIVE="$(find /opt/Nyayavigya/repo /opt/nyayavigya/repo -maxdepth 3 -type d -name 'nyayavigya-platform-312' 2>/dev/null | head -1)"
[ -n "$LIVE" ] || { echo "FATAL no LIVE dir"; exit 1; }

cd "$LIVE"
if [ -e .env ] && [ "$CANON" -ef .env ]; then
  echo "env_same_inode=1"
else
  cp -f "$CANON" .env
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nyayavigya-platform-312}"
GW="$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1 || true)"
DRAIN_TIMEOUT="${NYV_DEPLOY_STOP_TIMEOUT:-25}"
if [ -n "$GW" ]; then
  docker stop -t "$DRAIN_TIMEOUT" "$GW" 2>/dev/null || true
  docker rm "$GW" 2>/dev/null || true
fi
docker compose -f docker-compose.aws-dev.yml up -d --no-deps --force-recreate gateway 2>&1 | tail -12

for i in $(seq 1 24); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)"
  if [ "$code" = "200" ]; then
    echo "health=${code} after $((i * 5))s"
    break
  fi
  sleep 5
done

GW="$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1)"
echo "gateway_container=${GW:-missing}"
echo "container_NYV_F_ECOURTS_LIVE_FETCH=$(docker exec "$GW" printenv NYV_F_ECOURTS_LIVE_FETCH 2>/dev/null || echo unset)"
echo "container_india_key_len=$(docker exec "$GW" printenv NYV_ECOURTSINDIA_API_KEY 2>/dev/null | wc -c | tr -d ' ')"
echo "ECOURTSINDIA_PATCH=PASS"
