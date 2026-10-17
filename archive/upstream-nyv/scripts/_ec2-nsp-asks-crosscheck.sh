#!/bin/sh
# Cross-check the three NSP asks + the India-only requirement, on the live host.
# Positive control: key >=16 chars.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
B=https://api.nyayasiddhi.online

echo "=== ASK 3: Wave A state enum in OpenAPI ==="
curl -sS -m 30 "$B/api/jrx/openapi.json" -o /tmp/spec.json
python3 - <<'PY'
import json
s = json.load(open('/tmp/spec.json'))
sch = s.get('components', {}).get('schemas', {})
print('RequestPhase enum   :', sch.get('RequestPhase', {}).get('enum'))
d = sch.get('OrchestrateOutcome', {}).get('properties', {}).get('data', {})
print('required            :', d.get('required'))
print('documented fields   :', [k for k in ('requestPhase','optionalDegraded','orchestrationId','sessionId') if k in d.get('properties', {})])
refs = [p for p in s['paths'] if p.endswith('/orchestrate')]
print('orchestrate ops ref :', all('OrchestrateOutcome' in json.dumps(s['paths'][p]['post']['responses']['200']) for p in refs), refs)
PY

echo ""
echo "=== INDIA-ONLY: NSP key asking for US jurisdiction on the GATEWAY ==="
curl -sS -m 90 -o /tmp/us.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: probe-user-1" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"US","type":"contract","content":"This Agreement is governed by the laws of the State of Delaware and disputes shall be resolved in Delaware Chancery Court under Delaware General Corporation Law."}' \
  "$B/api/jrx/gateway/documents/analyze"
python3 - <<'PY'
import json
d = json.load(open('/tmp/us.json')).get('data') or {}
j = d.get('jurisdiction')
print('requested US -> served jurisdiction:', j)
print('VERDICT:', 'FORCED TO IN (correct for NSP)' if j == 'IN' else 'NOT SCOPED — still %s' % j)
PY

echo ""
echo "=== ASK 1 evidence: does orchestrate ever emit 502 from our side? ==="
LOG=`docker logs nyv-gateway --since 30m 2>&1`
echo -n "  our 503 AI_SERVICE_UNAVAILABLE : "; printf '%s' "$LOG" | grep -c "AI_SERVICE_UNAVAILABLE" || true
echo -n "  cascade exhausted              : "; printf '%s' "$LOG" | grep -cE "all providers failed|cascade exhausted" || true
echo -n "  gateway 5xx emitted            : "; printf '%s' "$LOG" | grep -cE '"status":5[0-9][0-9]' || true
echo -n "  unhandled rejections           : "; printf '%s' "$LOG" | grep -c "UnhandledPromiseRejection" || true
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
docker inspect nyv-gateway --format '  restarts={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}'
echo -n "  502 anywhere in gateway logs   : "; printf '%s' "$LOG" | grep -c " 502 " || true
