#!/usr/bin/env bash
set -uo pipefail
echo "=== CNR pgrep ==="
pgrep -af ingest-cnr || echo "not running"
echo "=== CNR log tail 15 ==="
tail -15 /opt/nyv/logs/cnr-case-details-b2.log 2>/dev/null
echo "=== node_modules thread-stream ==="
find /opt/nyv/api/node_modules -name 'worker.js' 2>/dev/null | head -5
find /opt/nyv -name 'thread-stream*' 2>/dev/null | head -10
