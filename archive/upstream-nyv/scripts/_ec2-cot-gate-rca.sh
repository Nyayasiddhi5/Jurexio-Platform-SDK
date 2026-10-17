#!/usr/bin/env bash
# NV-QUEEN-COT-GATE RCA — the swarm 500 is "mandatory steps missing: cot".
#
# Hypotheses, in order of severity:
#   H1 `maybeRunQueenCoT` returns false for the lean partner path
#      (`metadata.partnerSyncLean === true` → early return) while the adaptive
#      router set `requireCoT: true`. Structural contradiction: one layer skips
#      the step the next layer mandates.
#   H2 CoT capture THREW and was swallowed as "non-fatal", leaving the flag false —
#      non-fatal for the Queen, fatal for the envelope.
#   H3 The answer sometimes carries `data.chainOfThought`, which also satisfies the
#      gate — which would explain why this is INTERMITTENT rather than constant.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

echo "=== historical frequency: how often has this gate killed a finished answer? ==="
docker logs --tail 400000 "$GID" 2>&1 | grep -c 'mandatory steps missing' | sed 's/^/   envelope failures = /'
docker logs --tail 400000 "$GID" 2>&1 | grep -oE 'mandatory steps missing: [a-z_, ]+' | sort | uniq -c | sort -rn | head | sed 's/^/   /'

echo
echo "=== H2: did CoT capture throw? ==="
docker logs --tail 400000 "$GID" 2>&1 | grep -c 'CoT capture failed' | sed 's/^/   CoT capture failures = /'
docker logs --tail 400000 "$GID" 2>&1 | grep 'CoT capture failed' | tail -3 | sed 's/^/   /' | cut -c1-260

echo
echo "=== H1/H3: run the swarm 3x and correlate gate outcome with lean/cot flags ==="
STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'
for RUN in 1 2 3; do
  BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
  T0=$(date +%s.%N)
  H=$(curl -sS -m 700 -o /tmp/g$RUN.json -w '%{http_code}' \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
    "${API}/api/jrx/orchestrate")
  T1=$(date +%s.%N)
  sleep 4
  docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/g$RUN.log
  COT=$(grep -c 'CoT capture failed' /tmp/g$RUN.log || true)
  LEAN=$(grep -oE '"partnerSyncLean":(true|false)' /tmp/g$RUN.log | head -1)
  GATE=$(grep -oE 'mandatory steps missing: [a-z_, ]+' /tmp/g$RUN.log | head -1)
  CHARS=$(python3 -c "
import json
try:
    d=json.load(open('/tmp/g$RUN.json'))
    data = d.get('data') if isinstance(d.get('data'), dict) else d
    c=(data or {}).get('content') or ''
    print(len(c))
except Exception: print(0)
")
  python3 -c "print(f'   run $RUN: http=${H} wall={${T1}-${T0}:5.1f}s chars=${CHARS} cotFail=${COT} ${LEAN:-lean=?} gate=\"${GATE:-ok}\"')"
done

echo
echo "=== was a full answer produced and then THROWN AWAY? ==="
grep -iE 'synthes.*(complete|success)|orchestrate.complete' /tmp/g1.log /tmp/g2.log /tmp/g3.log 2>/dev/null \
  | tail -6 | sed 's/^/   /' | cut -c1-200

echo
echo "=== how much did each discarded request cost? (billed completions) ==="
for RUN in 1 2 3; do
  N=$(grep -cE 'hedge success|attempt success|stream success' /tmp/g$RUN.log || echo 0)
  echo "   run $RUN billed completions = $N"
done
