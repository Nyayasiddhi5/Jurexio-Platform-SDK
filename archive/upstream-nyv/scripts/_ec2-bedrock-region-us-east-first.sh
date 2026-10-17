#!/usr/bin/env bash
# Force us-east-1-first for Claude 5.5 until ap-south-1 5.5 is account-enabled.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$CANON"; then sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"; else echo "${k}=${v}" >> "$CANON"; fi
  echo "set_name=${k}"
}
set_kv NYV_BEDROCK_REGION_ORDER "us-east-1,ap-south-1"
bash "$(dirname "$0")/_ec2-claude55-phase-env-patch.sh" 6
