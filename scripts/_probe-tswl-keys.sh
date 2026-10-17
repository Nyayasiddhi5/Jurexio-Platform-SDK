#!/usr/bin/env bash
CANON=/opt/Nyayavigya/secrets/.env.production
API=https://api.nyayasiddhi.online
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
curl -sS -m 60 -o /tmp/tswl3.json -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/tswl3.json'))
print('all_top_keys', sorted(d.keys()))
for k,v in d.items():
  if k not in ('fields','documents','caseCreate'):
    print(k, '=', repr(v)[:120])
fields=d.get('fields') or {}
print('fields_keys', list(fields.keys())[:15])
print('courtType', fields.get('courtType') or d.get('courtType'))
print('matched', d.get('matched'), fields.get('matched'))
"
