#!/bin/sh
# P0+P1 acceptance. Proves each change is LIVE and that nothing regressed.
# Positive control: NSP key >=16 chars and the settings query must return both rows.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n" | sed -E 's/sslmode=no-verify/sslmode=require/'`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
APP=`docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null | sed -E 's/sslmode=no-verify/sslmode=require/'`
pq() { docker run --rm --network host -e PGURL="$APP" -e SQL="$1" postgres:16-alpine sh -c 'psql "$PGURL" -At -F"|" -c "$SQL"' 2>&1; }

echo "=== 1. planner params live on a NEW connection (dynamic = no reboot) ==="
pq "SELECT 'random_page_cost', current_setting('random_page_cost'), 'work_mem', current_setting('work_mem');"

echo ""
echo "=== 2. did the seq-scan bias improve? memory_entries plan ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c 'psql "$PGURL" -c "EXPLAIN (ANALYZE) SELECT id FROM nv_schema.memory_entries WHERE user_id=(SELECT user_id FROM nv_schema.memory_entries GROUP BY user_id ORDER BY count(*) DESC LIMIT 1) ORDER BY importance DESC, last_accessed_at DESC LIMIT 20;"' 2>&1 | grep -iE "Index Scan|Seq Scan|Execution Time|Sort Method" | head -4

echo ""
echo "=== 3. legal-graph vector index is live ==="
pq "SELECT 'hnsw_indexes', count(*)::text FROM pg_indexes WHERE schemaname='nv_schema' AND indexdef ILIKE '%hnsw%';"

echo ""
echo "=== 4. prompt caching markers in the running container ==="
echo -n "  bedrock cache_control : "; docker exec nyv-gateway grep -c "cache_control" /app/src/services/intelligent-router/bedrock-request-builder.ts
echo -n "  direct  cache_control : "; docker exec nyv-gateway grep -c "cache_control" /app/src/services/intelligent-router/llm-orchestrator.ts
echo -n "  CANARY (known-old)    : "; docker exec nyv-gateway grep -c "hedge success" /app/src/services/intelligent-router/llm-orchestrator.ts

echo ""
echo "=== 5. storage route exists (was a 404 hole) ==="
curl -sS -m 15 -o /tmp/sr.json -w "  no_token=%{http_code} (expect 403)\n" "http://localhost:5000/api/jrx/storage/files/x/y.pdf"
curl -sS -m 15 -o /tmp/sr2.json -w "  bad_token=%{http_code} (expect 403)\n" "http://localhost:5000/api/jrx/storage/files/x/y.pdf?exp=99999999999999&token=deadbeef"
head -c 120 /tmp/sr2.json; echo

echo ""
echo "=== 6. REAL AI traffic — quality + latency must be intact ==="
for T in legal-chat-fast legal-draft-fast; do
  curl -sS -m 180 -o /tmp/ai.json -w "  $T http=%{http_code} t=%{time_total}s\n" -X POST \
    -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
    -d "{\"prompt\":\"In two lines: grounds for anticipatory bail under BNSS 482?\",\"taskType\":\"$T\",\"jurisdiction\":\"IN\",\"enableMemory\":true}" \
    https://api.nyayasiddhi.online/api/jrx/orchestrate
  python3 -c "
import json;d=json.load(open('/tmp/ai.json')).get('data') or {}
c=d.get('cost') or {}
print('    phase=%s chars=%d model=%s completions=%s missing=%s' % (d.get('requestPhase'), len(str(d.get('content') or '')), c.get('model'), c.get('completions'), (d.get('qualityEnvelope') or {}).get('missingMandatory')))"
done

echo ""
echo "=== 7. analyze fields still work (NSP contract) ==="
curl -sS -m 200 -o /tmp/an.json -w "  analyze http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
  -d '{"jurisdiction":"IN","documentText":"IN THE HIGH COURT OF JUDICATURE AT HYDERABAD\nCriminal Petition No. 4471 of 2025\nPETITION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 FOR ANTICIPATORY BAIL\nRam Kumar S/o Late Shri Mohan Lal\n... PETITIONER\nThe State of Telangana\n... RESPONDENT No. 1\nFIR No. 221 of 2025 at Banjara Hills Police Station on 12 March 2025. Amount Rs 47,00,000. Listed on 28 March 2025.\nPRAYER:\nGrant anticipatory bail."}' \
  https://api.nyayasiddhi.online/api/jrx/sdk/docs-pipeline/documents/analyze
python3 -c "
import json;d=json.load(open('/tmp/an.json')).get('data') or {}
print('    fieldSource=%s fieldCount=%s type=%s statutes=%s' % (d.get('fieldSource'), d.get('fieldCount'), d.get('detectedDocumentType'), len(d.get('statutes') or [])))"

echo ""
echo "=== 8. error hygiene since deploy ==="
LOG=`docker logs nyv-gateway --since 15m 2>&1`
for p in "cache_control" "ValidationException" "AI_SERVICE_UNAVAILABLE" "mandatory steps missing" "permission denied" "does not exist" "ECONNREFUSED" "recall budget exhausted"; do
  printf '  %-30s %s\n' "$p" "`printf '%s' "$LOG" | grep -c "$p"`"
done
docker inspect nyv-gateway --format '  restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
