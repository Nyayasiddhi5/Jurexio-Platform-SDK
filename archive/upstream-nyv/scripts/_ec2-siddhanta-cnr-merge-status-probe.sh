#!/usr/bin/env bash
set -uo pipefail
echo "=== CNR MERGE STATUS $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
pgrep -af "/tmp/jrx-siddhanta-cnr-merge/merge.py" || echo "no merge process"
ls -lt /var/log/nys-ops/siddhanta-cnr-merge-*.log 2>/dev/null | head -2
LOG=$(ls -t /var/log/nys-ops/siddhanta-cnr-merge-*.log 2>/dev/null | head -1)
if [ -n "$LOG" ]; then
  echo "--- tail $LOG ---"
  tail -25 "$LOG"
fi
http=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8090/health 2>/dev/null || echo ERR)
echo "NYSAPI_HEALTH http=$http"
echo "=== CNR MERGE STATUS DONE ==="
