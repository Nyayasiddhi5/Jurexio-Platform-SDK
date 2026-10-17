#!/bin/sh
# NV-COMPLETION-DRIVEN-001 live latency probe.
# Measures the two partner classes and counts the wait-tax log signatures.
# Positive control: NSP key length must be >=16 or the probe is broken.

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
KLEN=`printf %s "$K" | wc -c`
echo "control: nsp_key_len=$KLEN"
if [ "$KLEN" -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

SINCE=`date -u +%Y-%m-%dT%H:%M:%S`
echo "since=$SINCE"

echo "=== A. legal-draft-fast (interactive class, expect <90s) ==="
curl -sS -m 120 -o /tmp/a.json -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Draft a Written Statement in a civil suit for recovery of money.","taskType":"legal-draft-fast","jurisdiction":"IN","agentKey":"drafting-specialist"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 - <<'PY'
import json
d=json.load(open('/tmp/a.json'))
dd=d.get('data') or {}
r=dd.get('routing') or {}
qe=dd.get('qualityEnvelope') or {}
c=dd.get('cost') or {}
print('A: ok=%s chars=%s path=%s phase=%s degraded=%s completions=%s missing=%s'%(
 d.get('success'), len(str(dd.get('content') or '')), r.get('path'),
 dd.get('requestPhase'), dd.get('optionalDegraded'), c.get('completions'),
 qe.get('missingMandatory')))
PY

echo "=== B. forced Queen swarm (counsel class — the 366s path) ==="
curl -sS -m 560 -o /tmp/b.json -w "http=%{http_code} time=%{time_total}s\n" \
  -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Advise on anticipatory bail under BNSS 482 for an accused facing simultaneous PMLA attachment and SEBI proceedings, addressing limitation and the sequence of remedies across forums.","taskType":"legal_research","jurisdiction":"IN","orchestrationMode":"swarm"}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 - <<'PY'
import json
d=json.load(open('/tmp/b.json'))
dd=d.get('data') or {}
r=dd.get('routing') or {}
qe=dd.get('qualityEnvelope') or {}
c=dd.get('cost') or {}
print('B: ok=%s chars=%s path=%s phase=%s degraded=%s completions=%s missing=%s scaled=%s'%(
 d.get('success'), len(str(dd.get('content') or '')), r.get('path'),
 dd.get('requestPhase'), dd.get('optionalDegraded'), c.get('completions'),
 qe.get('missingMandatory'), qe.get('scaledOptional')))
PY

echo "=== C. wait-tax signatures since probe start (lower is better) ==="
LOG=`docker logs nyv-gateway --since "$SINCE" 2>&1`
echo -n "recall_budget_exhausted="; printf '%s' "$LOG" | grep -c "recall budget exhausted" || true
echo -n "first_useful_grace="; printf '%s' "$LOG" | grep -c "first_useful" || true
echo -n "capability_timed_out="; printf '%s' "$LOG" | grep -c "Timed out after 30000ms" || true
echo -n "cot_capture_failed="; printf '%s' "$LOG" | grep -c "CoT capture failed" || true
echo -n "envelope_failed="; printf '%s' "$LOG" | grep -c "mandatory steps missing" || true
echo -n "hedge_success="; printf '%s' "$LOG" | grep -c "hedge success" || true
echo "control: log_lines=`printf '%s' "$LOG" | wc -l` (0 means docker logs --since failed, not a quiet platform)"
