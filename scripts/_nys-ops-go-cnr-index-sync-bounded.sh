#!/usr/bin/env bash
# NV-NYS-OPS-GO-002 — bounded nys-cnr-index-sync (judgments delta + capped cnr_case_details).
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/cnr-index-sync-${STAMP}.log"

export NYS_CNR_DETAILS_LIMIT="${NYS_CNR_DETAILS_LIMIT:-5}"
export NODE_OPTIONS="--max-old-space-size=${NYS_NODE_HEAP_MB:-8192} ${NODE_OPTIONS:-}"
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"

SYNC="$API/nys-cnr-index-sync.mjs"
[[ -f "$SYNC" ]] || { echo "BLOCKED: missing $SYNC"; exit 2; }

if pgrep -f "nys-cnr-index-sync.mjs" >/dev/null 2>&1; then
  echo "SKIPPED: nys-cnr-index-sync already pid=$(pgrep -f 'nys-cnr-index-sync.mjs' | head -1)"
  exit 0
fi

echo "=== CNR INDEX SYNC BOUNDED START $(date -u +%Y-%m-%dT%H:%M:%SZ) limit=$NYS_CNR_DETAILS_LIMIT heap=${NYS_NODE_HEAP_MB:-4096} ===" >>"$LOG"
cd "$API"
nohup node "$SYNC" >>"$LOG" 2>&1 &
echo "CNR_INDEX_SYNC_STARTED pid=$! log=$LOG"
