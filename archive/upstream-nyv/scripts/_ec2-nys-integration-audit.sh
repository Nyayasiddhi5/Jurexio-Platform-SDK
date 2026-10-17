#!/bin/sh
# NYV <-> NYS integration health, measured from inside the gateway.
# The NYS source tree is NOT in this workspace, so this audits the INTEGRATION
# (what NYV asks NYS, what comes back, how often, how fast) — not NYS internals.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi

echo "=== 1. is the NYS knowledge plane configured + flagged on? (names only) ==="
docker exec nyv-gateway sh -c 'printenv | grep -oE "^(NYS[A-Z_]*|NYV_NYS[A-Z_]*|NYV_F_NYS[A-Z_]*)" | sort -u'
echo -n "  nysKnowledgePlane flag: "
docker exec nyv-gateway sh -c 'printenv NYV_F_NYS_KNOWLEDGE_PLANE 2>/dev/null || echo "<unset -> default ON in non-dev>"'

echo ""
echo "=== 2. does NYV actually reach NYS? (statute path, should be ms + zero LLM) ==="
curl -sS -m 60 -o /tmp/k1.json -w "  statutes http=%{http_code} t=%{time_total}s\n" \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" \
  "http://localhost:5000/api/jrx/knowledge/statutes/search?q=anticipatory%20bail&limit=3"
python3 -c "
import json;d=json.load(open('/tmp/k1.json'))
r=d.get('data') or d
n=len(r.get('results') or r.get('statutes') or r.get('items') or []) if isinstance(r,dict) else 0
print('    results=%s keys=%s' % (n, sorted(r.keys())[:8] if isinstance(r,dict) else type(r).__name__))"

echo ""
echo "=== 3. IPC->BNS deterministic map (the zero-LLM path NYS enables) ==="
curl -sS -m 60 -o /tmp/k2.json -w "  compare http=%{http_code} t=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"section":"302","from":"IPC"}' \
  "http://localhost:5000/api/jrx/knowledge/statutes/compare/ipc-bns"
head -c 200 /tmp/k2.json; echo

echo ""
echo "=== 4. caselaw search (hybrid) ==="
curl -sS -m 60 -o /tmp/k3.json -w "  caselaw http=%{http_code} t=%{time_total}s\n" \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" \
  "http://localhost:5000/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail&limit=3&mode=hybrid"

echo ""
echo "=== 5. NYS participation in a REAL orchestrate call (layersUsed) ==="
curl -sS -m 180 -o /tmp/o1.json -w "  orchestrate http=%{http_code} t=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
  -d '{"prompt":"What does BNS section 103 say?","taskType":"legal-chat-fast","jurisdiction":"IN"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 -c "
import json;d=json.load(open('/tmp/o1.json')).get('data') or {}
rc=d.get('ragContext') or {}
c=d.get('cost') or {}
print('    layersUsed=%s' % (rc.get('layersUsed') or d.get('layersUsed')))
print('    retrievalMethods=%s' % rc.get('retrievalMethods'))
print('    docsRetrieved=%s completions=%s resolution=%s' % (rc.get('documentsRetrieved'), c.get('completions'), c.get('resolution')))
print('    model=%s chars=%d' % (c.get('model'), len(str(d.get('content') or ''))))"

echo ""
echo "=== 6. NYS call outcomes in the gateway log (last 2h) ==="
LOG=`docker logs nyv-gateway --since 2h 2>&1`
for p in "nys_global" "NYS" "llmRequired" "nys-statute-map" "knowledge plane" "NYS transport"; do
  printf '  %-22s %s\n' "$p" "`printf '%s' "$LOG" | grep -c "$p"`"
done
echo -n "  NYS errors/timeouts   : "; printf '%s' "$LOG" | grep -ciE "nys.*(fail|timeout|error|refused)" || true
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
