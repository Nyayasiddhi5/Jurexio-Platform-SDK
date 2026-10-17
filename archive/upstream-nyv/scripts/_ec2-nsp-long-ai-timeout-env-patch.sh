#!/usr/bin/env bash
# NV-LONG-AI-HTTP-TIMEOUT-001 — nysdev long AI wall clocks (names only in logs).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
[ -f "$CANON" ] || { echo "missing $CANON"; exit 1; }

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"
  else
    echo "${k}=${v}" >> "$CANON"
  fi
  echo "set_name=${k}"
}

set_kv NYV_ORCHESTRATE_TIMEOUT_MS 600000
set_kv NYV_SDK_TIMEOUT_MS 600000
set_kv NYV_ORCH_WALL_CLOCK_MS 590000
set_kv NYV_HTTP_LONG_AI_TIMEOUT_MS 600000
set_kv NYV_HTTP_SERVER_TIMEOUT_MS 600000
set_kv NYV_LLM_PROVIDER_TIMEOUT_MS 120000
set_kv NYV_LLM_TIMEOUT_MS 180000
set_kv NYS_KNOWLEDGE_TIMEOUT_MS 90000
set_kv NYV_ADAPTIVE_RAG_TIMEOUT_MS 45000
set_kv NYV_PG_STATEMENT_TIMEOUT_MS 180000

echo "ENV_LONG_AI_TIMEOUT_PATCH_OK"
