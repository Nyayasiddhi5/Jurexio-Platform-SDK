#!/usr/bin/env bash
# Stop hung post-OOM cnr ingest children so P3 can restart (bounded ops only).
set -uo pipefail
echo "=== STOP FAILED CNR INGEST $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
for pid in $(pgrep -f 'ingest-cnr-case-details|nys-cnr-index-sync' 2>/dev/null || true); do
  cmd=$(ps -o args= -p "$pid" 2>/dev/null | head -c 100)
  echo "SIGTERM pid=$pid $cmd"
  kill "$pid" 2>/dev/null || true
done
sleep 3
for pid in $(pgrep -f 'ingest-cnr-case-details|nys-cnr-index-sync' 2>/dev/null || true); do
  echo "SIGKILL pid=$pid"
  kill -9 "$pid" 2>/dev/null || true
done
pgrep -af 'ingest-cnr-case-details|nys-cnr-index-sync' || echo "all stopped"
echo "=== STOP DONE ==="
