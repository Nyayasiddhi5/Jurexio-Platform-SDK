#!/usr/bin/env bash
set -uo pipefail
echo "systemctl nyv-api:" $(systemctl is-active nyv-api)
echo "uptime:" $(uptime | awk -F'load average:' '{print $2}')
set -a && source /opt/nyv/api/.env && set +a
KEY="${NYS_KNOWLEDGE_API_KEY:-${NYS_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"
for mode in fts hybrid; do
  code=$(curl -sS -m 30 -o /tmp/s.json -w '%{http_code}' -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/caselaw/search?q=anticipatory+bail&limit=1&jurisdiction=IN&courtType=sc&mode=$mode")
  method=$(python3 -c "import json; d=json.load(open('/tmp/s.json')); print(d.get('method') or d.get('error',''))" 2>/dev/null || echo parse_fail)
  echo "search mode=$mode http=$code method=$method"
done
curl -sS -m 10 -H "x-api-key: $KEY" http://127.0.0.1:8080/api/caselaw/coverage 2>/dev/null | python3 -c "
import sys,json
try:
 d=json.load(sys.stdin)
 slo=d.get('slo') or {}
 print('coverage overall', slo.get('overallStatus'), 'embedded_pct', d.get('embeddingCoverage',{}).get('overallPct'))
except Exception as e:
 print('coverage err', e)
" 2>/dev/null || echo coverage_skip
