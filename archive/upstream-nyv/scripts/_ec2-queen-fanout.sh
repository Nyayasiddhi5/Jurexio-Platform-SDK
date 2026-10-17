#!/usr/bin/env bash
# NV-QUEEN-FANOUT-001 — force the Queen path and measure REAL fan-out.
#
# Why the earlier probe failed to reach the Queen:
#   nv-orchestration-routes.ts:306-314 does NOT destructure `complexity` from the
#   body — it comes from a server-side complexityAssessment (:392). So passing
#   {"complexity":"very_complex"} was silently ignored.
#   The real lever is `orchestrationMode` (:313) -> engageQueenForced (:342)
#   -> decideAdaptivePath rule 2 (nv-adaptive-router.ts:176) -> path='queen'.
#
# Instruments:
#   - authoritative path from '[NV-Orchestrate] AdaptiveRouter decision' (:474)
#   - billed completions = count of 'hedge success' (hedge fires on every call)
#   - Queen internals: leaf spawns, synthesis, maker-checker, CoT
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$GID" ] && { echo "gateway not found"; exit 0; }

PROMPT='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Compare remedies, sequence them, and flag limitation risks.'

probe () {
  local label="$1"; local body="$2"
  local BEFORE; BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
  local W; W=$(curl -sS -m 600 -o /tmp/qf.json -w '%{time_total}' \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$body" "${API}/api/jrx/orchestrate" 2>/dev/null)
  sleep 5
  docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/qf.log

  echo "================ ${label} ================"
  echo "wall=${W}s"
  echo "-- adaptive router decision --"
  grep 'AdaptiveRouter decision' /tmp/qf.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   path={r.get('path')}  reason={r.get('reason')}\")
"
  local N; N=$(grep -c 'hedge success' /tmp/qf.log)
  echo "-- billed completions = ${N} --"
  grep 'hedge success' /tmp/qf.log | python3 -c "
import sys,json
for i,l in enumerate(sys.stdin,1):
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   [{i}] model={r.get('model')} latencyMs={r.get('latencyMs')}\")
"
  echo "-- queen internals --"
  for p in 'Queen' 'leaf' 'subtask' 'synthesis' 'maker' 'checker' 'swarm' 'decompos' 'chain-of-thought' 'chainOfThought'; do
    c=$(grep -ci "$p" /tmp/qf.log)
    [ "$c" != "0" ] && printf '   %-18s %s\n' "$p" "$c"
  done
  echo "-- response envelope --"
  python3 - <<'PY'
import json
try: d=json.load(open('/tmp/qf.json'))
except Exception as e: print('   parse fail',e); raise SystemExit
n=d.get('data') if isinstance(d.get('data'),dict) else d
tk=n.get('tokens') or {}
print(f"   model={n.get('model')}")
print(f"   metered in={tk.get('prompt')} out={tk.get('completion')}")
print(f"   layers={n.get('layersUsed')}")
print(f"   cot={bool(n.get('chainOfThought'))} mc={n.get('makerCheckerVerdict')}")
for k in ('agentsUsed','agents','orchestration','queen','subAgents','agentResults'):
    v=n.get(k)
    if v: print(f"   {k}={str(v)[:200]}")
print(f"   answer_chars={len(str(n.get('response') or n.get('output') or ''))}")
PY
  echo
}

probe "BASELINE: no orchestrationMode" \
  "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\"}"

probe "QUEEN FORCED: orchestrationMode=parallel" \
  "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"parallel\"}"

probe "QUEEN FORCED: orchestrationMode=swarm" \
  "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}"

probe "QUEEN FORCED: orchestrationMode=hierarchical" \
  "{\"prompt\":\"${PROMPT}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"hierarchical\"}"

echo "=== sdkAutoOrch flag (gates engageQueen at :429) ==="
grep -iE 'NYV_F_SDK_AUTO_ORCH|sdkAutoOrch' "$CANON" | sed 's/=.*/=<set>/' || echo "not pinned in env (default applies)"
