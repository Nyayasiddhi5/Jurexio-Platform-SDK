#!/bin/sh
# Verify the three DEPLOYED items live. Item 1's migration is blocked on a stale
# admin credential, so this also confirms its fallback is behaving (recall healthy,
# no value_tsv errors) rather than silently broken.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
B=https://api.nyayasiddhi.online

echo "=== drive traffic so step0 counters have something to count ==="
for i in 1 2; do
  curl -sS -m 180 -o /tmp/s$i.json -w "  run$i http=%{http_code} t=%{time_total}s\n" -X POST \
    -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
    -d '{"prompt":"Advise on anticipatory bail under BNSS 482 with concurrent PMLA attachment; address limitation and forum sequencing.","taskType":"legal_research","jurisdiction":"IN","orchestrationMode":"swarm","enableMemory":true}' \
    "$B/api/jrx/orchestrate"
done

echo ""
echo "=== NV-STEP0-OBSERVABILITY-001 counters (needs admin JWT; read from process if 401) ==="
curl -sS -m 30 "$B/api/jrx/router-stats" -o /tmp/rs.json -w "  http=%{http_code}\n"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/rs.json'))
except Exception as e:
    print('  (not JSON:', e, ')'); raise SystemExit
s = d.get('step0Grounding')
dl = d.get('decisionLog')
print('  step0Grounding:', json.dumps(s) if s else '<absent — route may be JWT-gated>')
print('  decisionLog   :', json.dumps(dl) if dl else '<absent>')
if s:
    obs = s.get('observed', 0)
    print('  READING:', 'stage never reached (WIRING PROBLEM)' if obs == 0
          else 'stage reached %d time(s), released early %d — mechanism wired, %s'
               % (obs, s.get('releasedEarly', 0),
                  'not needed (expected while recall is fast)' if s.get('releasedEarly', 0) == 0 else 'firing'))
PY

echo ""
echo "=== NV-NER-PERSON-INDIA-001 + JUDGE initials, live ==="
curl -sS -m 60 -o /tmp/ner.json -w "  http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp:o:3:u:315" -H "Content-Type: application/json" \
  -d '{"text":"Ram Kumar S/o Late Shri Mohan Lal, aged 42 years, filed before the Hon'"'"'ble Justice A. Rajashekar Reddy against Meridian Textiles Pvt Ltd for Rs 47,00,000 on 12 March 2025. Counsel for the Petitioner: Ravi Shankar.","jurisdiction":"IN"}' \
  "$B/api/jrx/intelligence/legal-ner"
python3 - <<'PY'
import json
d = (json.load(open('/tmp/ner.json')).get('data') or {})
ents = d.get('entities') or []
from collections import defaultdict
by = defaultdict(list)
for e in ents:
    by[e['type']].append(e['text'])
for t in sorted(by):
    print('  %-12s %s' % (t, '; '.join(by[t])[:90]))
print('  counts:', json.dumps(d.get('entityCounts') or {}))
print('  PERSON present:', 'PERSON' in by, '| JUDGE present:', 'JUDGE' in by)
bad = [p for p in by.get('PERSON', []) if any(x in p for x in ('High Court','Meridian','Counsel','Justice'))]
print('  PRECISION:', 'CLEAN' if not bad else 'OVER-MATCHED -> %s' % bad)
PY

echo ""
echo "=== item 1 fallback: recall healthy WITHOUT the migration? ==="
LOG=`docker logs nyv-gateway --since 10m 2>&1`
echo -n "  value_tsv errors            : "; printf '%s' "$LOG" | grep -c "value_tsv" || true
echo -n "  memory recall/store failures: "; printf '%s' "$LOG" | grep -c "recall failed\|memory store failed" || true
echo -n "  recall budget exhausted     : "; printf '%s' "$LOG" | grep -c "recall budget exhausted" || true
echo -n "  step0 released early lines  : "; printf '%s' "$LOG" | grep -c "released on first useful grounding" || true
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
