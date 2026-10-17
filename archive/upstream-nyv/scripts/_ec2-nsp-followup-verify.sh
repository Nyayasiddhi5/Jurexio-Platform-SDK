#!/bin/sh
# Verify all six NSP follow-up items on the live host, using NSP's own header shapes.
# Positive control: key >=16 chars.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
B=https://api.nyayasiddhi.online
ADV1="nsp:o:3:u:315"
ADV2="nsp:o:3:u:902"

echo "===== 1. Do we see the real advocate id? ====="
SINCE=`date -u +%Y-%m-%dT%H:%M:%S`
curl -sS -m 120 -o /tmp/i1.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: $ADV1" -H "X-Customer-Org-Id: 3" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"One line: what is anticipatory bail?","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  "$B/api/jrx/orchestrate"
python3 -c "
import json;d=json.load(open('/tmp/i1.json')).get('data') or {}
print('  sessionId:', d.get('sessionId')); print('  phase:', d.get('requestPhase'))"
echo "  --- what identity did the gateway log? ---"
docker logs nyv-gateway --since "$SINCE" 2>&1 | grep -o '"userId":"[^"]*"' | sort -u | head -5
echo "  (expect nsp:o:3:u:315, NOT sdk:Nyayasiddhi...)"

echo ""
echo "===== 2. Session contract: X-Customer-Session-Id preferred over the mint? ====="
curl -sS -m 120 -o /tmp/i2.json -w "  http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: $ADV1" -H "X-Customer-Session-Id: nsp:o:3:u:315:t:77" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"One line: what is bail?","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  "$B/api/jrx/orchestrate"
python3 -c "
import json;d=json.load(open('/tmp/i2.json')).get('data') or {}
s=d.get('sessionId')
print('  returned sessionId:', s)
print('  VERDICT:', 'HEADER HONOURED' if s=='nsp:o:3:u:315:t:77' else 'NOT honoured (%s)' % s)"

echo ""
echo "===== 3. LEAK TEST — advocate A states a secret, advocate B asks for it ====="
curl -sS -m 120 -o /tmp/la.json -w "  A http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: $ADV1" -H "Content-Type: application/json" \
  -d '{"prompt":"Confidential: my client codename is FALCON-9 and the settlement ceiling is Rs 8.4 crore. Acknowledge in one line.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  "$B/api/jrx/orchestrate"
SA=`python3 -c "import json;print((json.load(open('/tmp/la.json')).get('data') or {}).get('sessionId') or '')"`
echo "  A sessionId=$SA"
curl -sS -m 120 -o /tmp/lb.json -w "  B http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: $ADV2" -H "Content-Type: application/json" \
  -d '{"prompt":"What client codename and settlement ceiling was mentioned? If you do not know, reply exactly UNKNOWN.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  "$B/api/jrx/orchestrate"
python3 - "$SA" <<'PY'
import json, sys
sa = sys.argv[1]
b = json.load(open('/tmp/lb.json')).get('data') or {}
body = str(b.get('content') or '')
u = body.upper()
leaked = 'FALCON' in u or '8.4' in body
print('  B sessionId=%s' % b.get('sessionId'))
print('  same session as A: %s' % (b.get('sessionId') == sa))
print('  LEAKED: %s' % leaked)
print('  VERDICT: %s' % ('LEAK — advocate B saw advocate A data' if leaked else 'NO LEAK across advocates'))
print('  B says:', body[:160].replace('\n', ' '))
PY

echo ""
echo "===== 4. Does orchestrate ever emit 502 from our side? ====="
LOG=`docker logs nyv-gateway --since 20m 2>&1`
echo -n "  our 503 AI_SERVICE_UNAVAILABLE: "; printf '%s' "$LOG" | grep -c "AI_SERVICE_UNAVAILABLE" || true
echo -n "  cascade exhausted             : "; printf '%s' "$LOG" | grep -cE "all providers failed|cascade exhausted" || true
echo -n "  literal 502 in gateway logs   : "; printf '%s' "$LOG" | grep -c " 502 " || true
docker inspect nyv-gateway --format '  restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"

echo ""
echo "===== 5. analyzeDocument fields on BOTH endpoints ====="
cat > /tmp/cd.json <<'JSON'
{"jurisdiction":"IN","documentText":"IN THE HIGH COURT OF JUDICATURE AT HYDERABAD\nFOR THE STATE OF TELANGANA\n\nCriminal Petition No. 4471 of 2025\n\nBETWEEN:\nRam Kumar S/o Late Shri Mohan Lal, aged 42 years, R/o Banjara Hills, Hyderabad\n... PETITIONER\n\nAND\n\nThe State of Telangana, rep. by its Public Prosecutor\n... RESPONDENT No. 1\nMeridian Textiles Pvt Ltd, rep. by its Managing Director\n... RESPONDENT No. 2\n\nPETITION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 FOR ANTICIPATORY BAIL\n\n1. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station on 12 March 2025 under Sections 318 and 316(2) of the Bharatiya Nyaya Sanhita, 2023.\n2. That the alleged amount involved is Rs 47,00,000.\n3. That the matter is listed before the Hon'ble Justice A. Rajashekar Reddy on 28 March 2025.\n\nPRAYER:\nIt is prayed that this Hon'ble Court may grant anticipatory bail to the Petitioner.","content":"IN THE HIGH COURT OF JUDICATURE AT HYDERABAD\nFOR THE STATE OF TELANGANA\n\nCriminal Petition No. 4471 of 2025\n\nBETWEEN:\nRam Kumar S/o Late Shri Mohan Lal, aged 42 years, R/o Banjara Hills, Hyderabad\n... PETITIONER\n\nAND\n\nThe State of Telangana, rep. by its Public Prosecutor\n... RESPONDENT No. 1\nMeridian Textiles Pvt Ltd, rep. by its Managing Director\n... RESPONDENT No. 2\n\nPETITION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 FOR ANTICIPATORY BAIL\n\n1. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station on 12 March 2025 under Sections 318 and 316(2) of the Bharatiya Nyaya Sanhita, 2023.\n2. That the alleged amount involved is Rs 47,00,000.\n3. That the matter is listed before the Hon'ble Justice A. Rajashekar Reddy on 28 March 2025.\n\nPRAYER:\nIt is prayed that this Hon'ble Court may grant anticipatory bail to the Petitioner."}
JSON
for P in /api/jrx/sdk/docs-pipeline/documents/analyze /api/jrx/sdk/docs-pipeline/documents/intelligence /api/jrx/gateway/documents/analyze; do
  printf '  %-52s ' "$P"
  curl -sS -m 180 -o /tmp/f.json -w "http=%{http_code} " -X POST \
    -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "X-Customer-User-Id: $ADV1" -H "Content-Type: application/json" \
    -d @/tmp/cd.json "$B$P"
  python3 -c "
import json
d=json.load(open('/tmp/f.json')).get('data') or {}
print('fieldSource=%s fieldCount=%s type=%s' % (d.get('fieldSource'), d.get('fieldCount'), d.get('detectedDocumentType')))"
done

echo ""
echo "===== 6. Wave A enum in OpenAPI ====="
curl -sS -m 30 "$B/api/jrx/openapi.json" -o /tmp/spec.json
python3 -c "
import json;s=json.load(open('/tmp/spec.json'));sch=s['components']['schemas']
print('  RequestPhase:', sch['RequestPhase']['enum'])
print('  required   :', sch['OrchestrateOutcome']['properties']['data']['required'])"
