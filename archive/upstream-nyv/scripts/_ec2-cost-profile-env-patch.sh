#!/usr/bin/env bash
# NV-LLM-COST-PROFILE-001 pilot — nysdev canonical env (names logged only).
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

set_kv NYV_LLM_COST_PROFILE cost-first
set_kv NYV_BEDROCK_REGION_ORDER "ap-south-1,us-east-1"

for k in NYV_LLM_COST_PROFILE NYV_BEDROCK_REGION_ORDER NYV_NSP_UNLIMITED; do
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    echo "present_name=${k}"
  else
    echo "absent_name=${k}"
  fi
done

echo "ENV_PATCH_OK"
