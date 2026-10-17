#!/usr/bin/env bash
# NV-QUEEN-LEAF-TIER-001 verification — did the leaf/synthesis split change the
# model per node role, and did the user-visible answer survive the downgrade?
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
T0=$(date +%s.%N)
curl -sS -m 600 -o /tmp/lt.json \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate" >/dev/null
T1=$(date +%s.%N)
sleep 5
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/lt.log

echo "=== wall time ==="
python3 -c "print(f'   {${T1}-${T0}:.2f}s')"

echo
echo "=== answer survived the leaf downgrade? ==="
python3 -c "
import json
d=json.load(open('/tmp/lt.json'))
data = d.get('data') if isinstance(d.get('data'), dict) else d
c = (data.get('content')
     or ((data.get('curated') or {}).get('summary') if isinstance(data.get('curated'), dict) else '')
     or d.get('content') or '')
print(f'   answer chars = {len(c)}')
for kw in ('PMLA','SEBI','limitation','BNSS','bail'):
    print(f'   mentions {kw:12s} {kw.lower() in c.lower()}')
"

echo
echo "=== model chosen per node role (NV-QUEEN-LEAF-TIER-001) ==="
grep 'dispatched agent to LLM' /tmp/lt.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   role={r.get('nodeRole','?'):<12} model={r.get('model'):<34} agent={r.get('agentId')}\")
    print(f\"      reason={r.get('routingReason')}\")
"

echo
echo "=== billed completions: model ACTUALLY charged (not just dispatched) ==="
grep 'hedge success' /tmp/lt.log | python3 -c "
import sys,json
from collections import Counter
tot=0; n=0; models=Counter()
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    n+=1
    tot+=r.get('latencyMs') or 0
    models[str(r.get('model'))]+=1
print(f'   completions = {n}')
for m,c in models.most_common():
    print(f'      {c}x {m}')
print(f'   sum of completion latencies = {tot}ms')
"

echo
echo "=== node failures ==="
c=$(grep -c 'swarm node failed' /tmp/lt.log)
echo "   swarm node failed = $c"
