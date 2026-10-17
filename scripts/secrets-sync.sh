#!/usr/bin/env bash
# =============================================================================
# secrets-sync.sh — one-shot script to push every key/value in a local .env
# file into AWS Secrets Manager under `nyayavigya/<env>/gateway/<key_lower>`.
#
# Usage:
#   bash scripts/secrets-sync.sh prod   .env.prod
#   bash scripts/secrets-sync.sh staging .env.staging
#
# Behaviour:
#   - Each line `FOO=bar` becomes secret `nyayavigya/<env>/gateway/foo` (lower).
#   - If the secret already exists, it gets a NEW VERSION (Secrets Manager
#     keeps the previous one; rollback is `aws secretsmanager update-secret`
#     to the previous version-id).
#   - The PLACEHOLDER_NOT_YET_SET sentinel is overwritten on first sync.
#   - Comment / blank lines are skipped.
#   - The local .env is NEVER deleted by this script — that's a separate manual
#     step documented in `docs/v3.1.2/completed_docs/JRX-SECRETS-MANAGEMENT.md` (so you can verify
#     the round-trip first).
# =============================================================================
set -euo pipefail

ENV="${1:-}"
SRC="${2:-}"
REGION="${AWS_REGION:-ap-south-1}"
DRY_RUN="${JRX_DRY_RUN:-0}"

if [ -z "$ENV" ] || [ -z "$SRC" ]; then
  echo "usage: $0 <prod|staging> <path/to/.env>" >&2
  exit 2
fi
case "$ENV" in prod|staging) ;; *) echo "env must be prod or staging" >&2; exit 2 ;; esac
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 2; }
command -v aws >/dev/null || { echo "awscli not found" >&2; exit 2; }

PREFIX="nyayavigya/${ENV}/gateway"
echo "== Source: $SRC"
echo "== Target: ${PREFIX}/* in region $REGION"
echo "== Dry-run: $DRY_RUN"
echo

COUNT=0
SKIPPED=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|"#"*) continue ;;
  esac
  KEY="${line%%=*}"
  VAL="${line#*=}"
  # Strip wrapping quotes
  VAL="${VAL#\"}"; VAL="${VAL%\"}"
  VAL="${VAL#\'}"; VAL="${VAL%\'}"
  if [ -z "$KEY" ] || [ -z "$VAL" ]; then SKIPPED=$((SKIPPED+1)); continue; fi
  KEY_LC=$(echo "$KEY" | tr 'A-Z' 'a-z')
  NAME="${PREFIX}/${KEY_LC}"

  if [ "$DRY_RUN" = "1" ]; then
    printf "  [dry] %s  (len=%d)\n" "$NAME" "${#VAL}"
    COUNT=$((COUNT+1))
    continue
  fi

  if aws secretsmanager describe-secret --region "$REGION" --secret-id "$NAME" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --region "$REGION" \
        --secret-id "$NAME" --secret-string "$VAL" >/dev/null
    printf "  ↻ updated %s\n" "$NAME"
  else
    aws secretsmanager create-secret --region "$REGION" \
        --name "$NAME" --secret-string "$VAL" \
        --tags Key=Project,Value=Jurexio Key=Env,Value="$ENV" Key=ManagedBy,Value=secrets-sync.sh \
        >/dev/null
    printf "  + created %s\n" "$NAME"
  fi
  COUNT=$((COUNT+1))
done < "$SRC"

echo
echo "Synced $COUNT secret(s); skipped $SKIPPED malformed line(s)."
echo "Verify a value (locally, will not log it): "
echo "  aws secretsmanager get-secret-value --region $REGION --secret-id ${PREFIX}/<key_lower> --query SecretString --output text | wc -c"
