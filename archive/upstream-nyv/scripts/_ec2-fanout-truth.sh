#!/usr/bin/env bash
# NV-FANOUT-TRUTH-001 — is "3 completions" three REAL provider calls, or three
# log lines from one call? Request-scoped, so concurrent traffic cannot inflate it.
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
HTTP=$(curl -sS -m 300 -o /tmp/fanout.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -H 'X-NYV-Consent: granted' -d "$BODY" "${API}/api/jrx/orchestrate" 2>/dev/null || echo 000)
sleep 6
docker logs --tail 400000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/fanout.log

REQID=$(python3 -c "
import json
d=json.load(open('/tmp/fanout.json'))
d=d.get('data') if isinstance(d.get('data'),dict) else d
print(d.get('requestId') or '')
")
echo "http=$HTTP requestId=$REQID"

python3 - "$REQID" <<'PY'
import json, sys
rid = sys.argv[1]
BILLED = {'llm-orchestrator: hedge success':'hedge-winner',
          'llm-orchestrator: success':'sequential',
          'llm-orchestrator: stream success':'stream'}
scoped, unscoped = [], []
markers = {'retry':0, 'selfrag':0, 'cancel':0, 'waste':0, 'cachehit':0}
for line in open('/tmp/fanout.log', errors='replace'):
    line = line.strip()
    if not line.startswith('{'):
        if 'strict JSON retry' in line or 'JSON parse failed' in line: markers['retry'] += 1
        if 'selfrag' in line.lower() or 'Self-RAG' in line: markers['selfrag'] += 1
        continue
    try: rec = json.loads(line)
    except Exception:
        continue
    msg = str(rec.get('message') or '')
    if 'JSON parse failed' in msg or 'strict JSON retry' in msg: markers['retry'] += 1
    if 'selfrag' in msg.lower() or 'Self-RAG' in msg: markers['selfrag'] += 1
    if msg == 'llm-orchestrator: hedge loser cancelled': markers['cancel'] += 1
    if msg == 'llm-orchestrator: hedge loser spend recorded as waste': markers['waste'] += 1
    if 'cache hit' in msg.lower(): markers['cachehit'] += 1
    k = BILLED.get(msg)
    if not k: continue
    row = {'kind':k, 'model':rec.get('model'), 'rid':rec.get('requestId'),
           'tokIn':rec.get('tokensIn'), 'tokOut':rec.get('tokensOut'), 'ms':rec.get('latencyMs')}
    (scoped if (rid and rec.get('requestId')==rid) else unscoped).append(row)

print(f"\nREQUEST-SCOPED billed provider calls: {len(scoped)}")
for r in scoped: print("   ", r)
print(f"\nOTHER billed lines in window (concurrent traffic / no requestId): {len(unscoped)}")
for r in unscoped[:6]: print("   ", r)
print(f"\nmarkers: {markers}")
print("\nINTERPRETATION")
print("  scoped==1 -> the '3' was window pollution; only ONE real call.")
print("  scoped==3 -> three REAL provider calls (main + JSON-retry + self-RAG).")
PY
