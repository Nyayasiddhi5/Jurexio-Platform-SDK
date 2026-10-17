#!/usr/bin/env bash
# Re-test the NBFC complex case that previously 504'd at 300s edge timeout.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
BASE="https://api.nyayasiddhi.online"

set -a
source <(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | sed 's/^/export /')
set +a

BODY='{"prompt":"A fintech NBFC is launching cross-border remittance with KYC under PMLA, RBI master directions, and DPDP Act consent flows. Draft a compliance checklist covering licensing, data localization, grievance redressal, and agent liability for AI-assisted customer onboarding.","jurisdiction":"IN","taskType":"analysis","enableRAG":true}'

echo "NSP key: present (${#NYV_SDK_KEY_NSP} chars)"
echo "POST /api/jrx/orchestrate (client max 480s) ..."
T0=$(date +%s)
CODE=$(curl -sS -o /tmp/nsp-nbfc-retest.json -w '%{http_code}' --max-time 480 \
  -X POST "$BASE/api/jrx/orchestrate" \
  -H "X-API-Key: ${NYV_SDK_KEY_NSP}" \
  -H 'Content-Type: application/json' \
  -d "$BODY")
T1=$(date +%s)
EL=$((T1 - T0))

python3 <<PY
import json
code = "$CODE"
elapsed = $EL
try:
    j = json.load(open("/tmp/nsp-nbfc-retest.json"))
except Exception:
    j = {"raw": open("/tmp/nsp-nbfc-retest.json").read()[:500]}
data = j.get("data") or j
content = data.get("content") or j.get("content") or ""
if isinstance(content, dict):
    content = content.get("text") or str(content)
print(f"HTTP {code} elapsed={elapsed}s")
print(f"autoOrch={data.get('autoOrchestrated')} pattern={data.get('orchestrationPattern')} agents={data.get('agentsUsed')} len={len(str(content))}")
print(f"preview={str(content)[:240].replace(chr(10),' ')}")
print("PASS" if code == "200" and len(str(content)) > 200 else "FAIL")
PY
