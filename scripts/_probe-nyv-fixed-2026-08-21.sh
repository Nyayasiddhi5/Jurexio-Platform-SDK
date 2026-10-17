#!/usr/bin/env bash
set -uo pipefail
CANON=/opt/Nyayavigya/secrets/.env.production
API=https://api.nyayasiddhi.online
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

echo "=== NYV CNR caseCreate RJHC ==="
curl -sS -m 60 -o /tmp/nyv-cnr.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false},"claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/nyv-cnr.json'))
inner=d.get('data') if isinstance(d.get('data'), dict) else d
cc=inner.get('caseCreate') or {}
print('found', inner.get('found'), 'status', inner.get('status'), 'source', inner.get('source'))
print('caseCreate', 'yes' if cc else 'no', 'timeline', len(cc.get('timeline') or []))
print('manifest', (cc.get('fieldManifest') or {}).get('complete'))
print('claimEcourts', inner.get('claimEcourts'))
"

echo "=== NSP Pro CNR TSWL ==="
curl -sS -m 60 -o /tmp/nyv-cnr2.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/nyv-cnr2.json'))
inner=d.get('data') if isinstance(d.get('data'), dict) else d
print('found', inner.get('found'), 'matched', inner.get('matched'), 'court', inner.get('courtType'))
print('source', inner.get('sourceArchive') or inner.get('source'), 'claimEcourts', inner.get('claimEcourts'))
"

echo "=== caselaw via NYV knowledge ==="
curl -sS -m 45 -o /tmp/cs-nyv.json -w "http=%{http_code}\n" -H "X-API-Key: ${NSPK}" \
  "${API}/api/jrx/knowledge/caselaw/search?q=bail&limit=2&jurisdiction=IN&courtType=sc&mode=fts"
python3 -c "
import json
d=json.load(open('/tmp/cs-nyv.json'))
r=d.get('results') or d.get('data',{}).get('results') or []
print('results', len(r), 'method', d.get('method') or d.get('data',{}).get('method'), 'err', d.get('error'))
"

echo "=== research-138 orchestrate ==="
curl -sS -m 180 -o /tmp/orch138.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"taskType":"legal_research","jurisdiction":"IN","tier":"pro","prompt":"What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases."}' \
  "${API}/api/jrx/orchestrate"
python3 -c "
import json,re
d=json.load(open('/tmp/orch138.json'))
body=d.get('response') or d.get('data',{}).get('response') or d.get('result') or ''
if isinstance(body, dict): body=body.get('content') or str(body)
s=str(body)
reporter=len(re.findall(r'\(\d{4}\)\s*\d+\s*S\.?C\.?\.?R', s))
print('chars', len(s), 'reporter_cites', reporter)
meta=d.get('metadata') or d.get('data',{}).get('metadata') or {}
print('model', meta.get('model') or d.get('model'))
"
