#!/usr/bin/env bash
# NV-DB-SCRIPT-001 — Standalone DB-script driver discipline (CI guardrail)
# Fails the build if any script under scripts/ uses the
# @neondatabase/serverless HTTP driver. The HTTP driver SILENTLY DROPS
# WRITES against non-Neon Postgres targets (the helium dev DB and RDS),
# returning rowCount=0 even when the row exists. Standalone scripts MUST
# use the makePgSql() shim from scripts/_pg-pool.ts (real pg.Pool with
# connection pooling and SSL).
#
# Runtime services (src/db/index.ts, src/services/jrx-db-pool-manager.ts)
# are driver-aware and pick neon-serverless ONLY when the host is
# *.neon.tech — they're whitelisted here.
#
# Run: bash scripts/jrx-check-script-db-driver.sh
# CI:  npm run guardrail:script-db

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXIT=0

echo "[guardrail NV-DB-SCRIPT-001] checking standalone-script DB driver…"

# Forbidden in scripts/: any import of @neondatabase/serverless
NEON_IMPORTS=$(rg -lP "from\s+['\"]@neondatabase/serverless['\"]" scripts/ 2>/dev/null || true)
if [ -n "$NEON_IMPORTS" ]; then
  echo "$NEON_IMPORTS" | sed 's/^/  ✗ /'
  echo ""
  echo "  ✗ Standalone scripts must NOT import @neondatabase/serverless."
  echo "    Replace with: import { makePgSql } from './_pg-pool.js';"
  echo "                  const sql = makePgSql();"
  echo "    See replit.md § Hard architectural guardrails NV-DB-SCRIPT-001."
  EXIT=1
fi

# Whitelist for runtime code (driver-aware, picks pg vs neon by hostname)
WHITELIST_RUNTIME='^(src/db/index\.ts|src/services/jrx-db-pool-manager\.ts|src/services/database-system\.ts|src/services/github-integration-service\.ts|src/routes/jrx-sdk-provision-routes\.ts|src/routes/jrx-user-profile-routes\.ts|src/routes/jrx-sdk-keylife-routes\.ts|src/routes/jrx-platforms-routes\.ts|src/routes/jrx-sdk-intelligence-routes\.ts)$'
RUNTIME_LEAKS=$(rg -lP "from\s+['\"]@neondatabase/serverless['\"]" src/ 2>/dev/null | grep -vE "$WHITELIST_RUNTIME" || true)
if [ -n "$RUNTIME_LEAKS" ]; then
  echo "$RUNTIME_LEAKS" | sed 's/^/  ⚠ runtime leak /'
  echo ""
  echo "  ⚠ New runtime file imports @neondatabase/serverless directly."
  echo "    Prefer importing the driver-aware pool from src/db/index.ts."
  echo "    If this is intentional (e.g. WebSocket-only path), update the"
  echo "    WHITELIST_RUNTIME pattern in this script + add a justification."
  EXIT=1
fi

if [ "$EXIT" -eq 0 ]; then
  echo "  ✓ standalone-script DB driver discipline OK"
fi

exit "$EXIT"
