#!/bin/sh
# Session isolation, corrected. The previous version passed the extra header via a
# shell variable, which word-split and produced http=000 for the C leg — an
# instrument failure, not a result (NV-VALIDATE-THE-PROBE-001). Headers are now
# literal in each curl call.
#
# Two questions:
#   Q1 Do two NSP calls with no x-customer-user-id share one session? (isolation)
#   Q2 Does x-customer-user-id partition the session id?
#   Q3 Was cross-matter memory INJECTED into the prompt, even if the model refused?
#      (Refusal by model judgement is not the same as scoping. This is the one that
#       matters for privilege.)

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi
Q='{"prompt":"What client codename and settlement ceiling did I mention earlier? If you do not know, reply exactly UNKNOWN.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}'

echo "=== B2: no user header (control leg) ==="
curl -sS -m 120 -o /tmp/qb.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" -d "$Q" \
  https://api.nyayasiddhi.online/api/jrx/orchestrate

echo "=== C2: WITH X-Customer-User-Id (literal header) ==="
curl -sS -m 120 -o /tmp/qc.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp-user-9931" \
  -H "Content-Type: application/json" -d "$Q" \
  https://api.nyayasiddhi.online/api/jrx/orchestrate

echo "=== D2: a DIFFERENT X-Customer-User-Id ==="
curl -sS -m 120 -o /tmp/qd.json -w "http=%{http_code}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp-user-5502" \
  -H "Content-Type: application/json" -d "$Q" \
  https://api.nyayasiddhi.online/api/jrx/orchestrate

python3 - <<'PY'
import json
def load(f):
    d = json.load(open(f)).get('data') or {}
    return (d.get('sessionId') or '', str(d.get('content') or ''),
            (d.get('memoryContext') or {}))
sb, bb, mb = load('/tmp/qb.json')
sc, bc, mc = load('/tmp/qc.json')
sd, bd, md = load('/tmp/qd.json')
print('')
print('B2 session (no header) : %s' % sb)
print('C2 session (user 9931) : %s' % sc)
print('D2 session (user 5502) : %s' % sd)
print('')
print('Q2 partitions by user? : %s' % (sb != sc and sc != sd))
def disclosed(t):
    u = t.upper()
    return 'PELICAN' in u and 'UNKNOWN' not in u[:40]
print('')
for name, body, mem in (('B2', bb, mb), ('C2', bc, mc), ('D2', bd, md)):
    print('%s memory_contextUsed=%s memory_session=%s DISCLOSED=%s'
          % (name, mem.get('contextUsed'), mem.get('sessionId'), disclosed(body)))
print('')
print('Q3 — did cross-matter memory reach the prompt at all?')
print('  B2 mentions the other matter in its refusal: %s' % ('PELICAN' in bb.upper()))
print('')
print('--- B2 first 320 ---'); print(bb[:320])
PY
