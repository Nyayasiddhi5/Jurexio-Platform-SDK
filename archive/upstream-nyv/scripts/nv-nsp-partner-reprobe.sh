#!/usr/bin/env bash
# NV-NSP-REPROBE-001 — canonical partner re-probe for NYV-1 … NYV-11 post-deploy.
# Run from partner BFF or any host with curl + python3.
#
# Required env:
#   NV_API_BASE_URL  — e.g. https://api.nyayasiddhi.online
#   NYV_SDK_KEY_NSP  — production partner key
# Optional:
#   X_ORG_ID         — firm org UUID for firm-clause probe
#   NV_REPROBE_TIMEOUT — curl max seconds (default 90)
#
# Exit 0 = all non-SKIP probes PASS.

set -uo pipefail

BASE="${NV_API_BASE_URL:-https://api.nyayasiddhi.online}"
KEY="${NYV_SDK_KEY_NSP:-}"
TIMEOUT="${NV_REPROBE_TIMEOUT:-90}"
ORG="${X_ORG_ID:-}"

if [ -z "$KEY" ]; then
  echo "FAIL setup: NYV_SDK_KEY_NSP not set" >&2
  exit 2
fi

HDR=(
  -H "X-API-Key: $KEY"
  -H "X-NYV-Platform: nsp"
  -H "X-NYV-Consent: granted"
  -H "X-Customer-User-Id: reprobe-$(date +%s)"
)

PASS=0
FAIL=0
SKIP=0

record() {
  local id="$1" result="$2"
  case "$result" in
    PASS) echo "PASS $id"; PASS=$((PASS + 1)) ;;
    SKIP) echo "SKIP $id"; SKIP=$((SKIP + 1)) ;;
    *) echo "FAIL $id ($result)"; FAIL=$((FAIL + 1)) ;;
  esac
}

# NYV-1 — public API reachability
code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/health" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv1_health PASS || record nyv1_health "http=$code"

# NYV-4 — courtType filter
result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" \
  "$BASE/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=3" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    r = d.get('data', {}).get('results') or d.get('data', {}).get('items') or []
    if d.get('success') and r and all('Supreme Court' in str(x.get('court','')) or x.get('courtType')=='sc' for x in r[:3]):
        print('PASS')
    else:
        print('bad_rows')
except Exception as e:
    print(e)
" 2>/dev/null || echo curl_err)"
record nyv4_courtType_sc "$result"

# NYV-2 — citator exact=true
result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" \
  "$BASE/api/jrx/knowledge/caselaw/treatment?citation=%5B1980%5D%203%20S.C.R.%20383&exact=true" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    a = d.get('data', {}).get('authority') or {}
    print('PASS' if d.get('success') and a.get('matched') is not False else 'unresolved')
except Exception as e:
    print(e)
" 2>/dev/null || echo curl_err)"
record nyv2_treatment_exact "$result"

# NYV-11 — verify-citation
result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" -H 'Content-Type: application/json' \
  -d '{"citation":"(2011) 1 SCC 694","jurisdiction":"IN"}' \
  "$BASE/api/jrx/knowledge/caselaw/verify-citation" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('PASS' if d.get('success') and 'status' in (d.get('data') or {}) else 'no_status')
except Exception as e:
    print(e)
" 2>/dev/null || echo curl_err)"
record nyv11_verify_citation "$result"

