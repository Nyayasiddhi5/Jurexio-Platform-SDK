#!/usr/bin/env sh
# =============================================================================
# secrets-entrypoint.sh — container entrypoint that resolves secret refs from
# AWS Secrets Manager into environment variables BEFORE exec'ing the app.
#
# Two ways a value can be sourced:
#
#   1. Per-key reference: any env var whose value starts with `secret://` is
#      resolved by reading that secret name and assigning the plaintext.
#      Example: JRX_SDK_API_KEY=secret://nyayavigya/prod/nym/sdk_api_key
#
#   2. Bulk prefix sync: if JRX_SECRETS_BACKEND=aws-secrets-manager and
#      JRX_SECRETS_PREFIX is set, every secret under that prefix is fetched and
#      exported using the last `/`-separated segment as the env var name
#      (uppercased, dashes -> underscores).
#      Example: prefix `nyayavigya/prod/gateway`
#               -> secret `nyayavigya/prod/gateway/jwt_secret`
#               -> env var JWT_SECRET
#
# Behaviour:
#   - Secrets that fail to fetch cause the container to exit 64 (config error).
#   - The script never logs secret values; it only logs the keys it set.
#   - awscli must be present in the image; the EC2 instance role grants
#     secretsmanager:GetSecretValue on the matching prefix.
# =============================================================================
set -eu

LOG() { printf "[secrets-entrypoint] %s\n" "$*" >&2; }

if ! command -v aws >/dev/null 2>&1; then
  LOG "FATAL: awscli not found in image. Install it in the Dockerfile."
  exit 64
fi

REGION="${AWS_REGION:-ap-south-1}"

# 1. Bulk prefix sync ---------------------------------------------------------
if [ "${JRX_SECRETS_BACKEND:-}" = "aws-secrets-manager" ] && [ -n "${JRX_SECRETS_PREFIX:-}" ]; then
  LOG "Syncing secrets under prefix: ${JRX_SECRETS_PREFIX}"
  NAMES=$(aws secretsmanager list-secrets --region "$REGION" \
            --filters "Key=name,Values=${JRX_SECRETS_PREFIX}/" \
            --query 'SecretList[].Name' --output text 2>/dev/null || true)
  if [ -z "$NAMES" ]; then
    LOG "WARN: no secrets matched prefix ${JRX_SECRETS_PREFIX}/"
  fi
  for name in $NAMES; do
    leaf=$(echo "$name" | sed 's:.*/::')
    var=$(echo "$leaf" | tr 'a-z-' 'A-Z_')
    val=$(aws secretsmanager get-secret-value --region "$REGION" \
            --secret-id "$name" --query SecretString --output text 2>/dev/null || true)
    if [ -z "$val" ] || [ "$val" = "PLACEHOLDER_NOT_YET_SET" ]; then
      LOG "WARN: $name is unset / placeholder — skipping"
      continue
    fi
    export "$var=$val"
    LOG "  loaded $var (from $name)"
  done
fi

# 2. Per-key reference resolution --------------------------------------------
# POSIX-portable iteration over environment variables that start with `secret://`
for var in $(env | awk -F= '$2 ~ /^secret:\/\// {print $1}'); do
  ref=$(eval "echo \$$var")
  name=$(echo "$ref" | sed 's:^secret://::')
  val=$(aws secretsmanager get-secret-value --region "$REGION" \
          --secret-id "$name" --query SecretString --output text 2>/dev/null || true)
  if [ -z "$val" ] || [ "$val" = "PLACEHOLDER_NOT_YET_SET" ]; then
    LOG "FATAL: $var -> $name has no value (PLACEHOLDER_NOT_YET_SET or missing)"
    exit 64
  fi
  export "$var=$val"
  LOG "  resolved $var <- $name"
done

LOG "exec: $*"
exec "$@"
