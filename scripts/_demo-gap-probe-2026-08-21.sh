#!/usr/bin/env bash
# Demo-gap live probe — runs ON nysdev. Never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n"')"
API="https://api.nyayasiddhi.online"

probe() {
  local label="$1"; shift
  echo "=== $label ==="
  "$@" 2>&1 || echo "  (probe step failed)"
  echo
}

probe "MULTI-TERM CASELAW (anticipatory+bail)" bash -c '
  curl -sS -m 60 -o /tmp/mt.json -w "http=%{http_code}\n" \
    -H "X-API-Key: '"$NSPK"'" -H "X-NYV-Platform: nsp" \
    "'"$API"'/api/jrx/knowledge/caselaw/search?q=anticipatory+bail&limit=3&mode=fts"
  python3 -c "
import json
d=json.load(open(\"/tmp/mt.json\"))
data=d.get(\"data\",d)
print(\"  success=\", d.get(\"success\"), \"degraded=\", data.get(\"degraded\"), \"results=\", len(data.get(\"results\",[])))
"
'

probe "TREATMENT + GRAPH HONESTY" bash -c '
  curl -sS -m 60 -o /tmp/tr.json -w "http=%{http_code}\n" \
    -H "X-API-Key: '"$NSPK"'" \
    "'"$API"'/api/jrx/knowledge/caselaw/treatment?citation=Maneka%20Gandhi"
  python3 -c "
import json
d=json.load(open(\"/tmp/tr.json\"))
data=d.get(\"data\",{})
print(\"  goodLaw=\", data.get(\"goodLaw\"))
print(\"  graph=\", data.get(\"graph\"))
print(\"  searchDegraded=\", data.get(\"searchDegraded\"))
"
'

probe "GRAPH STATS" bash -c '
  curl -sS -m 30 -o /tmp/gs.json -H "X-API-Key: '"$NSPK"'" "'"$API"'/api/jrx/documents/graph/stats"
  python3 -c "import json; d=json.load(open(\"/tmp/gs.json\")); print(\"  \", d.get(\"data\",d))"
'

probe "CNR RJHC REGRESSION" bash -c '
  curl -sS -m 45 -o /tmp/cnr.json -w "http=%{http_code}\n" \
    -X POST -H "X-API-Key: '"$NSPK"'" -H "Content-Type: application/json" \
    -d "{\"cnr\":\"RJHC010324382023\",\"claimEcourts\":false}" \
    "'"$API"'/api/jrx/v1/sdk/cnr/resolve"
  python3 -c "import json; d=json.load(open(\"/tmp/cnr.json\")); data=d.get(\"data\",d); print(\"  success=\", d.get(\"success\"), \"matched=\", data.get(\"matched\"))"
'

probe "DRAFT-FAST SMOKE (short)" bash -c '
  curl -sS -m 90 -o /tmp/df.json -w "http=%{http_code} time=%{time_total}s\n" \
    -X POST -H "X-API-Key: '"$NSPK"'" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "{\"prompt\":\"Draft one sentence bail application under BNSS.\",\"taskType\":\"legal-draft-fast\",\"jurisdiction\":\"IN\",\"maxTokens\":256}" \
    "'"$API"'/api/jrx/orchestrate"
  python3 -c "
import json
d=json.load(open(\"/tmp/df.json\"))
data=d.get(\"data\",d)
print(\"  success=\", d.get(\"success\"), \"model=\", data.get(\"model\"), \"len=\", len(str(data.get(\"content\") or \"\")))
"
'

echo "=== DEMO GAP PROBE COMPLETE ==="
