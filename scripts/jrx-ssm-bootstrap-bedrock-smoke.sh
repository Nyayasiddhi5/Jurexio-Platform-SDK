#!/usr/bin/env bash
# JRX-SSM-SMOKE-001 — bootstrap Bedrock/LLM SSM params under /jurexio/prod for smoke.
# Greenfield US: uses JRX-native param names (see env.production.jurexio.example).
# Optional legacy copy from NYV SSM: JRX_SSM_COPY_FROM_NYV=1 (default off).
# Never prints secret values. Never writes to nysdev env files.
set -euo pipefail

DRY_RUN=0
COPY_FROM_NYV="${JRX_SSM_COPY_FROM_NYV:-0}"
DST_PREFIX="${JRX_SSM_DEST_PREFIX:-/jurexio/prod}"
REGION="${JRX_AWS_REGION:-us-east-1}"
SRC_PREFIX="${JRX_SSM_SOURCE_PREFIX:-/nyayavigya/dev}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?AWS creds required}"

# JRX-native SSM leaf names (values fetched at runtime, never logged)
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

# NYV source leaf → JRX dest leaf when JRX_SSM_COPY_FROM_NYV=1
NYV_TO_JRX=(
  "NYV_BEDROCK_ENABLED:JRX_BEDROCK_ENABLED"
  "NYV_ROUTER_BEDROCK_FIRST:JRX_ROUTER_BEDROCK_FIRST"
  "AWS_BEDROCK_REGION:AWS_BEDROCK_REGION"
  "NYV_BEDROCK_REGION_ORDER:JRX_BEDROCK_REGION_ORDER"
  "BEDROCK_MODEL_ID:BEDROCK_MODEL_ID"
  "AWS_ACCESS_KEY_ID:AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY:AWS_SECRET_ACCESS_KEY"
  "AWS_SESSION_TOKEN:AWS_SESSION_TOKEN"
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

copy_nyv_one() {
  local src_leaf="$1"
  local dst_leaf="$2"
  local src="${SRC_PREFIX}/${src_leaf}"
  if ! aws ssm get-parameter --name "$src" --with-decryption --region "$REGION" >/dev/null 2>&1; then
    echo "skip missing nyv src param name=${src_leaf}"
    return 0
  fi
  val="$(aws ssm get-parameter --name "$src" --with-decryption --region "$REGION" --query Parameter.Value --output text)"
  put_param "$dst_leaf" "$val"
  echo "copied nyv ${src_leaf} -> ${dst_leaf}"
}

ensure_jrx_from_env() {
  local name="$1"
  local env_var="$1"
  if [ -z "${!env_var:-}" ]; then
    echo "skip unset env for ${name} (set locally or use JRX_SSM_COPY_FROM_NYV=1)"
    return 0
  fi
  put_param "$name" "${!env_var}"
}

echo "== JRX SSM Bedrock smoke bootstrap region=${REGION} dst=${DST_PREFIX} copy_from_nyv=${COPY_FROM_NYV} =="

if [ "$COPY_FROM_NYV" = "1" ]; then
  echo "== NYV → JRX copy (source prefix ${SRC_PREFIX}) =="
  for pair in "${NYV_TO_JRX[@]}"; do
    src_leaf="${pair%%:*}"
    dst_leaf="${pair##*:}"
    copy_nyv_one "$src_leaf" "$dst_leaf"
  done
else
  echo "== JRX-native params (from env or existing SSM; no NYV read) =="
  for n in "${JRX_NAMES[@]}"; do
    dst="${DST_PREFIX}/${n}"
    if aws ssm get-parameter --name "$dst" --with-decryption --region "$REGION" >/dev/null 2>&1; then
      echo "exists param name=${n}"
      continue
    fi
    ensure_jrx_from_env "$n"
  done
fi

echo "== done (also store JRX DATABASE_URL, JWT, SDK keys under ${DST_PREFIX}/ separately) =="
