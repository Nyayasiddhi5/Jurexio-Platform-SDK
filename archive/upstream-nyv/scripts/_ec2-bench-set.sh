#!/usr/bin/env bash
# NV-BENCH-SET-001 — the frozen benchmark that turns "70 %" into a measurement.
#
# SUPERSEDED (2026-08-16) by `scripts/jrx-benchmark-cost.mjs` + the frozen set at
# `docs/audit/eval/jrx-cost-benchmark-set.v1.json`. NV-NO-DUPLICATE-001: the prompt
# set below is an inline second copy, and this script measures NYV only — it has
# no direct-LLM baseline, no cost in USD, no traffic weighting, and therefore
# cannot produce the blended figure §2.6 actually asks for. Keep using it for a
# fast eyeball on fan-out; use the driver for anything that will be quoted.
#
# Plan §2.6. Every % in §2.1 is a MODEL, not a result, and two of this plan's own
# numbers were already wrong when checked against reality (the "6-8 Queen
# completions" did not reproduce; per-request cost was understated because it was
# read from the envelope NV-METER-ENVELOPE-001 had been under-reporting). So this
# script deliberately does NOT trust our own accounting for the headline figure:
#
#   ground truth  = billed completions counted from PROVIDER log lines
#   cross-check   = what the envelope claims in cost.completions
#
# A disagreement between those two is itself a finding and is printed, not hidden.
#
# 8 prompts covering the real traffic mix, including the cases that are supposed to
# cost NOTHING (1-3) and the adversarial case that must NOT take a cheap path (8).
# Do not tune the prompts to improve the result — that is how a benchmark becomes
# marketing.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
RUNS="${RUNS:-1}"

# --- the frozen set: id | label | extra JSON fields | prompt --------------------
read -r -d '' SET <<'EOF'
1|determ-map||What is the corresponding BNS section for IPC 302?
2|determ-faq||What does BNS section 103 say?
3|cache-repeat||Tell me the text of section 103 of the BNS.
4|simple-advisory||What are the grounds for anticipatory bail under BNSS 482?
5|multi-issue||Advise on anticipatory bail under BNSS 482 where there is also PMLA section 5 attachment exposure, and flag any limitation risk.
6|swarm|"orchestrationMode":"swarm"|Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.
7|long-context|"complexity":"very_complex"|Review the following factual matrix and advise on maintainability, forum and interim relief. The accused is a director of a listed company; a FIR under BNS 318 was registered in Mumbai; an ED summons under PMLA followed; SEBI issued a show-cause notice on the same transactions; a civil suit for recovery is pending in Delhi; the transactions span 2019 to 2024 and were disclosed in audited financials. Address each proceeding separately and then the interaction between them.
8|adversarial-scope||Devise the sequencing strategy and limitation exposure for a BNSS 482 application.
EOF

printf '%-18s %-6s %8s %7s %7s %8s %9s %s\n' PROMPT HTTP WALL_S BILLED ENV_C TOK_IN TOK_OUT MODELS
echo "--------------------------------------------------------------------------------------------"

for run in $(seq 1 "$RUNS"); do
  while IFS='|' read -r ID LABEL EXTRA PROMPT; do
    [ -z "${ID:-}" ] && continue
    # Build the body with python so the prompt is JSON-escaped correctly rather
    # than by hand — an unescaped quote here would silently change the prompt.
    BODY=$(EXTRA="$EXTRA" PROMPT="$PROMPT" python3 -c "
import json,os
b={'prompt':os.environ['PROMPT'],'jurisdiction':'IN'}
e=os.environ.get('EXTRA','').strip()
if e: b.update(json.loads('{'+e+'}'))
print(json.dumps(b))")

    BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
    T0=$(date +%s.%N)
    HTTP=$(curl -sS -m 900 -o /tmp/bench.json -w '%{http_code}' \
      -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
      -H 'X-NYV-Consent: granted' -d "$BODY" "${API}/api/jrx/orchestrate")
    T1=$(date +%s.%N)
    sleep 5
    docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/bench.log

    # Ground truth from provider lines; envelope read separately so the two can
    # be compared rather than conflated.
    grep -E 'hedge success|attempt success|stream success' /tmp/bench.log > /tmp/bench.calls || true
    LABEL="$LABEL" HTTP="$HTTP" W0="$T0" W1="$T1" python3 -c "
import json,os,sys
from collections import Counter
n=0; models=Counter(); est=0
for l in open('/tmp/bench.calls'):
    try: r=json.loads(l)
    except Exception: continue
    n+=1; models[str(r.get('model'))]+=1
    if r.get('usageSource') not in ('provider',): est+=1
try: env=json.load(open('/tmp/bench.json'))
except Exception: env={}
cost=(env.get('cost') or {}) if isinstance(env,dict) else {}
tok=cost.get('tokens') or {}
envc=cost.get('completions')
wasted=(cost.get('wasted') or {}).get('completions')
ms=', '.join(f'{c}x{m}' for m,c in models.most_common()) or '-'
print('%-18s %-6s %8.2f %7s %7s %8s %9s %s' % (
    os.environ['LABEL'], os.environ['HTTP'],
    float(os.environ['W1'])-float(os.environ['W0']),
    n, envc if envc is not None else '-',
    tok.get('prompt','-'), tok.get('completion','-'), ms))
notes=[]
if envc is not None and envc!=n: notes.append(f'ENVELOPE MISMATCH: log={n} envelope={envc}')
if est: notes.append(f'{est}/{n} calls still usageSource!=provider')
if wasted: notes.append(f'wasted completions={wasted}')
lay=(env.get('metadata') or {}).get('layers') if isinstance(env,dict) else None
if lay: notes.append('layers='+','.join(map(str,lay)))
for x in notes: print('                   -> '+x)
"
  done <<< "$SET"
done

echo
echo "=== interpretation ==="
echo "  prompts 1-3 MUST show billed=0. Any completion there is a deterministic-tier miss."
echo "  prompt 6: compare WALL_S against the SUM of per-call latencies below - if wall ~= sum,"
echo "            the swarm is still serial (NV-QUEEN-COLLECTIVE-PARALLEL-001 regressed)."
echo "  prompt 8 MUST NOT return a short statute excerpt (NV-STATUTE-FAQ-SCOPE-001)."
echo "  ENVELOPE MISMATCH anywhere means metering regressed - fix before quoting any %."
echo
echo "=== per-call latency spread on the last request (serial vs parallel check) ==="
grep -E 'hedge success|attempt success|stream success' /tmp/bench.log | python3 -c "
import sys,json
lat=[]
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    for k in ('latencyMs','durationMs','elapsedMs','ms'):
        if isinstance(r.get(k),(int,float)): lat.append(r[k]); break
if lat:
    print(f'   n={len(lat)} sum={sum(lat)}ms individual={sorted(lat)}')
    print('   if wall-clock ~= sum -> still serial; if wall ~= max -> parallel')
else:
    print('   no latency field found on provider lines')
"
