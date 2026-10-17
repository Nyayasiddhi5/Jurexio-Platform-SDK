#!/usr/bin/env bash
# NSP task + diary probe — runs ON nysdev EC2. NV-SECRETS-001: no key echo.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
CASE_API_KEY="$(read_canon_key NYS_CASE_API_KEY)"
NYSAPI="https://nysapi.nyayasiddhi.online"

probe_json() {
  local label="$1" timeout="$2" method="$3" url="$4" body="${5:-}" auth="${6:-nyv}"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  local curl_auth=()
  if [[ "$auth" == "nyv" ]]; then
    curl_auth=(-H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp")
  elif [[ "$auth" == "caseapi" ]]; then
    curl_auth=(-H "X-API-Key: $CASE_API_KEY")
  fi
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  if [[ "$method" == "POST" ]]; then
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" -X POST \
      "${curl_auth[@]}" -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null || echo ERR)
  else
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" \
      "${curl_auth[@]}" "$url" 2>/dev/null || echo ERR)
  fi
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    err = d.get("error") or {}
    # compact summary fields
    status = data.get("status") or data.get("analysisStatus")
    lookup = data.get("lookupType")
    source = data.get("source") or data.get("tier") or d.get("source")
    total = data.get("total")
    returned = data.get("returned") or (data.get("cases") and len(data.get("cases",[])))
    route = (data.get("routing") or {}).get("path") if isinstance(data.get("routing"), dict) else data.get("routing")
    content_len = len(str(data.get("content") or ""))
    cases_n = len(data.get("cases") or []) if isinstance(data.get("cases"), list) else None
    case_obj = (data.get("case") or {}) if isinstance(data.get("case"), dict) else {}
    cnr = data.get("cnr") or case_obj.get("cnr")
    diary = data.get("diaryNumber") or case_obj.get("diary_no")
    print(f"PROBE {label} http={code} ms={ms} success={d.get('success')} status={status} lookup={lookup} source={source} total={total} returned={returned or cases_n} cnr={cnr} diary={diary} route={route} content_len={content_len} err={err.get('code')} msg={str(err.get('message') or '')[:80]}")
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== NSP TASK + DIARY PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ') case_api_key_len=$(printf %s "$CASE_API_KEY" | wc -c | tr -d ' ')"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

# --- AI tasks ---
probe_json "legal-chat-fast" 90 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"One line: anticipatory bail under BNSS","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":128}'

probe_json "legal-draft-fast+docType" 90 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"Draft one bail prayer paragraph under BNSS.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"medium"},"maxTokens":512}'

probe_json "doc-draft-fast" 90 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"Improve this clause for Indian contract law.","taskType":"doc-draft-fast","jurisdiction":"IN","selectedText":"The vendor shall indemnify the buyer.","maxTokens":256}'

probe_json "caselaw-research" 120 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"Find Supreme Court precedents on Section 420 IPC cheating. Cite if grounded.","taskType":"caselaw-research","jurisdiction":"IN","enableRAG":true,"maxTokens":512}'

probe_json "statute-research" 90 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"What is Section 103 BNS?","taskType":"statute-research","jurisdiction":"IN","enableRAG":true,"maxTokens":256}'

probe_json "legal-research" 90 POST "$API/api/jrx/orchestrate" \
  '{"prompt":"What is consideration under Indian Contract Act?","taskType":"legal-research","jurisdiction":"IN","enableRAG":true,"maxTokens":256}'

# --- Caselaw plane direct ---
probe_json "caselaw_hybrid_420" 30 GET "$API/api/jrx/knowledge/caselaw/search?q=Section+420+IPC+cheating&courtType=sc&limit=3&mode=hybrid"
probe_json "caselaw_fts_420" 30 GET "$API/api/jrx/knowledge/caselaw/search?q=Section+420+IPC+cheating&courtType=sc&limit=3&mode=fts"
probe_json "caselaw_hybrid_bail" 30 GET "$API/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=3&mode=hybrid"

# --- CNR samples ---
probe_json "CNR_TSWL" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"cnr":"TSWL000000742024","options":{"includeDocuments":false}}'
probe_json "CNR_RJHC" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false}}'
probe_json "CNR_GJHC" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"cnr":"GJHC010001232024","options":{"includeDocuments":false}}'

# --- Diary samples ---
probe_json "DIARY_SC_17329" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":false}}'
probe_json "DIARY_SC_INSC" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"diaryNumber":"2023 INSC 1081","options":{"courtType":"sc","includeDocuments":false}}'
probe_json "DIARY_SC_264" 120 POST "$API/api/jrx/v1/sdk/cnr/resolve" \
  '{"diaryNumber":"264/2024","options":{"courtType":"sc","includeDocuments":false}}'

# --- nysapi direct (case-api) ---
if [ "$(printf %s "$CASE_API_KEY" | wc -c)" -gt 8 ]; then
  probe_json "nysapi_diary_17329" 30 GET \
    "$NYSAPI/v1/cases?court_type=SC&diary_no=17329/2025&page_size=1" \
    "" caseapi
fi

echo "=== PROBE DONE ==="
