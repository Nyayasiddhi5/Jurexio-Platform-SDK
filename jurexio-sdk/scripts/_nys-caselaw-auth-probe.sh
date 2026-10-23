#!/usr/bin/env bash
set -uo pipefail
set -a
source /opt/nyv/api/.env
set +a
KEY="${JRX_ECOSYSTEM_KNOWLEDGE_API_KEY:-${JRX_ECOSYSTEM_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"
H=(-H "x-api-key: $KEY")
echo "=== /api/caselaw/search bail ==="
curl -sS -m 45 "${H[@]}" "http://127.0.0.1:8080/api/caselaw/search?q=bail&limit=2&jurisdiction=IN" | head -c 500
echo
echo "=== 302 ==="
curl -sS -m 45 -w "\nhttp=%{http_code}\n" "${H[@]}" "http://127.0.0.1:8080/api/caselaw/search?q=302&limit=2&jurisdiction=IN" | tail -3
echo "=== errors ==="
tail -50 /opt/nyv/logs/api.log 2>/dev/null | grep -iE 'caselaw/search|error|500|body_search' | tail -10
