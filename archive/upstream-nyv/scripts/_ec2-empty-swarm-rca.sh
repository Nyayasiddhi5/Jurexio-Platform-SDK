#!/usr/bin/env bash
# Why did the swarm return an EMPTY answer after NV-COST-ROUTER-SSOT-001?
# Leaves now route to a cheap model correctly, but the envelope carried 0 chars
# and wall time rose to 393 s. Capture the response shape + the failure lines.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
T0=$(date +%s.%N)
HTTP=$(curl -sS -m 600 -o /tmp/es.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate")
T1=$(date +%s.%N)
sleep 5
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/es.log

python3 -c "print(f'=== http=${HTTP} wall={${T1}-${T0}:.2f}s ===')"

echo
echo "=== response envelope top-level shape ==="
python3 -c "
import json
d=json.load(open('/tmp/es.json'))
def walk(o,p='',depth=0):
    if depth>2: return
    if isinstance(o,dict):
        for k,v in o.items():
            if isinstance(v,(dict,list)): walk(v,p+'.'+k,depth+1)
            else:
                s=repr(v)
                print(f'   {p}.{k} = {s[:110]}')
    elif isinstance(o,list):
        print(f'   {p}[] len={len(o)}')
        if o: walk(o[0],p+'[0]',depth+1)
walk(d)
"

echo
echo "=== errors / warnings in this request window ==="
grep -iE '"level":(50|40)|error|failed|timeout|abort' /tmp/es.log \
  | python3 -c "
import sys,json
seen={}
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    m=str(r.get('msg') or r.get('message') or '')[:150]
    if not m: continue
    seen[m]=seen.get(m,0)+1
for m,c in sorted(seen.items(), key=lambda x:-x[1])[:25]:
    print(f'   [{c}x] {m}')
"

echo
echo "=== per-node dispatch + outcome ==="
grep -E 'dispatched agent to LLM|hedge success|swarm node|synthes' /tmp/es.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    m=str(r.get('msg') or '')
    print(f\"   {m[:60]:<60} model={str(r.get('model'))[:38]:<38} role={r.get('nodeRole','-')} lat={r.get('latencyMs','-')}\")
"

echo
echo "=== empty-output / content-length signals ==="
grep -iE 'empty|no content|0 chars|blank|contentLength' /tmp/es.log | tail -15
