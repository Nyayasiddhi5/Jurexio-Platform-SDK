#!/usr/bin/env bash
# JRX-ENV-LOCAL-001 — bootstrap .env for Jurexio (never touches Jurexio hosts/DB).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT/.env.jurexio.local.example"
TARGET="$ROOT/.env"
SECRETS_DIR="$ROOT/.local/secrets"
SECRETS_FILE="$SECRETS_DIR/jurexio-local.env"

if [[ ! -f "$EXAMPLE" ]]; then
  echo "missing $EXAMPLE" >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [[ -f "$TARGET" ]]; then
  echo "== $TARGET already exists — not overwriting (delete manually to re-init)"
else
  cp "$EXAMPLE" "$TARGET"
  echo "== created $TARGET from Jurexio local example"
fi

gen_hex() { openssl rand -hex "$1"; }

append_if_missing() {
  local key="$1"
  local val="$2"
  local file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$val" >>"$file"
}

# Dev-only secrets into gitignored mirror (not committed)
if [[ ! -f "$SECRETS_FILE" ]]; then
  : >"$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  append_if_missing JRX_JWT_SECRET "$(gen_hex 32)" "$SECRETS_FILE"
  append_if_missing JRX_JWT_REFRESH_SECRET "$(gen_hex 32)" "$SECRETS_FILE"
  append_if_missing NV_PII_ENCRYPTION_KEY "$(gen_hex 32)" "$SECRETS_FILE"
  append_if_missing JRX_SDK_KEY_JRX "jrx_local_sk_$(gen_hex 24)" "$SECRETS_FILE"
  echo "== wrote dev secrets (lengths only) to $SECRETS_FILE"
else
  echo "== $SECRETS_FILE exists — keeping existing dev secrets"
fi

# Merge dev secrets into .env (gitignored)
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([A-Za-z0-9_]+)= ]] || continue
  key="${BASH_REMATCH[1]}"
  grep -q "^${key}=" "$TARGET" && continue
  from_secrets="$(grep -m1 "^${key}=" "$SECRETS_FILE" 2>/dev/null | cut -d= -f2- || true)"
  [[ -z "$from_secrets" ]] && continue
  printf '\n%s=%s\n' "$key" "$from_secrets" >>"$TARGET"
done <"$SECRETS_FILE"

echo ""
echo "Next:"
echo "  cd \"$ROOT\""
echo "  npm run infra:jurexio:up"
echo "  npm install && npm run session:preflight"
echo "  npm run dev"
echo "  curl -s http://127.0.0.1:5010/api/jrx/health | head -c 200"
