#!/usr/bin/env bash
# JRX-SSM-SMOKE-002 — bootstrap Bedrock/LLM SSM params under /jurexio/prod for smoke.
# Jurexio-only: never reads legacy SSM prefixes. Never prints secret values.
set -euo pipefail

DRY_RUN=0
DST_PREFIX="${JRX_SSM_DEST_PREFIX:-/jurexio/prod}"
REGION="${JRX_AWS_REGION:-us-east-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?AWS creds required}"

JRX_NAMES=(
  JRX_BEDROCK_ENABLED
  JRX_ROUTER_BEDROCK_FIRST
  AWS_BEDROCK_REGION
  JRX_BEDROCK_REGION_ORDER
  BEDROCK_MODEL_ID
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
)

put_param() {
  local dst_name="$1"
  local val="$2"
  local dst="${DST_PREFIX}/${dst_name}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "would put ${dst} len=${#val}"
    return 0
  fi
  aws ssm put-parameter --name "$dst" --value "$val" --type SecureString --overwrite --region "$REGION" >/dev/null
  echo "put param name=${dst_name} len=${#val}"
}

ensure_jrx_from_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "skip unset env for ${name}"
    return 0
  fi
  put_param "$name" "${!name}"
}

echo "== JRX SSM Bedrock smoke bootstrap region=${REGION} dst=${DST_PREFIX} =="

for n in "${JRX_NAMES[@]}"; do
  dst="${DST_PREFIX}/${n}"
  if aws ssm get-parameter --name "$dst" --with-decryption --region "$REGION" >/dev/null 2>&1; then
    echo "exists param name=${n}"
    continue
  fi
  ensure_jrx_from_env "$n"
done

echo "== done (also store JRX DATABASE_URL, JWT, SDK keys under ${DST_PREFIX}/ separately) =="
