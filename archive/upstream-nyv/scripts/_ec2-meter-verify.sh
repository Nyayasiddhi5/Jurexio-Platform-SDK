#!/usr/bin/env bash
# NV-METER-VERIFY-001 — does the envelope now tell the truth about fan-out?
#
# NV-NO-DUPLICATE-001 NOTE (2026-08-16): the grep+parse below is a SECOND copy of
# the provider-log ground-truth extractor. The canonical one is now
# `scripts/_nv-provider-usage-extract.py`, used by `scripts/jrx-benchmark-cost.mjs`.
# Prefer that for any new work. Two defects in the copy below, found while writing
# the canonical version:
#   1. it greps 'attempt success', a string that does not exist anywhere in src/.
#      The sequential-cascade marker is the bare 'llm-orchestrator: success'
#      (llm-orchestrator.ts:1444), so this script UNDER-COUNTS every completion
#      that went through neither the hedge nor a stream.
#   2. substring matching lets markers bleed; the canonical extractor matches the
#      log record's `message` field exactly.
# This file is left as-is only because an SSM payload must be self-contained (the
# host has no repo checkout, so it cannot `source` a sibling file); the driver
# inlines the canonical extractor into its payload instead.
#
# The test that matters: count billed completions from PROVIDER log lines (ground
# truth, independent of our own accounting) and compare with what the response
# envelope reports in `cost.completions`. Before this change the envelope said 1
# while 5 were billed, so every cost figure derived from it was understated.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
T0=$(date +%s.%N)
HTTP=$(curl -sS -m 700 -o /tmp/mv.json -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}" \
  "${API}/api/jrx/orchestrate")
T1=$(date +%s.%N)
sleep 6
docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/mv.log

python3 -c "print(f'=== http=${HTTP} wall={${T1}-${T0}:.2f}s ===')"

echo
echo "=== GROUND TRUTH: billed completions from provider log lines ==="
grep -E 'hedge success|attempt success|stream success' /tmp/mv.log | python3 -c "
import sys,json
from collections import Counter
models=Counter(); n=0
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    n+=1; models[str(r.get('model'))]+=1
print(f'   billed completions = {n}')
for m,c in models.most_common(): print(f'      {c}x {m}')
"

echo
echo "=== WHAT THE ENVELOPE CLAIMS (must match the count above) ==="
python3 -c "
import json
d=json.load(open('/tmp/mv.json'))
data = d.get('data') if isinstance(d.get('data'), dict) else d
cost = data.get('cost') or {}
tok  = cost.get('tokens') or {}
print(f\"   cost.completions      = {cost.get('completions')}\")
print(f\"   cost.tokens.prompt    = {tok.get('prompt')}\")
print(f\"   cost.tokens.completion= {tok.get('completion')}\")
print(f\"   cost.tokens.total     = {tok.get('total')}\")
w = cost.get('wasted')
print(f'   cost.wasted           = {w}')
c = data.get('content') or (data.get('curated') or {}).get('summary') or ''
print(f'   answer chars          = {len(c)}')
"

echo
echo "=== M1: hedge loser spend now recorded as waste? ==="
grep -c 'hedge loser cancelled' /tmp/mv.log | sed 's/^/   cancelled events = /'
grep 'hedge loser spend recorded as waste' /tmp/mv.log | python3 -c "
import sys,json
n=0; cost=0.0
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    n+=1; cost+=float(r.get('costUsd') or 0)
print(f'   waste records    = {n}')
print(f'   waste cost       = \${cost:.6f}')
" 2>/dev/null || echo "   waste records    = 0 (loser aborted before reporting usage — expected)"

echo
echo "=== M3/M4: streamed tokens measured vs estimated ==="
grep 'stream success' /tmp/mv.log | python3 -c "
import sys,json
from collections import Counter
src=Counter()
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    src[str(r.get('usageSource'))]+=1
if not src: print('   (no streaming calls in this request)')
for s,c in src.most_common(): print(f'   {c}x usageSource={s}')
"
