#!/usr/bin/env bash
# NV-PHASE4A-VERIFY-001 — verify the five fixes shipped in 2026-08-15T1422Z-aws-ssm.
#
# 1. NV-STATUTE-FAQ-SCOPE-001  — multi-issue strategy answer no longer replaced
#                                by a single-section excerpt.
# 2. NV-RAG-CONF-001           — confidence clears 0.55 so re-retrieval stops
#                                firing on 100% of requests.
# 3. NV-LLM-HEDGE-CANCEL-001   — losing hedge branch is cancelled.
# 4. NV-HALLUCHECK-GUARD-001   — no more "reading 'match'" TypeError.
# 5. NV-QUEEN-CAPERR-CLASSIFY-001 — crashes degrade instead of killing an agent.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
echo "deploy=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo unknown)"

STRATEGY='Devise a litigation strategy for a multi-jurisdiction economic offence: anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings. Sequence the remedies and flag limitation risks.'

probe () {
  local label="$1"; local body="$2"
  local BEFORE; BEFORE=$(docker logs --tail 300000 "$GID" 2>&1 | wc -l)
  local W; W=$(curl -sS -m 600 -o /tmp/v.json -w '%{time_total}' \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$body" "${API}/api/jrx/orchestrate" 2>/dev/null)
  sleep 5
  docker logs --tail 300000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/v.log
  echo "=================== ${label} ==================="
  echo "wall=${W}s   billed_completions=$(grep -c 'hedge success' /tmp/v.log)"
  echo "hedge_loser_cancelled=$(grep -c 'hedge loser cancelled' /tmp/v.log)"
  echo "-- FIX 1: statute scope --"
  echo "   strict_faq_rewrites=$(grep -c 'statute_qa_conflict_corrected' /tmp/v.log)"
  echo "   multi_issue_preserved=$(grep -c 'statute_qa_conflict_annotated' /tmp/v.log)"
  echo "-- FIX 2: RAG confidence / re-retrieval --"
  grep 'auto-rag re-retrieval pass' /tmp/v.log | python3 -c "
import sys,json
n=0
for l in sys.stdin:
    n+=1
    try: r=json.loads(l)
    except Exception: continue
    print(f\"   re-retrieval fired: before={r.get('beforeConf')} after={r.get('afterConf')}\")
if n==0: print('   re-retrieval did NOT fire (target state)')
"
  echo "-- FIX 4/5: crash + misclassification --"
  echo "   reading_match_TypeError=$(grep -c \"reading 'match'\" /tmp/v.log)"
  echo "   refusing_legacy_fallback=$(grep -c 'refusing legacy fallback' /tmp/v.log)"
  echo "   agent_failed=$(grep -c 'Agent .* failed' /tmp/v.log)"
  echo "   swarm_node_failed=$(grep -c 'swarm node failed' /tmp/v.log)"
  echo "   degraded_as_defect=$(grep -c 'crashed (defect, not a policy verdict)' /tmp/v.log)"
  echo "-- response --"
  python3 - <<'PY'
import json
try: d=json.load(open('/tmp/v.json'))
except Exception as e: print('   parse fail',e); raise SystemExit
n=d.get('data') if isinstance(d.get('data'),dict) else d
c=str(n.get('content') or '')
tk=n.get('tokens') or {}
print(f"   model={n.get('model')} metered_out={tk.get('completion')}")
print(f"   layers={n.get('layersUsed')}")
print(f"   answer_chars={len(c)}")
low=c.lower()
# The defect signature: a 732-char BNSS-482-only excerpt with no PMLA/SEBI.
print(f"   mentions PMLA={'pmla' in low}  SEBI={'sebi' in low}  limitation={'limitation' in low}")
print(f"   head={c[:140]!r}")
PY
  echo
}

probe "A: multi-issue strategy, forced Queen (swarm)" \
  "{\"prompt\":\"${STRATEGY}\",\"jurisdiction\":\"IN\",\"orchestrationMode\":\"swarm\"}"

probe "B: genuine single-section FAQ (must still be grounded)" \
  '{"prompt":"What does BNSS 482 say?","jurisdiction":"IN"}'

probe "C: Phase 0 mapping fast path (must stay zero-LLM)" \
  '{"prompt":"What BNS section replaced IPC 302?","jurisdiction":"IN"}'
