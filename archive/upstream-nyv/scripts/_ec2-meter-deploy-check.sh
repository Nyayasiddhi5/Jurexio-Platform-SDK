#!/usr/bin/env bash
# Two decisive checks:
#  1. Does the RUNNING bundle actually contain the metering changes? (rules out a
#     stale deploy before blaming the code.)
#  2. What is the 500 response body + the error that produced it?
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

echo "=== 1) are the metering markers present in the RUNNING bundle? ==="
for MARK in \
  'amazon-bedrock-invocationMetrics' \
  'usageSource' \
  'hedge loser spend recorded as waste' \
  'wastedCompletionTokens' \
  'include_usage'
do
  N=$(docker exec "$GID" sh -c "grep -rl '$MARK' /app/dist 2>/dev/null | head -3 | wc -l" 2>/dev/null | tr -d ' \r')
  printf '   %-42s files=%s\n' "$MARK" "${N:-?}"
done

echo
echo "=== 2) reproduce the swarm 500 and show the BODY ==="
BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'
T0=$(date +%s.%N)
H=$(curl -sS -m 700 -o /tmp/e.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate")
T1=$(date +%s.%N)
python3 -c "print(f'   http=${H} wall={${T1}-${T0}:.1f}s')"
echo "   --- body (first 900 chars) ---"
head -c 900 /tmp/e.json | sed 's/^/   /'
echo

sleep 5
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/e.log

echo
echo "=== 3) level-50 errors in THIS request window only ==="
grep '"level":50' /tmp/e.log | python3 -c "
import sys,json
from collections import Counter
seen=Counter(); detail={}
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    m=str(r.get('msg') or r.get('message') or '')[:160]
    if not m: continue
    seen[m]+=1
    if m not in detail:
        detail[m]=str(r.get('err') or r.get('error') or r.get('stack') or '')[:400]
for m,c in seen.most_common(12):
    print(f'   [{c}x] {m}')
    if detail[m]: print(f'        {detail[m]}')
" 2>/dev/null || echo "   (none)"

echo
echo "=== 4) timeouts / deadline in this window ==="
grep -ioE 'per-node timeout[^\"]{0,60}|deadline[^\"]{0,50}|wall.?clock[^\"]{0,40}' /tmp/e.log | sort | uniq -c | sort -rn | head -10 | sed 's/^/   /'

echo
echo "=== 5) stream success lines from THIS window (usageSource) ==="
grep 'stream success' /tmp/e.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   model={str(r.get('model'))[:36]:<36} usageSource={r.get('usageSource')} in={r.get('tokensIn')} out={r.get('tokensOut')}\")
" 2>/dev/null || echo "   (no streams)"
