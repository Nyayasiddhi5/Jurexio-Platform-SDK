#!/usr/bin/env bash
# NV-DEMO-WEEK-QUALITY-001 — Bedrock flagship first, Gemini 3.x second (investor demo week).
# Patches gateway env on nysdev and restarts nyv-gateway (no image rebuild).
#
# Cascade (legal/counsel tasks, NSP/NYM best-outcome):
#   Bedrock Sonnet 5 → Opus 5 → … → gemini-3.7-flash → gemini-3-1-pro-preview (fallback) → AgentZero
#
# Revert: set NYV_PARTNER_LEGAL_PREMIUM_FIRST=1 and restore prior NYV_LLM_CASCADE_LEAD, or run
# with DEMO_WEEK_REVERT=1 after saving a backup (this script backs up first).
set -euo pipefail

ENV_FILE="${NYV_ENV_FILE:-/opt/Nyayavigya/secrets/.env.production}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${ENV_FILE}.demo-week-backup-${STAMP}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: env file not found: $ENV_FILE" >&2
  exit 1
fi

cp "$ENV_FILE" "$BACKUP"
echo "backup=$BACKUP"

patch_kv() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

if [[ "${DEMO_WEEK_REVERT:-0}" == "1" ]]; then
  LATEST="$(ls -t "${ENV_FILE}.demo-week-backup-"* 2>/dev/null | head -1 || true)"
  if [[ -z "$LATEST" ]]; then
    echo "FAIL: no demo-week backup to revert" >&2
    exit 1
  fi
  cp "$LATEST" "$ENV_FILE"
  echo "reverted from $LATEST"
else
  # Bedrock-first (NOT API-first). Example had PREMIUM_FIRST=1 on host — wrong for demo quality.
  patch_kv NYV_PARTNER_LEGAL_PREMIUM_FIRST 0
  patch_kv NYV_ROUTER_BEDROCK_FIRST on
  patch_kv NYV_BEDROCK_ENABLED on
  patch_kv NYV_LLM_OPENROUTER_FREE_FIRST off
  patch_kv NYV_LADDER_COST_FIRST 0
  patch_kv NYV_PARTNER_MAX_TOKENS_FLOOR 16384
  patch_kv NYV_PARTNER_MAX_TOKENS_CHAT 16384
  patch_kv NYV_PARTNER_MAX_TOKENS_FAST 16384
  patch_kv NYV_QUEEN_LEAF_MAX_TOKENS 16384
  patch_kv NYV_QUEEN_SYNTHESIS_MAX_TOKENS 16384
  patch_kv NYV_LLM_HEDGE_MS 0
  patch_kv NYV_LLM_TIMEOUT_MS 240000
  patch_kv NYV_LLM_PROVIDER_TIMEOUT_MS 90000
  patch_kv NYV_LLM_ATTEMPT_DEEP_MS 180000
  patch_kv NYV_LLM_PARTNER_DRAFT_TIMEOUT_MS 240000
  patch_kv NYV_SARVAM_MAX_OUTPUT_TOKENS 4096
  patch_kv NYV_SARVAM_DISABLED 1
  patch_kv NYV_LANGUAGE_PROVIDER gemini
  patch_kv NYV_GEMINI_LANGUAGE_MODEL gemini-3.7-flash
  patch_kv NYV_ORCHESTRATE_TIMEOUT_MS 180000
  patch_kv NYV_LLM_CASCADE_LEAD 'us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,global.anthropic.claude-sonnet-4-6,global.anthropic.claude-opus-4-6-v1,deepseek.v3.2,us.deepseek.r1-v1:0'
  patch_kv NYV_PARTNER_LEGAL_PREMIUM_MODELS 'global.anthropic.claude-sonnet-5,us.anthropic.claude-opus-5,gemini-3.7-flash,gemini-3-1-pro-preview'
  patch_kv NYV_LLM_CASCADE_GEMINI 'gemini-3.7-flash,gemini-3-1-pro-preview,gemini-3-flash-preview,gemini-3.1-flash-lite'
  patch_kv NYV_GEMINI_PRO_MODEL gemini-3-1-pro-preview
  patch_kv NYV_GEMINI_FLASH_MODEL gemini-3.7-flash
  patch_kv NYV_DEMO_WEEK_QUALITY_UNTIL '2026-08-28T23:59:59Z'
  echo "demo-week quality cascade applied"
fi

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [[ -n "$LIVE" && -d "$LIVE" ]]; then
  cp "$ENV_FILE" "$LIVE/.env"
  echo "synced canonical -> $LIVE/.env"
fi

echo "--- diff (keys only) ---"
diff "$BACKUP" "$ENV_FILE" | grep -E '^[<>].*(NYV_PARTNER|NYV_LLM|NYV_ROUTER|NYV_BEDROCK|NYV_GEMINI|NYV_QUEEN|NYV_DEMO)' || true

DRAIN="${NYV_GATEWAY_DRAIN_SEC:-30}"
echo "=== recreating nyv-gateway (env_file reload) ==="
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
if [[ -n "$LIVE" && -f "$LIVE/docker-compose.aws-dev.yml" ]]; then
  (cd "$LIVE" && docker compose -f docker-compose.aws-dev.yml up -d gateway) 2>&1 | tail -5
elif docker ps --format '{{.Names}}' | grep -qx nyv-gateway; then
  docker stop -t "$DRAIN" nyv-gateway
  docker start nyv-gateway
else
  echo "WARN: nyv-gateway not running"
fi

sleep 8
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_attempt_$i=$code"
  [[ "$code" == "200" ]] && break
  sleep 3
done

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [[ -n "$LIVE" && -f "$LIVE/scripts/jrx-verify-ingress.sh" ]]; then
  bash "$LIVE/scripts/jrx-verify-ingress.sh" 2>&1 | tail -6
fi

echo "=== demo-week quality models complete ==="
