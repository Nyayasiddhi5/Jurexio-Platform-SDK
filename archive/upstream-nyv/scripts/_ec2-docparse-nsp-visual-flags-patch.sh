#!/usr/bin/env bash
# NV-DOCPARSE-NSP-FLAGS-001 — enable depict + attach-understand on nysdev (flag-only, no key rotation).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
[ -f "$CANON" ] || { echo "missing $CANON"; exit 1; }
chmod 600 "$CANON" 2>/dev/null || true

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"
  else
    echo "${k}=${v}" >> "$CANON"
  fi
  echo "set_name=${k}"
}

for k in \
  NYV_F_DOCPARSE_SDK \
  NYV_F_DOCPARSE_LLM_FALLBACK \
  NYV_F_DOCPARSE_EVIDENCE_DEPICT \
  NYV_F_DOCPARSE_ATTACH_UNDERSTAND; do
  set_kv "$k" 1
done

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
echo "=== flag lens (container, docparse) ==="
for k in NYV_F_DOCPARSE_SDK NYV_F_DOCPARSE_LLM_FALLBACK NYV_F_DOCPARSE_EVIDENCE_DEPICT NYV_F_DOCPARSE_ATTACH_UNDERSTAND; do
  v="$(docker exec "$GW" printenv "$k" 2>/dev/null || echo unset)"
  echo "${k}=${v}"
done
echo "DOCPARSE_NSP_VISUAL_FLAGS_PATCH_OK"
