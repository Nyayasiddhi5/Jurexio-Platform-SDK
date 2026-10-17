#!/usr/bin/env bash
# Start temp HTTP server for graph JSONL on worker
set -euo pipefail
pkill -f 'http.server 9876' || true
cd /opt/nyv/api
nohup python3 -m http.server 9876 >/tmp/http-9876.log 2>&1 &
sleep 2
curl -sf -o /dev/null -w "local_http=%{http_code}\n" http://127.0.0.1:9876/graph-edges-pending.jsonl
