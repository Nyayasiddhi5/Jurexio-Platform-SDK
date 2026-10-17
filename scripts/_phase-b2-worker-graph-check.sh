#!/usr/bin/env bash
# Verify graph JSONL on worker + start HTTP server
set -euo pipefail
cd /opt/nyv/api
if [ -f graph-edges-pending.jsonl ]; then
  echo "jsonl_bytes=$(wc -c < graph-edges-pending.jsonl) jsonl_lines=$(wc -l < graph-edges-pending.jsonl)"
else
  echo "MISSING graph-edges-pending.jsonl"
  ls -la *.jsonl 2>/dev/null || true
  exit 1
fi
pkill -f 'http.server 9876' || true
nohup python3 -m http.server 9876 >/tmp/http-9876.log 2>&1 &
sleep 2
curl -sf -o /dev/null -w "local_http=%{http_code}\n" http://127.0.0.1:9876/graph-edges-pending.jsonl
