#!/usr/bin/env bash
# Deploy standalone CNR ingest to worker and run in background loop
set -euo pipefail
SCRIPT_B64='__SCRIPT_B64__'
echo "$SCRIPT_B64" | base64 -d > /opt/nyv/api/_phase-b2-cnr-standalone.mjs
chmod 644 /opt/nyv/api/_phase-b2-cnr-standalone.mjs
pkill -f _phase-b2-cnr-standalone.mjs 2>/dev/null || true
export NODE_OPTIONS=--max-old-space-size=8192
nohup bash -c '
  while true; do
    node /opt/nyv/api/_phase-b2-cnr-standalone.mjs 5 >> /opt/nyv/logs/cnr-standalone-b2.log 2>&1 || true
    sleep 5
    # stop when no pending partitions (processed=0 in last run)
    if tail -3 /opt/nyv/logs/cnr-standalone-b2.log | grep -q "CNR_STANDALONE_DONE.*processed.: 0"; then
      echo "CNR loop complete — no pending partitions" >> /opt/nyv/logs/cnr-standalone-b2.log
      break
    fi
  done
' >> /opt/nyv/logs/cnr-standalone-b2.log 2>&1 &
echo "CNR_LOOP_PID=$!"
sleep 3
tail -8 /opt/nyv/logs/cnr-standalone-b2.log
