#!/usr/bin/env bash
# nv-sync-shared-sdk-keys.sh — Mirror one integration key to all NYV_SDK_KEY_* vars.
#
# Default source: NYV_SDK_KEY_NSP from runtime.env (or NYV_SDK_KEY_SHARED if set).
# Writes gitignored: .local/secrets/ecosystem-shared-integration.env
# Never prints secret values.
#
# Usage (from repo root or app root):
#   bash nyayavigya-platform-312/scripts/jrx-sync-shared-sdk-keys.sh
#   source .local/secrets/ecosystem-shared-integration.env
#   NYV_SDK_SHARED_KEYS=1 npm run partner:smoke:ec2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/.." && pwd)"
SECRETS="$REPO_ROOT/.local/secrets"
OUT="$SECRETS/ecosystem-shared-integration.env"
RUNTIME="$SECRETS/runtime.env"

mkdir -p "$SECRETS"
chmod 700 "$SECRETS" 2>/dev/null || true

read_key() {
  local name="$1" file="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${name}=" "$file" | head -1 | cut -d= -f2- | tr -d '\r'
}

SRC=""
if [[ -n "${NYV_SDK_KEY_SHARED:-}" ]]; then
  SRC="$NYV_SDK_KEY_SHARED"
elif [[ -f "$RUNTIME" ]]; then
  SRC="$(read_key NYV_SDK_KEY_NSP "$RUNTIME" || true)"
fi
if [[ -z "$SRC" && -f "$APP_ROOT/.env" ]]; then
  SRC="$(read_key NYV_SDK_KEY_NSP "$APP_ROOT/.env" || true)"
fi
if [[ -z "$SRC" ]]; then
  echo "[shared-keys] FAIL: no NYV_SDK_KEY_SHARED / NYV_SDK_KEY_NSP found (runtime.env or .env)" >&2
  exit 1
fi

{
  echo "# Generated $(date -u +%Y-%m-%dT%H:%MZ) — integration shared key mode"
  echo "# All ecosystem platforms use the SAME key until production rotation."
  echo "NYV_SDK_SHARED_KEYS=1"
  echo "NYV_SDK_KEY_SHARED=${SRC}"
  for sku in NSP NSPM NSI NSA NSM NYM JRX; do
    echo "NYV_SDK_KEY_${sku}=${SRC}"
  done
} > "$OUT"
chmod 600 "$OUT"

echo "[shared-keys] wrote $OUT (chmod 600)"
echo "[shared-keys] all 7 NYV_SDK_KEY_* mirror integration key (value not printed)"
echo "[shared-keys] source it before smoke: source $OUT"
