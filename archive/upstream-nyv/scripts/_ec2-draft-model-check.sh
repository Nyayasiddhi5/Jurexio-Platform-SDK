#!/usr/bin/env bash
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
for TASK in legal-draft legal-draft-fast; do
  echo "=== $TASK ==="
  curl -sS -m 120 -o "/tmp/${TASK}.json" \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"Draft one sentence for bail.\",\"taskType\":\"${TASK}\",\"jurisdiction\":\"IN\",\"maxTokens\":128}" \
    http://127.0.0.1:5000/api/jrx/orchestrate
  python3 -c "
import json
d=json.load(open('/tmp/${TASK}.json'))
data=d.get('data') or d
print('model=', data.get('model') or d.get('model'), 'provider=', data.get('provider') or d.get('provider'), 'success=', d.get('success'))
"
done
