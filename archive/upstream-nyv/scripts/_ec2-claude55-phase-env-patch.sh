#!/usr/bin/env bash
# NV-BEDROCK-CLAUDE55-ROLLOUT — set phase flags on canonical env + recreate gateway.
# Usage on host: bash _ec2-claude55-phase-env-patch.sh <phase>   phase = 0|2|3|4|5|6|off
set -euo pipefail
PHASE="${1:-0}"
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

unset_kv() {
  local k="$1"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "/^${k}=/d" "$CANON"
    echo "unset_name=${k}"
  fi
}

# Canary host: do not freeze baseline while rolling 5.5 (QA regression uses separate doc profile).
unset_kv NYV_LLM_BASELINE_FROZEN

case "$PHASE" in
  off|0)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 0
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 0
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 0
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 0
    ;;
  2)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 1
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 0
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 0
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 0
    ;;
  3)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 1
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 1
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 0
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 0
    ;;
  4)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 1
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 1
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 1
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 0
    ;;
  5)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 1
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 1
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 1
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 1
    ;;
  6)
    set_kv NYV_F_BEDROCK_HAIKU_55_FAST 1
    set_kv NYV_F_BEDROCK_SONNET_55_CHAT 1
    set_kv NYV_F_BEDROCK_OPUS_55_COUNSEL 1
    set_kv NYV_F_BEDROCK_QUEEN_55_LEAVES 1
    set_kv NYV_PROMPT_CACHE 1
    set_kv NYV_PROMPT_CACHE_MIN_CHARS_CLAUDE55 512
    set_kv NYV_F_DOCPARSE_TEXTRACT_PAGE 1
    # Claude 5.5 not in ap-south-1 for this account yet — explicit override cost-first profile.
    set_kv NYV_BEDROCK_REGION_ORDER "us-east-1,ap-south-1"
    ;;
  *)
    echo "unknown phase=$PHASE"; exit 2 ;;
esac

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
GW="$(docker ps --format '{{.Names}}' | grep -E '(^|_)nyv-gateway$' | head -1 || true)"
DRAIN_TIMEOUT="${NYV_DEPLOY_STOP_TIMEOUT:-25}"
if [ -n "$GW" ]; then
  docker stop -t "$DRAIN_TIMEOUT" "$GW" 2>/dev/null || true
  docker rm "$GW" 2>/dev/null || true
fi
docker compose -f docker-compose.aws-dev.yml up -d --no-deps --force-recreate gateway 2>&1 | tail -12

if [ -f scripts/jrx-verify-ingress.sh ]; then
  bash scripts/_ec2-console-ingress-refresh.sh 2>&1 | tail -8 || true
fi

GW="$(docker ps --format '{{.Names}}' | grep -E '(^|_)nyv-gateway$' | head -1)"
echo "gateway_container=${GW:-missing}"
echo "=== flag lens (container) ==="
for k in NYV_F_BEDROCK_HAIKU_55_FAST NYV_F_BEDROCK_SONNET_55_CHAT NYV_F_BEDROCK_OPUS_55_COUNSEL NYV_F_BEDROCK_QUEEN_55_LEAVES NYV_PROMPT_CACHE_MIN_CHARS_CLAUDE55; do
  v=$(docker exec "$GW" printenv "$k" 2>/dev/null || echo unset)
  echo "${k}=${v}"
done
echo "PHASE_${PHASE}_ENV_PATCH_OK"
