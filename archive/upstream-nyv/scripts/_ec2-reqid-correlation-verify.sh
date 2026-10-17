#!/usr/bin/env bash
# NV-REQID-CORRELATION-001 verification.
#
# Before the fix, the id in the API response matched ZERO billed provider log
# lines, because nv-client minted its own. This probe asserts the opposite: the
# id the caller receives must appear on the billed lines for that request.
#
# Request-scoped by construction, so concurrent traffic on the shared dev host
# cannot inflate or deflate the result.
set -uo pipefail
CANON="${NVB_CANON:-/opt/Nyayavigya/secrets/.env.production}"
API=http://localhost:5000
GID=$(docker ps -q --filter name=gateway | head -1)
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

PROMPT='What are the grounds for anticipatory bail under BNSS 482?'
BODY=$(python3 -c "
import json,sys
print(json.dumps({'prompt':sys.argv[1],'taskType':'legal_advice','jurisdiction':'IN'}))
" "$PROMPT")

BEFORE=$(docker logs --tail 400000 "$GID" 2>&1 | wc -l | tr -d ' ')
HTTP=$(curl -sS -m 300 -o /tmp/reqid.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -H 'X-NYV-Consent: granted' -d "$BODY" "${API}/api/jrx/orchestrate" 2>/dev/null || echo 000)
sleep 6
docker logs --tail 400000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/reqid.log

REQID=$(python3 -c "
import json
d=json.load(open('/tmp/reqid.json'))
d=d.get('data') if isinstance(d.get('data'),dict) else d
print(d.get('requestId') or '')
")
echo "http=$HTTP requestId=$REQID"

python3 - "$REQID" <<'PY'
import json, sys
rid = sys.argv[1]
BILLED = {'llm-orchestrator: hedge success', 'llm-orchestrator: success',
          'llm-orchestrator: stream success'}
scoped, foreign = [], 0
for line in open('/tmp/reqid.log', errors='replace'):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        rec = json.loads(line)
    except Exception:
        continue
    if str(rec.get('message') or '') not in BILLED:
        continue
    lineid = str(rec.get('requestId') or '')
    # Accept the parent id and any parent-scoped child (::leaf-*, ::synthesis, ...).
    if rid and (lineid == rid or lineid.startswith(rid) or rid in lineid):
        scoped.append({'model': rec.get('model'), 'id': lineid,
                       'tokIn': rec.get('tokensIn'), 'tokOut': rec.get('tokensOut')})
    else:
        foreign += 1

print(f"\nrequest-scoped billed calls : {len(scoped)}")
for r in scoped:
    print("   ", r)
print(f"foreign lines in window     : {foreign}  (concurrent traffic — correctly excluded)")
print("\nVERDICT")
if not rid:
    print("  INCONCLUSIVE — no requestId in response envelope.")
elif scoped:
    print(f"  PASS — correlation works. Fan-out for THIS request = {len(scoped)}.")
    print("  Cost is now attributable per request (scopeMode: 'request').")
else:
    print("  FAIL — response id still matches no billed line; a mint site remains.")
PY
