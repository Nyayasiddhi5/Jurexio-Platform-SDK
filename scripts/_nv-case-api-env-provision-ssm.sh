#!/usr/bin/env bash
# Provision NYS_CASE_API_* on nysdev gateway secrets (NV-SECRETS-001: length only in output).
set -euo pipefail

ENVF="/opt/Nyayavigya/secrets/.env.production"
REGION="${NYV_AWS_REGION:-ap-south-1}"
SECRET_ID="nyaya/case_api/http-api-keys"

append_if_missing() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENVF" 2>/dev/null; then
    echo "SKIP_${key}=already_set len=$(grep -E "^${key}=" "$ENVF" | cut -d= -f2- | wc -c | tr -d ' ')"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENVF"
    echo "SET_${key}=added len=$(printf %s "$val" | wc -c | tr -d ' ')"
  fi
}

KEY_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString --output text 2>/dev/null || echo "")

CASE_KEY=""
if [ -n "$KEY_JSON" ]; then
  CASE_KEY=$(python3 - <<PY
import json, sys
raw = """$KEY_JSON"""
try:
    j = json.loads(raw)
    keys = j.get("keys") or []
    print(keys[0] if keys else "")
except Exception:
    print("")
PY
)
fi

echo "SM_SECRET_LEN=$(printf %s "$KEY_JSON" | wc -c | tr -d ' ')"
echo "CASE_KEY_LEN=$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')"

if [ "$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')" -lt 8 ]; then
  echo "ERR=no_case_api_key_from_sm"
  exit 1
fi

append_if_missing "NYS_CASE_API_BASE_URL" "https://nysapi.nyayasiddhi.online"
append_if_missing "NYS_CASE_API_KEY" "$CASE_KEY"
append_if_missing "NYS_CASE_API_TIMEOUT_MS" "30000"
append_if_missing "NYV_F_CASE_API_CNR" "1"
append_if_missing "NYV_F_CASE_API_LEGACY_ENRICH" "1"

# P2: production path returns nysapi (not shadow-only)
if grep -qE '^NYV_F_CASE_API_CNR_SHADOW=' "$ENVF" 2>/dev/null; then
  sed -i '/^NYV_F_CASE_API_CNR_SHADOW=/d' "$ENVF"
  echo "UNSET_NYV_F_CASE_API_CNR_SHADOW=removed"
fi

echo "DONE=case_api_env_provisioned"
