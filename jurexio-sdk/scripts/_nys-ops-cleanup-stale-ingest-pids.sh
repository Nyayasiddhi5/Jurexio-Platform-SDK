#!/usr/bin/env bash
# Remove stale ingest-cnr-case-details / nys-cnr-index-sync PIDs after OOM (zombie/defunct).
set -uo pipefail
echo "=== STALE INGEST CLEANUP $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
for pid in $(pgrep -f 'ingest-cnr-case-details|nys-cnr-index-sync' 2>/dev/null || true); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dead_pid $pid (kill -0 failed)"
    continue
  fi
  stat=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ')
  cmd=$(ps -o args= -p "$pid" 2>/dev/null | head -c 120)
  echo "pid=$pid stat=$stat cmd=$cmd"
  if [[ "$stat" == *Z* ]] || [[ "$stat" == *T* ]]; then
    echo "SIGKILL stale $pid"
    kill -9 "$pid" 2>/dev/null || true
  fi
done
pgrep -af 'ingest-cnr-case-details|nys-cnr-index-sync' || echo "no ingest pids after cleanup"
echo "=== CLEANUP DONE ==="
