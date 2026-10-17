#!/bin/sh
# NV-NSP-EXCEPTION-REPRO-001 — what does an NSP request actually get back?
#
# Runs on nysdev against the live gateway. Deliberately /bin/sh-compatible:
# SSM AWS-RunShellScript executes with sh, not bash, so `set -o pipefail` and
# bash-only syntax abort the whole document.
#
# NV-VALIDATE-THE-PROBE-001: resolves and length-checks the API key first. If the
# key is absent, every request below would 401 and the output would look like a
# platform outage rather than a broken probe.

CANON=/opt/Nyayavigya/secrets/.env.production
if [ ! -f "$CANON" ]; then CANON=/opt/nyayavigya/secrets/.env.production; fi

if [ ! -f "$CANON" ]; then
  echo "PROBE BROKEN: no canonical env file found"
  exit 3
fi

K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
KLEN=`printf %s "$K" | wc -c`

echo "control: canon=$CANON key_len=$KLEN"
if [ "$KLEN" -lt 16 ]; then
  echo "PROBE BROKEN: NSP key not resolved — results below would be meaningless"
  exit 3
fi

API=http://localhost:5000

probe() {
  LABEL="$1"
  BODY="$2"
  echo ""
  echo "=================================================================="
  echo "CASE: $LABEL"
  echo "=================================================================="
  curl -sS -m 240 -o /tmp/nspr -w "http=%{http_code} time=%{time_total}s\n" \
    -X POST \
    -H "X-API-Key: $K" \
    -H "Content-Type: application/json" \
    -H "X-NYV-Consent: granted" \
    -d "$BODY" \
    "$API/api/jrx/orchestrate" 2>&1
  echo "bytes=`wc -c < /tmp/nspr`"
  echo "--- body (first 700) ---"
  head -c 700 /tmp/nspr
  echo ""
}

probe "BNS mapping (reported regression)" \
  '{"prompt":"Which BNS section replaces IPC 302 for murder?","taskType":"legal_research","jurisdiction":"IN"}'

probe "BNSS mapping" \
  '{"prompt":"Which BNSS section corresponds to CrPC 438 anticipatory bail?","taskType":"legal_research","jurisdiction":"IN"}'

probe "drafting (long output path)" \
  '{"prompt":"Draft a legal notice for recovery of unpaid invoice dues of INR 5 lakh.","taskType":"drafting","jurisdiction":"IN"}'

echo ""
echo "=================================================================="
echo "GATEWAY ERRORS DURING THESE REQUESTS"
echo "=================================================================="
docker logs --since 5m nyv-gateway 2>&1 | grep -iE '"level":"error"' | tail -20
