#!/usr/bin/env bash
# Deploy verify + CNR/diary old-vs-new crosscheck. Runs ON nysdev EC2. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NYSAPI="https://nysapi.nyayasiddhi.online"
NYS_LEGACY="https://nyayasearch.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
NYS_KEY="$(read_canon_key NYS_KNOWLEDGE_API_KEY)"
CASE_KEY="$(read_canon_key NYS_CASE_API_KEY)"
CASE_FLAG="$(read_canon_key NYV_F_CASE_API_CNR)"
CURRENT="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
LAST="$(cat /opt/Nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || cat /opt/nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"

echo "=== DEPLOY VERIFY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CURRENT_DEPLOY=$CURRENT"
echo "LAST_GOOD_DEPLOY=$LAST"
echo "NYV_F_CASE_API_CNR=${CASE_FLAG:-unset}"
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ') NYS_key_len=$(printf %s "$NYS_KEY" | wc -c | tr -d ' ') case_api_key_len=$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')"

# Health (localhost + public)
for url in "http://127.0.0.1:5000/api/jrx/health" "$API/api/jrx/health"; do
  code=$(curl -sS -o /tmp/h.json -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo ERR)
  ver=$(python3 -c "import json;d=json.load(open('/tmp/h.json'));print(d.get('version','?'),d.get('status','?'))" 2>/dev/null || echo parse_err)
  echo "HEALTH url=$url http=$code $ver"
done

# Structure markers in deployed tree
DEPLOY_DIR="/opt/Nyayavigya/repo/${CURRENT}"
if [ -d "$DEPLOY_DIR" ]; then
  echo "DEPLOY_DIR=$DEPLOY_DIR"
  grep -l 'NV-COUNSEL-STRUCTURE-MARKERS-P1-001' "$DEPLOY_DIR/src/services/jrx-draft-completion.ts" 2>/dev/null \
    && echo "MARKERS_P1=found_in_nv-draft-completion.ts" || echo "MARKERS_P1=missing"
  grep -c 'isNoticeDocumentType\|isAgreementDocumentType\|DEMAND_RE\|RECITALS_RE' \
    "$DEPLOY_DIR/src/services/jrx-draft-completion.ts" 2>/dev/null \
    | xargs -I{} echo "MARKERS_SYMBOLS={}"
  git -C "$DEPLOY_DIR" rev-parse --short HEAD 2>/dev/null | xargs -I{} echo "DEPLOY_SHA={}"
else
  echo "DEPLOY_DIR=missing path=$DEPLOY_DIR"
fi

probe_nyv() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "new_nyv" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, path_name, code, ms, fpath = sys.argv[1:6]
try:
    d = json.load(open(fpath))
    data = d.get('data') or {}
    meta = data.get('meta') or {}
    src = data.get('source') or meta.get('source') or meta.get('tier') or d.get('source') or '-'
    status = data.get('status') or data.get('matchStatus') or '-'
    print(f"ROW|{label}|{path_name}|{status}|{status}|{src}|{ms}ms|http={code}")
except Exception as e:
    print(f"ROW|{label}|{path_name}|ERR|ERR|parse_err|{ms}ms|http={code}|{e}")
PY
  rm -f "$tmp"
}

probe_legacy() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NYS_KEY" -H "Content-Type: application/json" \
    -d "$body" "$NYS_LEGACY/api/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "legacy_nys" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, path_name, code, ms, fpath = sys.argv[1:6]
try:
    d = json.load(open(fpath))
    data = d.get('data') or {}
    meta = data.get('meta') or {}
    src = data.get('source') or meta.get('source') or meta.get('tier') or d.get('source') or '-'
    status = data.get('status') or data.get('matchStatus') or '-'
    print(f"ROW|{label}|{path_name}|{status}|{status}|{src}|{ms}ms|http={code}")
except Exception as e:
    print(f"ROW|{label}|{path_name}|ERR|ERR|parse_err|{ms}ms|http={code}|{e}")
PY
  rm -f "$tmp"
}

probe_nysapi() {
  local label="$1" url="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 \
    -H "X-API-Key: $CASE_KEY" "$url" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "nysapi_direct" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, path_name, code, ms, fpath = sys.argv[1:6]
try:
    d = json.load(open(fpath))
    cases = d.get('cases') or d.get('data',{}).get('cases') or []
    total = d.get('total') or d.get('data',{}).get('total') or len(cases)
    status = 'found' if total and int(total) > 0 else 'not_found'
    src = 'nysapi_case_api_search'
    print(f"ROW|{label}|{path_name}|{status}|{status}|{src}|{ms}ms|http={code}|total={total}")
except Exception as e:
    print(f"ROW|{label}|{path_name}|ERR|ERR|parse_err|{ms}ms|http={code}|{e}")
PY
  rm -f "$tmp"
}

if [ "$(printf %s "$NSPK" | wc -c | tr -d ' ')" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

echo "=== CNR/DIARY CROSSCHECK ==="
echo "TABLE_HEADER|id|old_api_status|new_api_status|source|latency"

# CNRs
for spec in \
  "CNR_TSWL|{\"cnr\":\"TSWL000000742024\",\"options\":{\"includeDocuments\":false}}" \
  "CNR_RJHC|{\"cnr\":\"RJHC010324382023\",\"options\":{\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
  "CNR_GJHC|{\"cnr\":\"GJHC240256342024\",\"options\":{\"includeDocuments\":false}}" \
  "CNR_ZZZZ|{\"cnr\":\"ZZZZ000000000000\",\"options\":{\"includeDocuments\":false}}"; do
  lbl="${spec%%|*}"; body="${spec#*|}"
  probe_legacy "$lbl" "$body"
  probe_nyv "$lbl" "$body"
done

# Diaries
for spec in \
  "DIARY_17329|{\"diaryNumber\":\"17329/2025\",\"options\":{\"courtType\":\"sc\",\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
  "DIARY_264|{\"diaryNumber\":\"264/2024\",\"options\":{\"courtType\":\"sc\",\"includeDocuments\":false}}" \
  "DIARY_INSC|{\"diaryNumber\":\"2023 INSC 1081\",\"options\":{\"courtType\":\"sc\",\"includeDocuments\":false}}"; do
  lbl="${spec%%|*}"; body="${spec#*|}"
  probe_legacy "$lbl" "$body"
  probe_nyv "$lbl" "$body"
done

# nysapi direct (new path layer)
if [ "$(printf %s "$CASE_KEY" | wc -c | tr -d ' ')" -gt 8 ]; then
  probe_nysapi "NYSAPI_diary_17329" "$NYSAPI/v1/cases?court_type=SC&diary_no=17329/2025&page_size=1"
  probe_nysapi "NYSAPI_cnr_TSWL" "$NYSAPI/v1/cases?court_type=DC&cnr=TSWL000000742024&page_size=1"
fi

echo "=== CROSSCHECK DONE ==="
