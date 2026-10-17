#!/usr/bin/env bash
set -uo pipefail
CANON=/opt/Nyayavigya/secrets/.env.production
API=https://api.nyayasiddhi.online
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

echo "=== TSWL full keys ==="
curl -sS -m 60 -o /tmp/tswl.json -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/tswl.json'))
print('top_keys', list(d.keys())[:12])
data=d.get('data') or {}
print('data_keys', list(data.keys())[:20])
print('found', data.get('found'), 'status', data.get('status'), 'matched', data.get('matched'))
print('courtType', data.get('courtType'), 'sourceArchive', data.get('sourceArchive'), 'source', data.get('source'))
"

echo "=== research-138 response shape ==="
curl -sS -m 180 -o /tmp/o138.json -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"taskType":"legal_research","jurisdiction":"IN","tier":"pro","prompt":"What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases."}' \
  "${API}/api/jrx/orchestrate"
python3 -c "
import json,re
d=json.load(open('/tmp/o138.json'))
print('top_keys', list(d.keys())[:15])
for k in ['response','content','answer','text','result','data']:
  v=d.get(k)
  if v: print('has', k, 'type', type(v).__name__)
  if isinstance(d.get('data'), dict):
    for k2 in ['response','content','answer','text']:
      v2=d['data'].get(k2)
      if v2: print('data.'+k2, 'len', len(str(v2)))
body=''
if isinstance(d.get('data'), dict):
  body=str(d['data'].get('response') or d['data'].get('content') or d['data'].get('answer') or '')
if not body: body=str(d.get('response') or d.get('content') or d.get('result') or '')
print('body_len', len(body))
print('reporter_cites', len(re.findall(r'\(\d{4}\)\s*\d+\s*S\.?C\.?\.?R', body)))
print('sample', body[:200].replace(chr(10),' '))
"
