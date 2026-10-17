#!/bin/sh
# NV-SESSION-ECHO-001 — prove a real 2-turn session, not just that a field exists.
# Turn 1 states a distinctive fact and gets a sessionId back. Turn 2 replays that
# sessionId and asks about the fact WITHOUT restating it. If the answer knows it,
# continuity works end-to-end (echo + store + recall).
# Positive control: turn 1 must return a non-empty sessionId, else the probe is
# testing nothing and must say so rather than "pass".

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

echo "=== TURN 1 ==="
curl -sS -m 120 -o /tmp/t1.json -w "http=%{http_code} time=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"My client is Meridian Textiles Pvt Ltd and the disputed invoice number is INV-88421 for Rs 47,00,000. Summarise the recovery options in two lines.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate

SID=`python3 -c "
import json
d=json.load(open('/tmp/t1.json')).get('data') or {}
print(d.get('sessionId') or '')
"`
echo "turn1 sessionId=[$SID]"
if [ -z "$SID" ]; then echo "FAIL: no sessionId echoed — continuity still impossible"; exit 4; fi

echo "=== TURN 2 (same sessionId, fact NOT restated) ==="
curl -sS -m 120 -o /tmp/t2.json -w "http=%{http_code} time=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Which invoice number and client did I just mention? Answer with the invoice number only.\",\"taskType\":\"legal-chat-fast\",\"jurisdiction\":\"IN\",\"enableMemory\":true,\"sessionId\":\"$SID\"}" \
  https://api.nyayasiddhi.online/api/jrx/orchestrate

python3 - "$SID" <<'PY'
import json, sys
sid = sys.argv[1]
d2 = json.load(open('/tmp/t2.json')).get('data') or {}
body = str(d2.get('content') or '')
same = d2.get('sessionId') == sid
recalled = 'INV-88421' in body
print('turn2 sessionId_stable=%s recalled_invoice=%s phase=%r chars=%d'
      % (same, recalled, d2.get('requestPhase'), len(body)))
print('VERDICT: %s' % ('CONTINUITY WORKS' if (same and recalled)
      else 'ECHO OK but RECALL MISSING' if same else 'ECHO BROKEN'))
print('--- turn2 first 300 chars ---')
print(body[:300])
PY

echo "=== session memory rows written for this session ==="
DBURL=`grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
DBURL=`printf %s "$DBURL" | sed -e 's/sslmode=no-verify/sslmode=require/'`
docker exec -i nyv-postgres psql "$DBURL" -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) AS rows_for_session FROM nv_schema.nv_memory_entries WHERE session_id = '$SID';" 2>/dev/null \
  || docker exec -i nyv-postgres psql "$DBURL" -c \
  "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%memor%' LIMIT 10;"

echo "=== activity / audit trail for both turns ==="
LOG=`docker logs nyv-gateway --since 6m 2>&1`
echo -n "orchestrate_complete_persisted="; printf '%s' "$LOG" | grep -c "orchestrate.complete IronLedger entry persisted" || true
echo -n "decision_log_failures="; printf '%s' "$LOG" | grep -c "persistent decision-log write failed" || true
echo -n "step0_first_useful="; printf '%s' "$LOG" | grep -c "released on first useful grounding" || true
echo "control: log_lines=`printf '%s' "$LOG" | wc -l`"
