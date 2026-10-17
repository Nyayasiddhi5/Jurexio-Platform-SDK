#!/bin/sh
# Does the auto-minted session isolate NSP end-users, or pool them?
# mintEcosystemPromptSessionId hashes platform|org|user|day. If NSP sends no
# x-customer-user-id, userId falls back to `sdk:<appName>` for EVERY end user, so
# the hash is identical for all of them for the whole day.
#
# Test: two calls with NO x-customer-user-id must NOT share a session id if
# isolation works. Then two calls WITH different x-customer-user-id must differ.
# Turn A states a secret; Turn B (different "user", no session id) asks for it.
# If B can read A's secret, that is cross-user leakage of privileged matter.
#
# Positive control: key length >= 16, and turn A must return a sessionId.

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

post() { # $1=outfile $2=extra header $3=json
  curl -sS -m 120 -o "$1" -w "http=%{http_code} time=%{time_total}s\n" -X POST \
    -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "Content-Type: application/json" $2 -d "$3" \
    https://api.nyayasiddhi.online/api/jrx/orchestrate
}
sid() { python3 -c "import json;print((json.load(open('$1')).get('data') or {}).get('sessionId') or '')"; }

echo "=== A: no x-customer-user-id, states a secret ==="
post /tmp/pa.json "" '{"prompt":"Confidential: my client codename is PELICAN-7 and the settlement ceiling is Rs 3.2 crore. Acknowledge in one line.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}'
SA=`sid /tmp/pa.json`; echo "A sessionId=[$SA]"
if [ -z "$SA" ]; then echo "PROBE BROKEN: no sessionId from turn A"; exit 4; fi

echo "=== B: no x-customer-user-id either, NO sessionId sent, asks for A's secret ==="
post /tmp/pb.json "" '{"prompt":"What is the client codename and settlement ceiling I mentioned? If you do not know, reply exactly UNKNOWN.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}'
SB=`sid /tmp/pb.json`; echo "B sessionId=[$SB]"

echo "=== C: DIFFERENT x-customer-user-id, asks for A's secret ==="
post /tmp/pc.json '-H "X-Customer-User-Id: nsp-user-9931"' '{"prompt":"What is the client codename and settlement ceiling I mentioned? If you do not know, reply exactly UNKNOWN.","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}'
SC=`sid /tmp/pc.json`; echo "C sessionId=[$SC]"

python3 - "$SA" "$SB" "$SC" <<'PY'
import json, sys
sa, sb, sc = sys.argv[1], sys.argv[2], sys.argv[3]
def body(f):
    return str((json.load(open(f)).get('data') or {}).get('content') or '')
b, c = body('/tmp/pb.json'), body('/tmp/pc.json')
leak_b = 'PELICAN' in b.upper() or '3.2' in b
leak_c = 'PELICAN' in c.upper() or '3.2' in c
print('')
print('session_A == session_B (no user header)     : %s' % (sa == sb))
print('session_A == session_C (different user id) : %s' % (sa == sc))
print('B leaked A secret: %s' % leak_b)
print('C leaked A secret: %s' % leak_c)
print('')
if sa == sb:
    print('FINDING: all NSP end-users share ONE auto-minted session per day (userId falls back to sdk:<appName>).')
if sa != sc:
    print('GOOD: x-customer-user-id DOES partition the session id.')
else:
    print('FINDING: x-customer-user-id did NOT partition the session id.')
print('--- B first 200 ---'); print(b[:200])
print('--- C first 200 ---'); print(c[:200])
PY
