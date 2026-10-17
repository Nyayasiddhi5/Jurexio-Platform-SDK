#!/usr/bin/env bash
# Is the intermittent swarm 500 a TIMEOUT at ~400s, and whose timeout is it?
# Same prompt returned 200 at 378s and 500 at 404s, so the boundary matters more
# than the request. Distinguish: nginx/ALB gateway timeout vs our own wall-clock
# vs an application error.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

echo "=== configured wall-clock / proxy timeouts ==="
docker exec "$GID" printenv NYV_ORCH_WALL_CLOCK_MS NYV_QUEEN_PER_NODE_TIMEOUT_MS 2>/dev/null | sed 's/^/   env: /'
for F in /etc/nginx/nginx.conf /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default; do
  [ -f "$F" ] && grep -HiE 'proxy_read_timeout|proxy_send_timeout|keepalive_timeout' "$F" | sed 's/^/   /'
done

echo
echo "=== does the gateway itself finish, even when the client sees 500? ==="
BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'
T0=$(date +%s.%N)
H=$(curl -sS -m 900 -o /tmp/t.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate")
T1=$(date +%s.%N)
python3 -c "print(f'   client sees http=${H} at {${T1}-${T0}:.1f}s')"
echo "   --- body head ---"
head -c 400 /tmp/t.json | sed 's/^/   /'
echo
sleep 5
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/t.log

echo
echo "=== the request line the gateway logged (status + duration) ==="
grep -iE 'POST /api/jrx/orchestrate' /tmp/t.log | tail -5 | sed 's/^/   /' | cut -c1-260

echo
echo "=== 502/504/500 from the proxy layer? ==="
grep -icE '502|504|upstream|gateway time' /tmp/t.log | sed 's/^/   proxy-ish lines = /'
grep -iE '502|504|upstream timed out|gateway time' /tmp/t.log | tail -5 | sed 's/^/   /' | cut -c1-240

echo
echo "=== our own wall-clock / deadline messages ==="
grep -iE 'wall.?clock|deadline|orchestration timeout|exceeded' /tmp/t.log | tail -8 | sed 's/^/   /' | cut -c1-240

echo
echo "=== level 50 in window ==="
grep '"level":50' /tmp/t.log | python3 -c "
import sys,json
from collections import Counter
c=Counter(); d={}
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    m=str(r.get('msg') or '')[:150]
    if not m: continue
    c[m]+=1
    d.setdefault(m, str(r.get('err') or r.get('stack') or '')[:300])
for m,n in c.most_common(10):
    print(f'   [{n}x] {m}')
    if d[m]: print(f'        {d[m]}')
" 2>/dev/null || echo "   (none)"

echo
echo "=== per-node wall time distribution (where the 400s goes) ==="
grep 'hedge success' /tmp/t.log | python3 -c "
import sys,json
lat=[]
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    v=r.get('latencyMs')
    if v: lat.append(int(v))
lat.sort()
if lat:
    print(f'   completions={len(lat)} sum={sum(lat)}ms max={lat[-1]}ms')
    print('   individual:', ', '.join(f'{v/1000:.0f}s' for v in lat))
    print('   >>> if sum >> wall, nodes ran in PARALLEL; if sum ~= wall, they are SERIAL')
"
