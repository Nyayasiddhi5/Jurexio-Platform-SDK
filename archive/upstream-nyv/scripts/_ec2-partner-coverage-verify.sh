#!/usr/bin/env bash
# NV-PARTNER-COVERAGE-001 — does every partner request get a real answer?
#
# "100% response" is only meaningful if it means a SUBSTANTIVE answer. An HTTP
# 200 carrying an empty body, an abstain, or a placeholder is a failure wearing
# a success code, so each case below asserts on answer content, not status.
#
# Exercises both partner surfaces (NSP and NYM) across the tiers that route
# differently: deterministic (zero-LLM), specialist, and Queen (multi-agent).
set -uo pipefail
CANON="${NVB_CANON:-/opt/Nyayavigya/secrets/.env.production}"
API=http://localhost:5000

key() { grep -E "^$1=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NSPK=$(key NYV_SDK_KEY_NSP)
NYMK=$(key NYV_SDK_KEY_NYM)
[ -n "$NSPK" ] || echo "WARN: NSP key not resolved"
[ -n "$NYMK" ] || echo "WARN: NYM key not resolved"

PASS=0; FAIL=0

probe() {
  local label="$1" apikey="$2" prompt="$3" task="$4"
  if [ -z "$apikey" ]; then
    echo "SKIP  $label — no key"; return
  fi
  local body http
  body=$(python3 -c "
import json,sys
print(json.dumps({'prompt':sys.argv[1],'taskType':sys.argv[2],'jurisdiction':'IN'}))
" "$prompt" "$task")
  local t0 t1
  t0=$(date +%s)
  http=$(curl -sS -m 300 -o /tmp/pc.json -w '%{http_code}' \
    -X POST -H "X-API-Key: ${apikey}" -H 'Content-Type: application/json' \
    -H 'X-NYV-Consent: granted' -d "$body" "${API}/api/jrx/orchestrate" 2>/dev/null || echo 000)
  t1=$(date +%s)

  python3 - "$label" "$http" "$((t1-t0))" <<'PY'
import json, sys
label, http, secs = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open('/tmp/pc.json'))
except Exception as e:
    print(f"FAIL  {label} http={http} {secs}s — unparseable body ({e})"); sys.exit(9)
inner = d.get('data') if isinstance(d.get('data'), dict) else d
ans = inner.get('content') or inner.get('answer') or inner.get('response') or ''
if isinstance(ans, dict):
    ans = ans.get('content') or ans.get('text') or ''
ans = str(ans).strip()
rid = inner.get('requestId') or ''
model = inner.get('model') or (inner.get('metadata') or {}).get('model') or '?'
low = ans.lower()
# An abstain or placeholder is not an answer, regardless of status code.
bad = any(s in low for s in (
    'i cannot assist', 'unable to process', 'no answer available',
    'placeholder', 'lorem ipsum', 'service unavailable'))
ok = http == '200' and len(ans) >= 200 and not bad
verdict = 'PASS ' if ok else 'FAIL '
why = ''
if http != '200': why = f'http={http}'
elif len(ans) < 200: why = f'answer too thin ({len(ans)} chars)'
elif bad: why = 'abstain/placeholder text'
print(f"{verdict} {label} http={http} {secs}s chars={len(ans)} model={model} rid={rid[:8]} {why}")
sys.exit(0 if ok else 9)
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

echo "── NSP (nys-professional) ──"
probe "NSP deterministic " "$NSPK" 'What does BNS section 103 say?' 'legal_query'
probe "NSP mapping       " "$NSPK" 'What is the BNS equivalent of IPC 302?' 'legal_query'
probe "NSP specialist    " "$NSPK" 'What are the grounds for anticipatory bail under BNSS 482?' 'legal_advice'
probe "NSP research      " "$NSPK" 'Summarise the leading Supreme Court authorities on anticipatory bail and how the position changed after the BNSS.' 'legal_research'

echo "── NYM (nyayamitra) ──"
probe "NYM deterministic " "$NYMK" 'What does BNS section 103 say?' 'legal_query'
probe "NYM specialist    " "$NYMK" 'What are the grounds for anticipatory bail under BNSS 482?' 'legal_advice'
probe "NYM drafting      " "$NYMK" 'Draft a short anticipatory bail application under BNSS 482 for a first-time accused in an economic offence.' 'drafting'

echo
echo "coverage: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo "VERDICT: every partner surface returned a substantive answer." \
  || echo "VERDICT: $FAIL partner case(s) did NOT return a usable answer — not 100%."
