#!/usr/bin/env bash
# NV-NSP-DEMO-QUALITY-001 — nysdev partner demo LLM + web search (names only in logs).
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

unset_kv() {
  local k="$1"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "/^${k}=/d" "$CANON"
    echo "unset_name=${k}"
  else
    echo "absent_name=${k}"
  fi
}

unset_kv NYV_LLM_COST_PROFILE
set_kv NYV_BEDROCK_REGION_ORDER "us-east-1,ap-south-1"
set_kv NYV_LADDER_COST_FIRST "0"
set_kv NYV_WEB_SEARCH_CASCADE "gemini,tavily,serper,perplexity,openrouter"

echo "ENV_DEMO_QUALITY_PATCH_OK"
