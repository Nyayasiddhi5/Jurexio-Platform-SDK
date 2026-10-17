#!/usr/bin/env bash
# NV-QUEEN-MULTIPLIER-001 — count provider completions on the QUEEN path.
# Instrument: each provider completion emits exactly one "hedge success" line
# (hedge fires on every call), so counting those lines counts completions.
# Baseline already measured: specialist path = 1 completion.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

probe () {
  local label="$1"; local body="$2"
  local BEFORE; BEFORE=$(docker logs --tail 200000 "$GID" 2>&1 | wc -l)
  local W; W=$(curl -sS -m 300 -o /tmp/q.json -w '%{time_total}' \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$body" "${API}/api/jrx/orchestrate" 2>/dev/null)
  sleep 4
  docker logs --tail 200000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/q.log
  local N; N=$(grep -c 'hedge success' /tmp/q.log)
  echo "--- ${label} ---"
  echo "wall=${W}s   provider_completions=${N}"
  grep 'hedge success' /tmp/q.log | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception: continue
    print(f\"    model={r.get('model')} latencyMs={r.get('latencyMs')}\")
"
  python3 - <<'PY'
import json
try: d=json.load(open('/tmp/q.json'))
except Exception as e: print('    parse fail',e); raise SystemExit
n=d.get('data') if isinstance(d.get('data'),dict) else d
tk=n.get('tokens') or {}
print(f"    metered_tokens: in={tk.get('prompt')} out={tk.get('completion')}")
print(f"    layers={n.get('layersUsed')} cot={bool(n.get('chainOfThought'))} mc={n.get('makerCheckerVerdict')}")
print(f"    agents={n.get('agentsUsed') or n.get('agents')}")
PY
  echo
}

probe "A: plain (specialist baseline)" \
  '{"prompt":"Explain the anticipatory bail standard under BNSS 482 for economic offences.","jurisdiction":"IN"}'

probe "B: complexity=very_complex + CoT requested" \
  '{"prompt":"Build a litigation strategy for a multi-jurisdiction economic offence matter: anticipatory bail under BNSS 482, PMLA attachment risk, and parallel SEBI proceedings. Compare remedies and sequence them.","jurisdiction":"IN","complexity":"very_complex","enableCoT":true}'

probe "C: forceLegalBestOutcome (forces CoT + maker-checker)" \
  '{"prompt":"Build a litigation strategy for a multi-jurisdiction economic offence matter: anticipatory bail under BNSS 482, PMLA attachment risk, and parallel SEBI proceedings.","jurisdiction":"IN","forceLegalBestOutcome":true}'

echo "=== interpretation ==="
echo "metered_tokens reports ONE completion. provider_completions is what we PAY for."
