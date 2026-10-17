#!/usr/bin/env bash
# Patch Bedrock env on live EC2 stack and restart gateway only (no postgres/redis recreate).
set -euo pipefail
CURRENT="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo '')"
if [ -z "$CURRENT" ]; then
  LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1)"
else
  LIVE="$(ls -dt /opt/Nyayavigya/repo/${CURRENT}* 2>/dev/null | head -1)"
fi
[ -n "$LIVE" ] || { echo "no LIVE dir"; exit 1; }
cd "$LIVE"
echo "[bedrock-env] LIVE=$LIVE"

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
}
set_kv NYV_BEDROCK_ENABLED on
set_kv NYV_ROUTER_BEDROCK_FIRST on
set_kv AWS_BEDROCK_REGION ap-south-1
set_kv NYV_PG_JOB_WORKER on
set_kv NYV_DOC_PROCESSOR_ENABLED off

# Restart gateway on the EXISTING compose project (deploy dir symlink or CURRENT)
COMPOSE_DIR="/opt/Nyayavigya/live"
if [ -d "$COMPOSE_DIR" ]; then
  cd "$COMPOSE_DIR"
elif [ -f /opt/Nyayavigya/docker-compose.aws-dev.yml ]; then
  cd /opt/Nyayavigya
else
  cd "$LIVE"
fi

docker compose -f docker-compose.aws-dev.yml restart gateway 2>/dev/null || \
  docker restart nyv-gateway 2>/dev/null || true
sleep 12
curl -sf http://127.0.0.1:5000/api/jrx/health | head -c 200
echo ""
