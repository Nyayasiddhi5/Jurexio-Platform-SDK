#!/usr/bin/env bash
# Run LC5–LC8 browser UAT on nysdev (password stays on host — NV-SECRETS-001).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
export UAT_ADMIN_EMAIL="${UAT_ADMIN_EMAIL:-admin@nyayavigya.in}"
export UAT_ADMIN_PASSWORD="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
export CONSOLE_URL="${CONSOLE_URL:-https://console.nyayasiddhi.online}"
export GATEWAY="${GATEWAY:-https://api.nyayasiddhi.online}"
export UAT_SSE_WAIT_MS="${UAT_SSE_WAIT_MS:-240000}"

WORKDIR="/tmp/jrx-lc-uat-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

# Script body injected by caller (base64) or present beside this wrapper.
SCRIPT="${LC_UAT_SCRIPT_PATH:-}"
if [ -z "$SCRIPT" ] || [ ! -f "$SCRIPT" ]; then
  echo "missing LC_UAT_SCRIPT_PATH" >&2
  exit 2
fi
cp "$SCRIPT" "$WORKDIR/jrx-uat-lc5-lc8-browser.mjs"
cd "$WORKDIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node missing on host" >&2
  exit 2
fi

if [ ! -d node_modules/@playwright/test ]; then
  npm init -y >/dev/null 2>&1
  npm install @playwright/test@1.59.1 --silent 2>/dev/null
  npx playwright install chromium 2>/dev/null || true
fi

node nv-uat-lc5-lc8-browser.mjs
RC=$?
echo "=== LC_UAT_EXIT=$RC ==="
exit "$RC"
