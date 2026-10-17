#!/usr/bin/env bash
# NV-CORPUS-P3-001 — async kickoff for cnr_case_details refresh (reverse-2026 window).
# Clears hc-case-details checkpoints then runs ingest-cnr-case-details in background.
set -euo pipefail

API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/p3-cnr-details-${STAMP}.log"
export NYS_CNR_DETAILS_LIMIT="${NYS_CNR_DETAILS_LIMIT:-50}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFRESH="${SCRIPT_DIR}/_nys-ops-force-cnr-details-refresh.sh"
if [[ ! -f "$REFRESH" ]]; then
  REFRESH="/opt/nyv/scripts/_nys-ops-force-cnr-details-refresh.sh"
fi

if [[ ! -f "$REFRESH" ]]; then
  echo "BLOCKED: _nys-ops-force-cnr-details-refresh.sh missing"
  exit 2
fi

if pgrep -f "ingest-cnr-case-details" >/dev/null 2>&1; then
  echo "SKIPPED: ingest-cnr-case-details already running pid=$(pgrep -f 'ingest-cnr-case-details' | head -1)"
  exit 0
fi

nohup bash "$REFRESH" >>"$LOG" 2>&1 &
echo "P3_STARTED pid=$! log=$LOG limit=$NYS_CNR_DETAILS_LIMIT"
