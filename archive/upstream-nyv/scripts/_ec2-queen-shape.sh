#!/usr/bin/env bash
# NV-QUEEN-SHAPE-001 — dump raw envelope shape for forced-Queen modes.
# The fan-out probe showed model=None / metered=None / no answer for
# orchestrationMode=parallel and =hierarchical while swarm returned a full
# answer. Determine whether those two modes ERROR or just return another shape.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
PROMPT='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

shape () {
  local label="$1"; local body="$2"
  local BEFORE; BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
  local CODE; CODE=$(curl -sS -m 600 -o /tmp/sh.json -w '%{http_code}' \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$body" "${API}/api/jrx/orchestrate" 2>/dev/null)
  sleep 5
  docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/sh.log
  echo "=============== ${label} (HTTP ${CODE}) ==============="
  echo "bytes=$(wc -c < /tmp/sh.json)"
  python3 - <<'PY'
import json
raw=open('/tmp/sh.json').read()
print("   raw head:", raw[:300].replace("\n"," "))
try: d=json.loads(raw)
except Exception as e:
    print("   NOT JSON:", e); raise SystemExit
print("   top keys:", list(d.keys())[:25])
n=d.get('data') if isinstance(d.get('data'),dict) else d
print("   inner keys:", list(n.keys())[:40])
for k in ('success','error','message','code'):
    if k in d: print(f"   {k} = {str(d[k])[:300]}")
for k in ('response','output','content','answer','text','result','finalAnswer','synthesis'):
    v=n.get(k)
    if v: print(f"   {k}: len={len(str(v))} head={str(v)[:160]!r}")
PY
  echo "   -- errors/warns in window --"
  grep -iE '"level":"(error|warn)"' /tmp/sh.log | python3 -c "
import sys,json
seen=set()
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    m=(r.get('message') or '')[:150]
    if m in seen: continue
    seen.add(m)
    print(f\"      [{r.get('level')}] {r.get('service')}: {m}\")
" | head -25
  echo "   -- queen completion / failure markers --"
  grep -oiE 'queen[a-z_ .-]{0,40}(complete|failed|timeout|abort|error)' /tmp/sh.log | sort | uniq -c | head -15
  echo
}

shape "parallel" "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"parallel\"}"
shape "swarm"    "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}"
