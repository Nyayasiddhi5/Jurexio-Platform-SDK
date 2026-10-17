#!/bin/sh
# NV-DRAFT-FAST-COT-001 — measure what a `-fast` draft actually costs on nysdev.
#
# The reported symptom is a client-side "Draft generation timed out". If the
# `-fast` SLA is being discarded (probe says it is), the request should take
# multi-minute Queen time rather than the ~15-45s grounded-fast budget NSP asked
# for. That latency, not an envelope rejection, would be the real cause.

CANON=/opt/Nyayavigya/secrets/.env.production
if [ ! -f "$CANON" ]; then echo "PROBE BROKEN: no canon"; exit 3; fi
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
KLEN=`printf %s "$K" | wc -c`
echo "control: key_len=$KLEN"
if [ "$KLEN" -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

N=`date +%s`
run() {
  LABEL="$1"; TT="$2"
  echo ""
  echo "--- $LABEL (taskType=$TT) ---"
  curl -sS -m 400 -o /tmp/df_out -w "http=%{http_code} time=%{time_total}s\n" \
    -X POST -H "X-API-Key: $K" -H "Content-Type: application/json" \
    -H "X-NYV-Consent: granted" -H "X-NYV-Platform: NSP" \
    -d "{\"prompt\":\"Draft a Written Statement in a civil suit for recovery of money. Ref $N-$TT\",\"taskType\":\"$TT\",\"jurisdiction\":\"IN\"}" \
    http://localhost:5000/api/jrx/orchestrate 2>&1
  echo "bytes=`wc -c < /tmp/df_out`"
  # Which path served it, and did the envelope complain?
  head -c 300 /tmp/df_out
  echo ""
  grep -o '"path":"[a-z-]*"' /tmp/df_out | head -3
  grep -o 'QUALITY-ENVELOPE[^"]*' /tmp/df_out | head -2
  grep -o '"missingMandatory":\[[^]]*\]' /tmp/df_out | head -2
}

run "fast draft (what NSP asks for)" "legal-draft-fast"

echo ""
echo "=== router decision for that request ==="
docker logs --since 8m nyv-gateway 2>&1 | grep -iE "adaptive|path=|Queen:|specialist" | tail -12
