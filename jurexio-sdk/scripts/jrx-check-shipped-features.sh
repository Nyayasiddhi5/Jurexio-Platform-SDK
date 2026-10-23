#!/usr/bin/env bash
# JRX-NEVER-BREAK-001 — static regression locks for shipped platform features (minimal JRX port).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

require_file() {
  local f="$1"
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "jrx-check-shipped-features FAIL: missing $f"
    exit 1
  fi
}

require_file scripts/jrx-build-postman-collection.ts
require_file scripts/jrx-smoke-ec2.sh
require_file scripts/jrx-partner-smoke.sh
require_file src/middleware/jrx-sdk-auth-header.ts
require_file src/services/jrx-activity-event-bus.ts
require_file src/routes/jrx-activity-stream-routes.ts
require_file client/src/pages/hash-chain-audit.tsx
require_file packages/client-sdk/package.json

if ! rg -q "jrx-activity-stream-routes" src/index.ts src/routes 2>/dev/null; then
  echo "jrx-check-shipped-features FAIL: activity stream routes not mounted"
  exit 1
fi

echo "jrx-check-shipped-features PASS"
