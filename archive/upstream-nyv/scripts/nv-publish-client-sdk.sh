#!/usr/bin/env bash
# NV-SDK-PUBLISH-001 — Build and dry-run npm publish for @nyayavigya/client-sdk
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$APP_ROOT/packages/client-sdk"
cd "$SDK"
npm run build
echo "[sdk] dry-run publish @nyayavigya/client-sdk@$(node -p "require('./package.json').version")"
npm publish --dry-run --access public
echo "[sdk] To publish live: cd packages/client-sdk && npm publish --access public"
