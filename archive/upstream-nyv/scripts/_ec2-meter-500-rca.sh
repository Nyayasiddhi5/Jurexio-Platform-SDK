#!/usr/bin/env bash
# RCA the http=500 seen by _ec2-meter-verify.sh after the metering deploy.
# Two questions: (1) is this MY change (contract builder / usage context) or a
# pre-existing swarm failure, and (2) which stream provider still reports
# usageSource=estimate?
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

echo "=== running image / deploy id ==="
docker exec "$GID" cat /app/DEPLOY_ID 2>/dev/null | sed 's/^/   /' || echo "   (no DEPLOY_ID file)"

echo
echo "=== A) SIMPLE request (specialist path) — does the envelope work at all? ==="
BEFORE=$(docker logs --tail 200000 "$GID" 2>&1 | wc -l)
H=$(curl -sS -m 180 -o /tmp/s.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d '{"prompt":"Explain the essential ingredients of criminal breach of trust under BNS.","jurisdiction":"IN"}' \
  "${API}/api/jrx/orchestrate")
echo "   http=$H"
python3 -c "
import json
d=json.load(open('/tmp/s.json'))
data = d.get('data') if isinstance(d.get('data'), dict) else d
cost = data.get('cost') or {}
tok  = cost.get('tokens') or {}
print(f\"   cost.completions = {cost.get('completions')}\")
print(f\"   tokens total     = {tok.get('total')}\")
print(f\"   wasted           = {cost.get('wasted')}\")
c = data.get('content') or ''
print(f'   answer chars     = {len(c)}')
if not cost: print('   RAW keys:', list(d.keys())[:12])
"

echo
echo "=== B) the 500 from the swarm request: actual error ==="
docker logs --tail 200000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/rca.log
docker logs --tail 200000 "$GID" 2>&1 | grep -iE '"level":50|orchestrate.*(fail|error)|500' | tail -20 \
  | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception:
        print('   RAW '+l[:250]); continue
    m=str(r.get('msg') or r.get('message') or '')[:200]
    e=str(r.get('err') or r.get('error') or r.get('stack') or '')[:300]
    print(f'   {m}')
    if e: print(f'      err: {e}')
"

echo
echo "=== C) any TypeError / import failure since the deploy? (would be MY bug) ==="
docker logs --tail 200000 "$GID" 2>&1 \
  | grep -iE 'TypeError|ReferenceError|Cannot find module|is not a function|getRequestUsage|nvUsage' \
  | tail -12 | sed 's/^/   /'

echo
echo "=== D) which providers streamed, and did usage arrive? ==="
docker logs --tail 200000 "$GID" 2>&1 | grep 'stream success' | tail -10 | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   model={str(r.get('model'))[:38]:<38} usageSource={r.get('usageSource')} in={r.get('tokensIn')} out={r.get('tokensOut')} chars={r.get('chars')}\")
"
