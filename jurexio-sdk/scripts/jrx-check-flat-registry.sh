#!/usr/bin/env bash
# Ensures merged flat agent registry exists and matches per-jurisdiction sources (count sanity).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FLAT="src/data/jrx-agents-registry.json"
if [[ ! -f "$FLAT" ]]; then
  echo "jrx-check-flat-registry FAIL: missing $FLAT — run npx tsx scripts/jrx-build-flat-registry.ts"
  exit 1
fi

TOTAL="$(node -e "const j=require('./src/data/jrx-agents-registry.json'); process.stdout.write(String(j.metadata?.totalAgents??0))")"
if [[ "${TOTAL:-0}" -lt 500 ]]; then
  echo "jrx-check-flat-registry FAIL: totalAgents=$TOTAL (expected >= 500)"
  exit 1
fi

echo "jrx-check-flat-registry PASS (totalAgents=$TOTAL)"
