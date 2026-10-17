#!/usr/bin/env bash
CANON=/opt/Nyayavigya/secrets/.env.production
API=https://api.nyayasiddhi.online
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
curl -sS -m 60 -o /tmp/tswl4.json -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/tswl4.json'))
data=d.get('data') or {}
print('status', data.get('status'), 'matchType', data.get('matchType'), 'source', data.get('source'))
print('courtType', data.get('courtType'), 'sourceArchive', data.get('sourceArchive'))
print('matched', data.get('matched'), 'found', data.get('found'))
print('claimEcourts', d.get('claimEcourts'))
"