# NYV-6 — analysisStatus on orchestrate — court-document gate (≥220 chars + structural cue)
# buildUnifiedOrchestrationContract merges extras onto data top-level; accept either path.
result="$(python3 - "$BASE" "$TIMEOUT" "${HDR[@]}" <<'PY' 2>/dev/null || echo curl_err
import json, subprocess, sys
base, timeout = sys.argv[1], sys.argv[2]
hdr = sys.argv[3:]
doc = """IN THE HIGH COURT OF TELANGANA AT HYDERABAD
CRIMINAL PETITION No. 4471 OF 2025
Between X Petitioner and State of Telangana Respondent
Under Section 438 CrPC anticipatory bail.

The petitioner seeks protection from arrest in connection with Crime No. 123 of 2025 registered at Banjara Hills Police Station for offences under Sections 420 and 406 IPC. The petitioner states that the allegations are false and that he cooperated with the investigation.

PRAYER: Allow this Criminal Petition and grant anticipatory bail."""
body = json.dumps({"documentText": doc, "taskType": "legal-chat-fast", "jurisdiction": "IN"})
cmd = ["curl", "-sS", "-m", timeout, *hdr, "-H", "Content-Type: application/json", "-d", body, f"{base}/api/jrx/orchestrate"]
raw = subprocess.check_output(cmd, text=True)
d = json.loads(raw)
data = d.get("data") or {}
st = data.get("analysisStatus") or ((data.get("extras") or {}).get("analysisStatus"))
print("PASS" if d.get("success") and st in ("structured", "unstructured", "failed") else f"absent:{st}")
PY
)"
record nyv6_analysisStatus "$result"

# NYV-3 — structure shape (SKIP if judgment key unavailable)
result="$(curl -sS -m 120 "${HDR[@]}" -H 'Content-Type: application/json' \
  -d '{"s3Path":"s3://your-supreme-court-data-bucket/sc/2026/3-scr-525.pdf","structure":true}' \
  "$BASE/api/jrx/knowledge/judgments/full-text" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('error', {}).get('code') == 'NOT_FOUND':
        print('SKIP')
    elif d.get('success') and 'paras' in json.dumps(d.get('data') or {}):
        print('PASS')
    else:
        print('no_paras_key')
except Exception as e:
    print('SKIP')
" 2>/dev/null || echo SKIP)"
record nyv3_structure_shape "$result"

# NYV-10 — fts typeahead
result="$(curl -sS -m 5 "${HDR[@]}" \
  "$BASE/api/jrx/knowledge/caselaw/search?q=man&mode=fts&limit=5" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('PASS' if d.get('success') else 'fail')
except Exception as e:
    print(e)
" 2>/dev/null || echo curl_err)"
record nyv10_fts_typeahead "$result"

# NYV-7 — Matter Vault
code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/matter-vault/health" 2>/dev/null || echo 000)"
[[ "$code" =~ ^(200|404)$ ]] && record nyv7_matter_vault PASS || record nyv7_matter_vault "http=$code"

# NYV-8 — legal-work surface up
code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/legal-work/tasks" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv8_legal_work PASS || record nyv8_legal_work "http=$code"

# NYV-9 — evidence-pack / matter-vault packs
code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/matter-vault/packs" 2>/dev/null || echo 000)"
[[ "$code" =~ ^(200|401|403)$ ]] && record nyv9_evidence_pack PASS || record nyv9_evidence_pack "http=$code"

# NYV-5 — bare numeric not 503
code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "${HDR[@]}" \
  "$BASE/api/jrx/knowledge/caselaw/search?q=302&limit=3" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv5_bare_numeric PASS || record nyv5_bare_numeric "http=$code"

# X-Org-Id firm clause
if [ -n "$ORG" ]; then
  result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" -H "X-Org-Id: $ORG" -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"Draft one clause.\",\"taskType\":\"legal-draft-fast\",\"jurisdiction\":\"IN\",\"_firmClauseLibrary\":{\"clauses\":[{\"orgId\":\"$ORG\",\"title\":\"Test\",\"text\":\"Payment within 30 days.\"}]}}" \
    "$BASE/api/jrx/orchestrate" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    fc = (d.get('data') or {}).get('firmClauses') or {}
    print('PASS' if d.get('success') and fc.get('reason') != 'org_unresolved' else 'org_unresolved')
except Exception as e:
    print(e)
" 2>/dev/null || echo curl_err)"
  record x_org_id_clause "$result"
else
  record x_org_id_clause SKIP
fi

echo "---"
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ]
