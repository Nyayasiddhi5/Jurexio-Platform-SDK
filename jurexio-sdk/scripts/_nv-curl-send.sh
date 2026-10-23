#!/usr/bin/env bash
# Drive a single SME legal-chat send via curl (not node fetch) to get clean
# gateway-side signal on whether US free_chat stalls. Prints first/last SSE
# lines + timing.
set -uo pipefail
GATEWAY="https://api.jurexio.com"
J="${1:-US}"
MODE="${2:-free_chat}"
TOKEN="$(curl -sS -X POST "$GATEWAY/api/auth/login" -H 'Content-Type: application/json' -H "Origin: $GATEWAY" -d '{"email":"legalchat-admin-uat@jurexio.com","password":"Demo@2026!"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')"
echo "token_len=${#TOKEN} jur=$J mode=$MODE"

SID="$(curl -sS -X POST "$GATEWAY/api/jrx/legal-chat/sessions" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -H "Origin: $GATEWAY" -H 'X-NV-Shell: sme' -d "{\"title\":\"curl $J $MODE\",\"jurisdictions\":[\"$J\"],\"tier\":\"pro\",\"mode\":\"$MODE\"}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("session") or {}).get("id") or d.get("id") or "")' 2>/dev/null)"
echo "session=$SID"

echo "=== streaming send (max 290s) — first 3 + last 3 events ==="
t0=$(date +%s)
curl -sS --no-buffer --max-time 290 -X POST "$GATEWAY/api/jrx/legal-chat/send" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -H "Origin: $GATEWAY" -H 'X-NV-Shell: sme' \
  -d "{\"prompt\":\"Summarise the elements of a valid contract.\",\"jurisdictions\":[\"$J\"],\"mode\":\"$MODE\",\"sessionId\":\"$SID\"}" \
  2>/dev/null | grep --line-buffered '^data: ' | python3 -u -c '
import sys,time,json
t0=time.time(); first=None; last=None; n=0; steps=[]
for line in sys.stdin:
    n+=1; now=time.time()-t0
    if first is None: first=now; print(f"  FIRST event @ {now:.1f}s: {line[6:90].strip()}")
    last=(now,line[6:120].strip())
    try:
        e=json.loads(line[6:])
        st=e.get("step")
        if st and (not steps or steps[-1]!=st): steps.append(st); print(f"  step @ {now:.1f}s: {st}")
        if st=="run_complete": print(f"  RUN_COMPLETE @ {now:.1f}s"); 
    except: pass
print(f"  total_events={n} first={first} last_at={last[0]:.1f}s" if first is not None else "  NO EVENTS RECEIVED")
'
echo "elapsed=$(( $(date +%s) - t0 ))s"
echo "DONE"
