#!/usr/bin/env bash
# Fire-and-forget wrapper for nv-corpus-reverse-2026-ingest.sh on caselaw-worker.
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/reverse-dc-kickoff-${STAMP}.log"

SCRIPT=""
for candidate in \
  "/opt/nyv/scripts/jrx-corpus-reverse-2026-ingest.sh" \
  "$(dirname "${BASH_SOURCE[0]}")/jrx-corpus-reverse-2026-ingest.sh"; do
  [[ -f "$candidate" ]] && SCRIPT="$candidate" && break
done

if [[ -z "$SCRIPT" ]]; then
  echo "BLOCKED: nv-corpus-reverse-2026-ingest.sh not found on worker"
  exit 2
fi

if pgrep -f "ingest-rds" >/dev/null 2>&1; then
  echo "SKIPPED: ingest-rds already running pid=$(pgrep -f 'ingest-rds' | head -1)"
  exit 0
fi

export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"
export INGEST_BATCH_SIZE="${INGEST_BATCH_SIZE:-100}"
export CORPUS_END_YEAR="${CORPUS_END_YEAR:-$(date -u +%Y)}"
export CORPUS_START_YEAR="${CORPUS_START_YEAR:-$(( $(date -u +%Y) - 1 ))}"

nohup bash "$SCRIPT" >>"$LOG" 2>&1 &
echo "P2_REVERSE_DC_STARTED pid=$! log=$LOG script=$SCRIPT years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR}"
sleep 2
pgrep -af "ingest-rds|nv-corpus-reverse" || true
