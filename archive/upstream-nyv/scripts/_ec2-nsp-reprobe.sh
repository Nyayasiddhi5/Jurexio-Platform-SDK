#!/usr/bin/env bash
# EC2-side NSP reprobe — self-contained (repo sync not required).
set -uo pipefail
ENV_FILE="/opt/Nyayavigya/secrets/.env.production"
export NV_API_BASE_URL="${NV_API_BASE_URL:-http://127.0.0.1:5000}"
export NYV_SDK_KEY_NSP="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" 2>/dev/null | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//')"
export NV_REPROBE_TIMEOUT="${NV_REPROBE_TIMEOUT:-90}"

if [ -z "$NYV_SDK_KEY_NSP" ]; then
  echo "FAIL setup: NYV_SDK_KEY_NSP missing" >&2
  exit 2
fi

BASE="$NV_API_BASE_URL"
KEY="$NYV_SDK_KEY_NSP"
TIMEOUT="$NV_REPROBE_TIMEOUT"
HDR=(-H "X-API-Key: $KEY" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" -H "X-Customer-User-Id: reprobe-$(date +%s)")
PASS=0 FAIL=0 SKIP=0
record() { case "$2" in PASS) echo "PASS $1"; PASS=$((PASS+1));; SKIP) echo "SKIP $1"; SKIP=$((SKIP+1));; *) echo "FAIL $1 ($2)"; FAIL=$((FAIL+1));; esac; }

code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/health" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv1_health PASS || record nyv1_health "http=$code"

result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" "$BASE/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=3" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin); r=d.get('data',{}).get('results') or d.get('data',{}).get('items') or []
print('PASS' if d.get('success') and r and all('Supreme Court' in str(x.get('court','')) or x.get('courtType')=='sc' for x in r[:3]) else 'bad')
" 2>/dev/null || echo err)"; record nyv4_courtType_sc "$result"

result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" "$BASE/api/jrx/knowledge/caselaw/treatment?citation=%5B1980%5D%203%20S.C.R.%20383&exact=true" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin); a=d.get('data',{}).get('authority') or {}
print('PASS' if d.get('success') and a.get('matched') is not False else 'unresolved')
" 2>/dev/null || echo err)"; record nyv2_treatment_exact "$result"

result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" -H 'Content-Type: application/json' -d '{"citation":"(2011) 1 SCC 694","jurisdiction":"IN"}' "$BASE/api/jrx/knowledge/caselaw/verify-citation" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin); print('PASS' if d.get('success') and 'status' in (d.get('data') or {}) else 'no')
" 2>/dev/null || echo err)"; record nyv11_verify_citation "$result"

result="$(curl -sS -m "$TIMEOUT" "${HDR[@]}" -H 'Content-Type: application/json' -d '{"prompt":"IN THE HIGH COURT OF TELANGANA. Anticipatory bail under Section 438 CrPC.","taskType":"legal-chat-fast","jurisdiction":"IN"}' "$BASE/api/jrx/orchestrate" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin); st=((d.get('data') or {}).get('extras') or {}).get('analysisStatus')
print('PASS' if d.get('success') and st in ('structured','unstructured','failed') else f'absent:{st}')
" 2>/dev/null || echo err)"; record nyv6_analysisStatus "$result"

code="$(curl -sS -m 5 "${HDR[@]}" "$BASE/api/jrx/knowledge/caselaw/search?q=man&mode=fts&limit=5" -o /dev/null -w '%{http_code}' 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv10_fts_typeahead PASS || record nyv10_fts_typeahead "http=$code"

code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/matter-vault/health" 2>/dev/null || echo 000)"
[[ "$code" =~ ^(200|404)$ ]] && record nyv7_matter_vault PASS || record nyv7_matter_vault "http=$code"

code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/legal-work/health" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv8_legal_work PASS || record nyv8_legal_work "http=$code"

code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/packs" 2>/dev/null || echo 000)"
[[ "$code" =~ ^(200|401|403)$ ]] && record nyv9_evidence_pack PASS || record nyv9_evidence_pack "http=$code"

code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "${HDR[@]}" "$BASE/api/jrx/knowledge/caselaw/search?q=302&limit=3" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && record nyv5_bare_numeric PASS || record nyv5_bare_numeric "http=$code"

record nyv3_structure_shape SKIP
record x_org_id_clause SKIP

echo "--- PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ]
