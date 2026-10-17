#!/usr/bin/env bash
set -euo pipefail
echo "=== docker ps ==="
docker ps -a --format '{{.Names}} {{.Status}}' | grep nyv || true
echo "=== gateway :5000 ==="
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -m 5 http://127.0.0.1:5000/api/jrx/health || echo FAIL
echo "=== console :80 ==="
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -m 5 http://127.0.0.1/api/jrx/health || echo FAIL
echo "=== gateway logs (last 30) ==="
docker logs --tail 30 nyv-gateway 2>&1 | sed 's/\(password\|secret\|key\)=[^ ]*/\1=<redacted>/gi'
