#!/usr/bin/env bash
set -uo pipefail
CANON=/opt/Jurexio/secrets/.env.production
API=https://api.jurexio.com
NSPK=$(grep -E '^JRX_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

echo "=== TSWL raw ==="
curl -sS -m 60 -o /tmp/tswl2.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "import json; d=json.load(open('/tmp/tswl2.json')); print(json.dumps({k:d.get(k) for k in ['success','error','claimEcourts','source','found','status','matched','courtType']}, default=str)[:800])"

echo "=== RJHC caseCreate raw top ==="
curl -sS -m 60 -o /tmp/rjhc.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate"},"claimEcourts":false}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve"
python3 -c "
import json
d=json.load(open('/tmp/rjhc.json'))
print('success', d.get('success'), 'error', d.get('error'))
data=d.get('data') or d
print('status', data.get('status'), 'source', data.get('source'))
cc=data.get('caseCreate') or {}
print('timeline', len(cc.get('timeline') or []), 'manifest', (cc.get('fieldManifest') or {}).get('complete'))
"
