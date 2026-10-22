#!/usr/bin/env bash
# JRX-DB-SCRIPT-001 — scripts must use makePgSql from scripts/_pg-pool.ts (real pg pool)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if rg -n "@neondatabase/serverless" scripts --glob '*.ts' \
  --glob '!scripts/_pg-pool.ts' \
  --glob '!scripts/jrx-mirror-sdk-keys-to-canonical.ts' \
  --glob '!scripts/jrx-check-script-db-driver.sh' 2>/dev/null | head -30; then
  echo "jrx-check-script-db-driver FAIL: use makePgSql() from scripts/_pg-pool.ts instead of @neondatabase/serverless in scripts/"
  exit 1
fi

echo "jrx-check-script-db-driver PASS"
