#!/usr/bin/env bash
# JRX-AUTH-HEADER-001 — canonical SDK auth header discipline (NV-AUTH-HEADER-001 port)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CANONICAL="src/middleware/jrx-sdk-auth-header.ts"
SCAN=(src client/src packages shared)

# Match actual header acceptance (not filenames like jrx-sdk-keylife).
PATTERN="headers\\[['\\\"]x-(nv-sdk-key|sdk-key|jrx-key|platform-key|nyv-key)['\\\"]\\]|allowedHeaders:.*X-(NV-SDK-Key|SDK-Key|JRX-Key|Platform-Key)"

FAIL=0
if rg -n -P "$PATTERN" "${SCAN[@]}" \
  --glob '*.ts' --glob '*.tsx' \
  --glob '!**/node_modules/**' \
  --glob '!**/jrx-sdk-auth-header.ts' \
  --glob '!**/*.test.ts' 2>/dev/null | head -30; then
  echo "jrx-check-auth-header-discipline FAIL: non-canonical SDK header wired in code"
  FAIL=1
fi

if rg -n 'function extractApiKey\s*\(' src client/src packages \
  --glob '*.ts' --glob '*.tsx' \
  --glob '!**/node_modules/**' \
  --glob '!**/jrx-sdk-auth-header.ts' \
  --glob '!**/*.test.ts' 2>/dev/null | head -20; then
  echo "jrx-check-auth-header-discipline FAIL: local extractApiKey() outside canonical middleware"
  FAIL=1
fi

if [[ ! -f "$CANONICAL" ]]; then
  echo "jrx-check-auth-header-discipline FAIL: missing $CANONICAL"
  exit 1
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi

echo "jrx-check-auth-header-discipline PASS"
