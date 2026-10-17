#!/usr/bin/env bash
set -uo pipefail
set -a
source /opt/nyv/api/.env
set +a
KEY="${NYS_KNOWLEDGE_API_KEY:-${NYS_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"
for port in 8080 3000 5000 5001 8787; do
  code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/health" 2>/dev/null || echo 000)
  echo "port $port /health -> $code"
done
echo "=== node listen ==="
ss -tlnp 2>/dev/null | grep node | head -5 || netstat -tlnp 2>/dev/null | grep node | head -5
echo "=== api health json ==="
curl -sS -m 5 http://127.0.0.1:8787/health 2>/dev/null | head -c 200 || curl -sS -m 5 http://127.0.0.1:3000/health 2>/dev/null | head -c 200
echo
