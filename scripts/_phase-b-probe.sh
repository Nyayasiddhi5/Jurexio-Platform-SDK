#!/usr/bin/env bash
# Phase B live probe — runs ON jrx-prod. Never echo secret values.
set -uo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
NSPK="$(grep -E '^JRX_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n"')"
API="https://api.jurexio.com"

echo "=== HEALTH ==="
curl -sS -m 15 -o /tmp/h.json -w "http=%{http_code}\n" "$API/api/jrx/health"

echo "=== CNR RJHC (single) ==="
curl -sS -m 45 -o /tmp/cnr1.json -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST -H "X-API-Key: $NSPK" -H "Content-Type: application/json" \
  -d '{"cnr":"RJHC010324382023","claimEcourts":false,"options":{"profile":"caseCreate"}}' \
  "$API/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/cnr1.json'))
data=d.get('data',d)
print('  success=', d.get('success'), 'matched=', data.get('matched'), 'status=', data.get('status'), 'source=', data.get('source'))
"

echo "=== CNR TSWL (single) ==="
curl -sS -m 45 -o /tmp/cnr2.json -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST -H "X-API-Key: $NSPK" -H "Content-Type: application/json" \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "$API/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/cnr2.json'))
data=d.get('data',d)
print('  success=', d.get('success'), 'matched=', data.get('matched'), 'status=', data.get('status'), 'source=', data.get('source'))
"

echo "=== CNR LOAD (10 parallel RJHC) ==="
for i in $(seq 1 10); do
  curl -sS -m 45 -o "/tmp/cnr_load_${i}.json" -w "req${i} http=%{http_code} time=%{time_total}s\n" \
    -X POST -H "X-API-Key: $NSPK" -H "Content-Type: application/json" \
    -d '{"cnr":"RJHC010324382023","claimEcourts":false}' \
    "$API/api/jrx/v1/sdk/cnr/resolve" &
done
wait
python3 -c "
import json, glob
codes=[]; matched=[]
for f in sorted(glob.glob('/tmp/cnr_load_*.json')):
  d=json.load(open(f))
  codes.append(d.get('success'))
  data=d.get('data',d)
  matched.append(data.get('matched'))
print('  parallel10 success=', codes, 'matched=', matched)
print('  all200=', all(c is True for c in codes))
"

echo "=== CASELAW bail ==="
curl -sS -m 60 -o /tmp/cl.json -w "http=%{http_code}\n" \
  -H "X-API-Key: $NSPK" -H "X-JRX-Platform: nsp" \
  "$API/api/jrx/knowledge/caselaw/search?q=bail&limit=3&mode=fts"
python3 -c "
import json
d=json.load(open('/tmp/cl.json'))
data=d.get('data',d)
print('  success=', d.get('success'), 'degraded=', data.get('degraded'), 'results=', len(data.get('results',[])))
"

echo "=== DRAFT-FAST SMOKE ==="
curl -sS -m 90 -o /tmp/df.json -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST -H "X-API-Key: $NSPK" -H "X-JRX-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"prompt":"Draft one sentence bail application under BNSS.","taskType":"legal-draft-fast","jurisdiction":"IN","maxTokens":256}' \
  "$API/api/jrx/orchestrate"
python3 -c "
import json
d=json.load(open('/tmp/df.json'))
data=d.get('data',d)
print('  success=', d.get('success'), 'model=', data.get('model'), 'len=', len(str(data.get('content') or '')))
"

echo "=== TREATMENT + GRAPH ==="
curl -sS -m 60 -o /tmp/tr.json -w "http=%{http_code}\n" \
  -H "X-API-Key: $NSPK" \
  "$API/api/jrx/knowledge/caselaw/treatment?citation=Maneka%20Gandhi"
python3 -c "
import json
d=json.load(open('/tmp/tr.json'))
data=d.get('data',{})
print('  goodLaw=', data.get('goodLaw'))
print('  graph=', data.get('graph'))
"

echo "=== PHASE B PROBE COMPLETE ==="
