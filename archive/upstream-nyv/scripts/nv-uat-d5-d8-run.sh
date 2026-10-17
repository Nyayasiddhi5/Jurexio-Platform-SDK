#!/usr/bin/env bash
# D5–D8 Console browser UAT — JWT from EC2 SSM, Playwright (IronBee fallback).
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JWT_B64=$(bash "$APP_ROOT/scripts/jrx-uat-fetch-admin-jwt-ec2.sh" 2>/dev/null)
export UAT_ADMIN_TOKEN=$(printf '%s' "$JWT_B64" | base64 -d)
echo "jwt_len=${#UAT_ADMIN_TOKEN}"
exec node "$APP_ROOT/scripts/jrx-uat-d5-d8-browser.mjs" "$@"
