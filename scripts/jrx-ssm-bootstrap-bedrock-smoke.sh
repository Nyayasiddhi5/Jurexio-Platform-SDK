#!/usr/bin/env bash
# JRX-SSM-SMOKE-001 — copy Bedrock/LLM-related SSM params NYV → /jurexio/prod for smoke only.
# Never prints secret values. Never writes to nysdev env files.
set -euo pipefail

DRY_RUN=0
SRC_PREFIX="${JRX_SSM_SOURCE_PREFIX:-/nyayavigya/dev}"
DST_PREFIX="${JRX_SSM_DEST_PREFIX:-/jurexio/prod}"
REGION="${JRX_AWS_REGION:-ap-south-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?AWS creds required}"

# Param names only (values fetched at runtime, never logged)
NAMES=(
  NYV_BEDROCK_ENABLED
  NYV_ROUTER_BEDROCK_FIRST
  AWS_BEDROCK_REGION
  NYV_BEDROCK_REGION_ORDER
  BEDROCK_MODEL_ID
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
)

copy_one() {
  local name="$1"
  local src="${SRC_PREFIX}/${name}"
  local dst="${DST_PREFIX}/${name}"
  if ! aws ssm get-parameter --name "$src" --with-decryption --region "$REGION" >/dev/null 2>&1; then
    echo "skip missing src param name=${name}"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "would copy ${src} -> ${dst}"
    return 0
  fi
  val="$(aws ssm get-parameter --name "$src" --with-decryption --region "$REGION" --query Parameter.Value --output text)"
  aws ssm put-parameter --name "$dst" --value "$val" --type SecureString --overwrite --region "$REGION" >/dev/null
  echo "copied param name=${name} len=${#val}"
}

echo "== JRX SSM Bedrock smoke bootstrap region=${REGION} =="
for n in "${NAMES[@]}"; do copy_one "$n"; done
echo "== done (store JRX-specific JWT/DB under ${DST_PREFIX}/ separately) =="
