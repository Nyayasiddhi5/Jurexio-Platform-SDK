#!/usr/bin/env bash
# NV-MULTIPLIER-TRACE-001 — identify each of the 3 provider completions per request.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

BEFORE=$(docker logs --tail 200000 "$CID" 2>&1 | wc -l)
curl -sS -m 240 -o /tmp/t.json -w "wall=%{time_total}s\n" \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d '{"prompt":"Explain the anticipatory bail standard under BNSS 482 for economic offences.","jurisdiction":"IN"}' \
  "${API}/api/jrx/orchestrate" >/dev/null
sleep 3
docker logs --tail 200000 "$CID" 2>&1 | tail -n +"$BEFORE" > /tmp/w.log

echo "=== every line mentioning a model or hedge, in order ==="
grep -nE 'hedge|"model"|selected|candidate|attempt|cascade|Calling|invoke' /tmp/w.log \
  | grep -viE 'embedding|rerank' | cut -c1-240

echo
echo "=== lines with token usage ==="
grep -nE 'inputTokens|outputTokens|promptTokens|usage' /tmp/w.log | cut -c1-240

echo
echo "=== hedge config in env ==="
grep -iE 'HEDGE' "$CANON" | sed 's/=.*/=<set>/'
