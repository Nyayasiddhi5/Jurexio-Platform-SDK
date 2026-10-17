#!/usr/bin/env bash
# Re-apply Jurexio-only files after nyayavigya export (NYV repo is read-only upstream).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$ROOT/patches/jurexio"

apply() {
  local rel="$1"
  local src="$PATCH/$rel"
  local dest="$ROOT/$rel"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -f "$src" "$dest"
    echo "applied $rel"
  fi
}

apply "src/middleware/jrx-jrx-api-prefix-alias.ts"
apply "src/config/jrx-api-prefix.ts"
apply "docker-compose.jurexio-local.yml"
apply ".env.jurexio.local.example"
apply ".env.jurexio.aws.example"
apply "scripts/jrx-init-local-env.sh"
apply "scripts/jrx-provision-rds-database.sh"
chmod +x "$ROOT/scripts/jrx-init-local-env.sh" "$ROOT/scripts/jrx-provision-rds-database.sh" 2>/dev/null || true

if [[ -f "$PATCH/client-sdk.package.json" ]]; then
  cp -f "$PATCH/client-sdk.package.json" "$ROOT/packages/client-sdk/package.json"
  echo "applied packages/client-sdk/package.json"
fi

echo "== jurexio patches applied =="
