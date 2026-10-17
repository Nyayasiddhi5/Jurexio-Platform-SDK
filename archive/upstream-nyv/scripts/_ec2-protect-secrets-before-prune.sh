#!/usr/bin/env bash
# NV-SECRETS-PROTECT-001 — snapshot canonical env before docker prune / deploy cleanup.
# Runs ON nysdev EC2 (or via SSM). Never echoes secret values — key lens = length/count only.
#
# Usage (on-host):
#   sudo bash scripts/_ec2-protect-secrets-before-prune.sh
#   sudo bash scripts/_ec2-protect-secrets-before-prune.sh --verify-only
#
# Safe docker prune (after snapshot):
#   docker system prune -af          # images/containers only — NEVER volumes named pgdata/redis
#   docker volume prune              # ⚠ DO NOT run without checking volume list first
#
# NEVER delete or truncate:
#   /opt/Nyayavigya/secrets/
#   /opt/Nyayavigya/secrets/.env.production
set -euo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
SECRETS_DIR="/opt/Nyayavigya/secrets"
LAST_GOOD="${SECRETS_DIR}/LAST_GOOD.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
VERIFY_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
  esac
done

die() { echo "FATAL: $*" >&2; exit 1; }

key_lens_report() {
  local f="$1"
  echo "file_bytes=$(wc -c < "$f" | tr -d ' ')"
  echo "key_count=$(grep -cE '^[A-Z_]+=' "$f" 2>/dev/null || echo 0)"
  echo "sdk_key_lines=$(grep -cE '^NYV_SDK_KEY_' "$f" 2>/dev/null || echo 0)"
  for k in NYV_SDK_KEY_NSP NYV_SDK_KEY_NYM DATABASE_URL REDIS_URL NV_PII_ENCRYPTION_KEY JWT_SECRET; do
    local len
    len=$(grep -E "^${k}=" "$f" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
    echo "${k}_len=${len}"
  done
}

echo "[protect-secrets] canonical=$CANON stamp=$STAMP verify_only=$VERIFY_ONLY"

[ -f "$CANON" ] || die "missing canonical env: $CANON"

# Minimum sanity: deploy-aws-ssm.sh REQUIRED_ENV_KEYS + at least one SDK key
MISSING=""
for k in DATABASE_URL REDIS_URL NV_PII_ENCRYPTION_KEY JWT_SECRET NYV_SDK_KEY_NSP; do
  len=$(grep -E "^${k}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
  if [ "${len:-0}" -le 1 ]; then
    MISSING="$MISSING $k"
  fi
done
[ -z "$MISSING" ] || die "canonical env missing or empty required key(s):$MISSING"

echo "[protect-secrets] BEFORE snapshot lens:"
key_lens_report "$CANON"

if [ "$VERIFY_ONLY" -eq 1 ]; then
  echo "[protect-secrets] verify-only OK"
  exit 0
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

SNAP="${SECRETS_DIR}/.env.production.snapshot-${STAMP}"
cp -a "$CANON" "$SNAP"
chmod 600 "$SNAP"

# LAST_GOOD = most recent known-good copy for zero-risk restore (same keys, no rotation)
cp -a "$CANON" "$LAST_GOOD"
chmod 600 "$LAST_GOOD"

echo "[protect-secrets] snapshot=$SNAP"
echo "[protect-secrets] LAST_GOOD=$LAST_GOOD"
echo "[protect-secrets] AFTER snapshot lens:"
key_lens_report "$LAST_GOOD"

echo "[protect-secrets] DONE — safe to prune docker images/containers; do NOT rm $SECRETS_DIR"
