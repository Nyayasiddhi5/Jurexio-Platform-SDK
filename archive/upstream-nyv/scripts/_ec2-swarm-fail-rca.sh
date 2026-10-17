#!/usr/bin/env bash
# NV-SWARM-FAIL-RCA-001 — why do 3 swarm nodes still fail after the
# hallucination-check guard, and what is the 264s wall time made of?
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
curl -sS -m 600 -o /tmp/sf.json \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate" >/dev/null
sleep 5
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/sf.log

echo "=== swarm node failure detail (full err) ==="
grep 'swarm node failed' /tmp/sf.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: print('   RAW:', l[:400]); continue
    print(f\"   {r.get('message')}\")
    print(f\"      err={str(r.get('err'))[:400]}\")
"

echo
echo "=== all errors in window (deduped, with service) ==="
grep -iE '"level":"error"' /tmp/sf.log | python3 -c "
import sys,json
seen={}
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    k=(r.get('service'),(r.get('message') or '')[:120])
    seen[k]=seen.get(k,0)+1
for (svc,msg),n in sorted(seen.items(), key=lambda x:-x[1]):
    print(f'   [{n}x] {svc}: {msg}')
"

echo
echo "=== timing: per-completion latency + hedge ==="
grep 'hedge success' /tmp/sf.log | python3 -c "
import sys,json
tot=0
for i,l in enumerate(sys.stdin,1):
    try: r=json.loads(l)
    except Exception: continue
    lat=r.get('latencyMs') or 0
    tot+=lat
    print(f\"   [{i}] {r.get('model')} {lat}ms\")
print(f'   sum of completion latencies = {tot}ms')
"

echo
echo "=== timeout / abort evidence ==="
for p in 'timeout' 'aborted' 'AbortError' 'TimeoutError' 'perNodeTimeout' 'halted'; do
  c=$(grep -ci "$p" /tmp/sf.log)
  [ "$c" != "0" ] && printf '   %-16s %s\n' "$p" "$c"
done

echo
echo "=== queen concurrency / policy ==="
grep -oiE 'maxConcurrentNodes[\":= ]*[0-9]+|perNodeTimeoutMs[\":= ]*[0-9]+|swarmSize[\":= ]*[0-9]+' /tmp/sf.log | sort | uniq -c | head
