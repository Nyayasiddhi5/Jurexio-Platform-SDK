#!/usr/bin/env bash
# NV-PARTNER-DEMO-UNLIMITED + Bedrock-first + Gemini pool patch on live EC2.
# Does NOT print secret values. Requires SSM / shell on jrx-prod with GO.
# Optional: GEMINI_KEYS_FILE=/path/to/gemini-api-keys.env (KEY=value lines only).
set -euo pipefail

CURRENT="$(cat /opt/Jurexio/CURRENT_DEPLOY 2>/dev/null || echo '')"
if [ -z "$CURRENT" ]; then
  LIVE="$(ls -dt /opt/Jurexio/repo/* 2>/dev/null | head -1)"
else
  LIVE="$(ls -dt /opt/Jurexio/repo/${CURRENT}* 2>/dev/null | head -1)"
fi
[ -n "${LIVE:-}" ] || { echo "no LIVE dir"; exit 1; }
cd "$LIVE"
echo "[partner-serving-env] LIVE=$LIVE"

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
  echo "  set ${k} (len=${#v})"
}

# Product serving (demo / E2E) — safety ring stays on
set_kv JRX_PARTNER_DEMO_UNLIMITED 1
set_kv JRX_PARTNER_MAX_TOKENS_FLOOR 16384
set_kv JRX_PARTNER_SERVING_TIER enterprise
set_kv JRX_CREDIT_ENFORCE 1
set_kv JRX_ECOSYSTEM_BEST_OUTCOME 1
set_kv JRX_ALLOW_NSP_NYM_LEAN 0

# Bedrock AWS-credit primary
set_kv JRX_BEDROCK_ENABLED on
set_kv JRX_ROUTER_BEDROCK_FIRST on
set_kv AWS_BEDROCK_REGION ap-south-1
set_kv AWS_REGION ap-south-1

# Cascade robustness
set_kv JRX_LLM_PROVIDER_TIMEOUT_MS 90000
set_kv JRX_LLM_PROVIDER_STREAM_TIMEOUT_MS 180000
set_kv JRX_LLM_HEDGE_MS 2500
set_kv JRX_ORCH_WALL_CLOCK_MS 540000

# Merge Gemini pool from file if provided (never echo values)
if [ -n "${GEMINI_KEYS_FILE:-}" ] && [ -f "$GEMINI_KEYS_FILE" ]; then
  echo "[partner-serving-env] merging Gemini keys from file (names only)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    k="${line%%=*}"; v="${line#*=}"
    case "$k" in
      GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY|GEMINI_API_KEYS|JRX_GOOGLE_API_KEY)
        set_kv "$k" "$v"
        ;;
    esac
  done < "$GEMINI_KEYS_FILE"
else
  echo "[partner-serving-env] skip Gemini merge (set GEMINI_KEYS_FILE to sync pool)"
fi

COMPOSE_DIR="/opt/Jurexio/live"
if [ -d "$COMPOSE_DIR" ]; then
  cd "$COMPOSE_DIR"
elif [ -f /opt/Jurexio/docker-compose.aws-dev.yml ]; then
  cd /opt/Jurexio
else
  cd "$LIVE"
fi

docker compose -f docker-compose.aws-dev.yml restart gateway 2>/dev/null || \
  docker restart jrx-gateway 2>/dev/null || true
sleep 12
curl -sf http://127.0.0.1:5000/api/jrx/health | head -c 200
echo ""
curl -sf http://127.0.0.1:5000/api/jrx/health/providers | head -c 400
echo ""
