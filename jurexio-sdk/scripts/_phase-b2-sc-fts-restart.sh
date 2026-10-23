#!/usr/bin/env bash
# Phase B-2 SC body FTS — restart backfill from checkpoint (no checkpoint reset)
set -euo pipefail
mkdir -p /opt/nyv/logs
cd /opt/nyv/api
pkill -f backfill-sc-body-fts.mjs 2>/dev/null || true
sleep 1
if [ -f .sc-body-fts-checkpoint.json ]; then
  python3 -c "import json;d=json.load(open('.sc-body-fts-checkpoint.json'));print('checkpoint',d)"
else
  echo "no checkpoint — starting fresh"
fi
nohup node backfill-sc-body-fts.mjs >> /opt/nyv/logs/sc-body-fts-b2.log 2>&1 &
echo "SC_FTS_PID=$! log=/opt/nyv/logs/sc-body-fts-b2.log"
sleep 2
pgrep -af backfill-sc-body-fts || true
tail -5 /opt/nyv/logs/sc-body-fts-b2.log 2>/dev/null || true
