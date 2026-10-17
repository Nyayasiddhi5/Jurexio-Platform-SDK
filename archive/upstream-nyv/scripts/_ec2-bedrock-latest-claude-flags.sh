#!/usr/bin/env bash
# Patch canonical EC2 env for latest Claude on Bedrock. Never prints secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
[ -f "$CANON" ] || { echo "missing $CANON"; exit 1; }
chmod 600 "$CANON" 2>/dev/null || true

LEAD='us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,global.anthropic.claude-opus-4-7,global.anthropic.claude-sonnet-4-6,global.anthropic.claude-opus-4-6-v1'
PREMIUM='us.anthropic.claude-opus-5,global.anthropic.claude-sonnet-5,gemini-3-1-pro-preview'

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"
  else
    echo "${k}=${v}" >> "$CANON"
  fi
  echo "  set ${k}"
}

set_kv NYV_LLM_CASCADE_LEAD "$LEAD"
set_kv NYV_PARTNER_LEGAL_PREMIUM_MODELS "$PREMIUM"
set_kv NYV_PARTNER_LEGAL_PREMIUM_FIRST 0
set_kv AWS_BEDROCK_REGION us-east-1
set_kv NYV_BEDROCK_REGION_ORDER "us-east-1,ap-south-1"
set_kv NYV_BEDROCK_ENABLED on
echo "CANON_CLAUDE_FLAGS_OK"
