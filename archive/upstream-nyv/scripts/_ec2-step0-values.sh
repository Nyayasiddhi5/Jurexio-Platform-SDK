#!/bin/sh
# Read the actual counter VALUES. The earlier probe looped two URLs and the 404 leg
# overwrote /tmp/rs.json, so it reported null from the wrong body — instrument bug,
# not a platform finding (NV-VALIDATE-THE-PROBE-001).
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
curl -sS -m 30 -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" \
  http://localhost:5000/api/jrx/observability/router-stats -o /tmp/ok.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/ok.json'))
s=d['step0Grounding']; dl=d['decisionLog']
print('step0Grounding:', json.dumps(s))
print('decisionLog   :', json.dumps(dl))
obs=s.get('observed',0)
print('READING:', 'NEVER REACHED (wiring problem)' if obs==0 else
      'reached %d | releasedEarly %d | bothSettled %d | neitherUseful %d => mechanism WIRED; %s'
      % (obs, s['releasedEarly'], s['bothSettled'], s['neitherUseful'],
         'not needed yet (expected while recall is fast)' if s['releasedEarly']==0 else 'FIRING'))
print('decision-log health:', 'clean' if dl.get('consecutiveFailures')==0 and dl.get('droppedAsUnwritable')==0 else 'ATTENTION')
PY
