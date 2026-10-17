#!/usr/bin/env bash
set -uo pipefail
echo "=== NYS health ==="
curl -sS -m 5 http://127.0.0.1:8080/health || echo fail
echo
echo "=== caselaw search local ==="
curl -sS -m 30 "http://127.0.0.1:8080/api/knowledge/caselaw/search?q=bail&limit=2" | head -c 500
echo
echo "=== api log tail ==="
tail -20 /opt/nyv/logs/api.log 2>/dev/null || journalctl -u jrx-api -n 15 --no-pager 2>/dev/null || echo no_log
echo "=== pm2/list ==="
pm2 list 2>/dev/null || ps aux | grep -E 'node.*index' | grep -v grep | head -3
