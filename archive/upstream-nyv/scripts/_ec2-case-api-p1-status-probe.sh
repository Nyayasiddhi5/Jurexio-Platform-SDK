#!/usr/bin/env bash
set -uo pipefail
echo "=== P1 ETL STATUS $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
pgrep -af "etl.py|nv-case-api-p1" || echo "no etl process"
ls -lt /var/log/nys-ops/p1-etl-*.log 2>/dev/null | head -3
LOG=$(ls -t /var/log/nys-ops/p1-etl-*.log 2>/dev/null | head -1)
if [ -n "$LOG" ]; then
  echo "--- tail $LOG ---"
  tail -30 "$LOG"
fi
echo "=== STATUS DONE ==="
