#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v initdb >/dev/null 2>&1; then
  echo "jrx-check-schema-drift SKIP: initdb not found (install postgresql client for full drift check)"
  exit 0
fi

exec npx tsx scripts/jrx-check-schema-drift.ts
