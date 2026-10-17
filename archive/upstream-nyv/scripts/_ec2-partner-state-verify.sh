#!/bin/sh
# Verify the partner-visible state fields and that the decision log resumed.
# Positive controls: NSP key >=16 chars, and the column-count query must return 18.

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
KLEN=`printf %s "$K" | wc -c`
echo "control: nsp_key_len=$KLEN"
if [ "$KLEN" -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

echo "=== A. specialist path (-fast): must carry requestPhase ==="
curl -sS -m 120 -o /tmp/a.json -w "http=%{http_code} time=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Draft a short Written Statement for recovery of money.","taskType":"legal-draft-fast","jurisdiction":"IN"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 - <<'PY'
import json
d=json.load(open('/tmp/a.json')); dd=d.get('data') or {}
print('A: phase=%r degraded=%r orchestrationId=%r path=%s chars=%d requestId=%s'%(
 dd.get('requestPhase'), dd.get('optionalDegraded'), dd.get('orchestrationId'),
 (dd.get('routing') or {}).get('path'), len(str(dd.get('content') or '')), dd.get('requestId')))
PY

echo "=== B. Queen swarm: must carry requestPhase + orchestrationId ==="
curl -sS -m 560 -o /tmp/b.json -w "http=%{http_code} time=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Advise on anticipatory bail under BNSS 482 where the accused also faces PMLA attachment and SEBI proceedings, addressing limitation and sequencing across forums.","taskType":"legal_research","jurisdiction":"IN","orchestrationMode":"swarm"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 - <<'PY'
import json
d=json.load(open('/tmp/b.json')); dd=d.get('data') or {}
qe=dd.get('qualityEnvelope') or {}
print('B: phase=%r degraded=%r orchestrationId=%r path=%s chars=%d completions=%s missing=%s'%(
 dd.get('requestPhase'), dd.get('optionalDegraded'), dd.get('orchestrationId'),
 (dd.get('routing') or {}).get('path'), len(str(dd.get('content') or '')),
 (dd.get('cost') or {}).get('completions'), qe.get('missingMandatory')))
# Internal flags must NOT leak to partners.
for leaked in ('osDepth','queenCotApplied','queenCotSkippedProgression','queenCotCaptureFailed'):
    assert leaked not in dd, 'LEAK: %s present in partner payload' % leaked
print('B: no internal leak (osDepth / queenCot* absent) OK')
PY

echo "=== C. decision log resumed? (was frozen at 11,394 / 10:29:04) ==="
DBURL=`grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
DBURL=`printf %s "$DBURL" | sed -e 's/sslmode=no-verify/sslmode=require/'`
docker exec -i nyv-postgres psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS control_column_count FROM information_schema.columns WHERE table_name='nv_router_decisions';
SELECT count(*) AS rows_persisted, max(ts) AS newest FROM nv_router_decisions;
SELECT max(length(request_id)) AS max_reqid_len, count(*) FILTER (WHERE request_id LIKE '%::%') AS scoped_ids_stored
  FROM nv_router_decisions;
SELECT task_kind, count(*) FROM nv_router_decisions
 WHERE ts > now() - interval '10 minutes' GROUP BY task_kind ORDER BY 2 DESC LIMIT 8;
SQL

echo "=== D. write failures since deploy (want 0 stuck retries) ==="
LOG=`docker logs nyv-gateway --since 12m 2>&1`
echo -n "decision_log_write_failed="; printf '%s' "$LOG" | grep -c "persistent decision-log write failed" || true
echo -n "unwritable_dropped="; printf '%s' "$LOG" | grep -c "NYV-ROUTER-LOG-001" || true
echo -n "value_too_long="; printf '%s' "$LOG" | grep -c "value too long" || true
echo -n "step0_first_useful="; printf '%s' "$LOG" | grep -c "released on first useful grounding" || true
echo "control: log_lines=`printf '%s' "$LOG" | wc -l`"
