#!/usr/bin/env bash
# NV-SIDDHANTA-CNR-MERGE-001 — nohup merge on caselaw-worker (SSM payload).
set -euo pipefail
WORK="/tmp/jrx-siddhanta-cnr-merge"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/siddhanta-cnr-merge-${STAMP}.log"
mkdir -p "$LOG_DIR" "$WORK"

if pgrep -f "$WORK/merge.py" >/dev/null 2>&1; then
  if [ "${MERGE_FORCE_RESTART:-0}" = "1" ]; then
    echo "MERGE_FORCE_RESTART stopping prior merge"
    pkill -f "$WORK/merge.py" 2>/dev/null || true
    sleep 2
  else
    echo "SKIPPED: merge already running"
    pgrep -af "$WORK/merge.py" || true
    exit 0
  fi
fi

# Pre probe: nysapi health (read-only)
http=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8090/health 2>/dev/null || echo ERR)
echo "NYSAPI_PRE_HEALTH http=$http"

SCRIPT_B64="${MERGE_SCRIPT_B64:-}"
if [ -z "$SCRIPT_B64" ]; then
  echo "MERGE_SCRIPT_B64 missing — inject via SSM wrapper" >&2
  exit 1
fi
echo "$SCRIPT_B64" | base64 -d > "$WORK/merge.py"
chmod +x "$WORK/merge.py"

nohup env \
  NYS_API_DIR="/opt/nyv/api" \
  CNR_MERGE_WORK="$WORK" \
  RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}" \
  CNR_MERGE_BATCH_SIZE="${CNR_MERGE_BATCH_SIZE:-500}" \
  CNR_MERGE_MAX_ROWS="${CNR_MERGE_MAX_ROWS:-0}" \
  "$PY" "$WORK/merge.py" >>"$LOG" 2>&1 &
echo "CNR_MERGE_STARTED pid=$! log=$LOG"
sleep 2
pgrep -af "$WORK/merge.py" || true
