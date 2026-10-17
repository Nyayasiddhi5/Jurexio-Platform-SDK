#!/usr/bin/env bash
# NSP crosscheck probe — Phase 3 live matrix. Runs ON nysdev EC2. NV-SECRETS-001.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

echo "=== NSP CROSSCHECK $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "LAST_GOOD=$(cat /opt/nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

# Minimal Indian legal fixture for doc-draft-fast attachment path
FIXTURE='IN THE COURT OF THE SESSIONS JUDGE, BENGALURU
CRL.MISC.NO. 123/2026
Petitioner: Raj Kumar v. State of Karnataka
FIR 456/2026 PS Koramangala — offences under BNS s.103.
Facts: accused in custody since 01-Jan-2026; first bail application.
Grounds: no flight risk; investigation complete.'

score_orchestrate() {
  local label="$1" timeout="$2" body="$3"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys, re
label, code, ms, path = sys.argv[1:5]
PRAYER = re.compile(r'\b(PRAYER|PRAYERS|RELIEF)\b', re.I)
VERIF = re.compile(r'\b(VERIFICATION|VERIFIED)\b', re.I)
CAUSE = re.compile(r'\b(IN THE (?:HIGH COURT|COURT|SESSIONS)|MOST RESPECTFULLY SHOWETH)\b', re.I)
NUM = re.compile(r'(?:^|\n)\s*\d+\.\s+[^\n]{20,}', re.M)
LIMIT = re.compile(r'\b(limitation|Article\s+\d+|Limitation Act)\b', re.I)
SOURCES = re.compile(r'SOURCES CONSULTED', re.I)
NI138 = re.compile(r'NI Act|s\.?\s*138|30 days', re.I)
PLACE = len(re.findall(r'\[\[PLACEHOLDER:[^\]]+\]\]', open(path).read() if False else ''))

def markers(text):
    return {
        'prayer': bool(PRAYER.search(text)),
        'verification': bool(VERIF.search(text)),
        'causeTitle': bool(CAUSE.search(text)),
        'numberedParas': bool(NUM.search(text)),
        'limitationChecked': bool(LIMIT.search(text)),
    }

try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get('data') or d
    err = d.get('error') or {}
    content = str(data.get('content') or '')
    dq = data.get('draftQuality') or {}
    sm = dq.get('structureMarkers') or markers(content)
    sm_count = sum(1 for v in sm.values() if v) if isinstance(sm, dict) else 0
    route = (data.get('routing') or {}).get('path') if isinstance(data.get('routing'), dict) else data.get('routing')
    ph = dq.get('placeholdersRemaining', len(re.findall(r'\[\[PLACEHOLDER:[^\]]+\]\]', content)))
    auth = dq.get('authoritiesDelivered', 0)
    sources = bool(SOURCES.search(content))
    ni138 = bool(NI138.search(content))
    sec = round(ms/1000, 1)
    print(f"SCORE {label} http={code} sec={sec} route={route} chars={len(content)} "
          f"markers={sm_count}/5 sm={sm} ph={ph} auth={auth} sources={sources} ni138={ni138} "
          f"review={dq.get('reviewRecommended')} err={err.get('code')}")
except Exception as e:
    print(f"SCORE {label} http={code} sec={round(int(ms)/1000,1)} parse_err={e}")
PY
  rm -f "$tmp"
}

# --- Phase 3 matrix ---
score_orchestrate "legal-chat-fast_bail" 90 \
  '{"prompt":"What are twin conditions for anticipatory bail under BNSS in Karnataka?","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":512}'

score_orchestrate "legal-draft-fast_bail_medium" 120 \
  '{"prompt":"Draft anticipatory bail application for accused in custody, FIR 456/2026 Bengaluru, BNS s.103.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"medium"},"maxTokens":2560}'

score_orchestrate "legal-draft_bail_queen" 180 \
  '{"prompt":"Draft comprehensive anticipatory bail application with full grounds for FIR 456/2026.","taskType":"legal-draft","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"comprehensive"},"maxTokens":4096,"syncTimeoutMs":120000}'

score_orchestrate "legal_notice_medium" 120 \
  '{"prompt":"Draft legal notice for cheque dishonour Rs 5 lakh, drawer ABC Ltd.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"legal_notice"},"options":{"draftLength":"medium"},"maxTokens":2048}'

score_orchestrate "writ_petition_comprehensive" 120 \
  '{"prompt":"Draft writ petition under Article 226 challenging arbitrary termination of government contract.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"writ_petition"},"options":{"draftLength":"comprehensive"},"maxTokens":4096}'

score_orchestrate "caselaw-research_420" 120 \
  '{"prompt":"Find Supreme Court precedents on Section 420 IPC cheating. List authorities with citations.","taskType":"caselaw-research","jurisdiction":"IN","enableRAG":true,"maxTokens":1024}'

score_orchestrate "statute-research_BNS103" 90 \
  '{"prompt":"Map IPC Section 420 to BNS 2023 equivalent and explain elements.","taskType":"statute-research","jurisdiction":"IN","enableRAG":true,"maxTokens":512}'

# doc-draft-fast with documentText fixture
python3 - <<PY
import json
fixture = '''$FIXTURE'''
body = {
  "prompt": "Draft a bail application reply grounded on the attached petition facts.",
  "documentText": fixture,
  "taskType": "doc-draft-fast",
  "jurisdiction": "IN",
  "parameters": {"documentType": "bail_application"},
  "options": {"draftLength": "medium"},
  "maxTokens": 2048
}
print(json.dumps(body))
PY > /tmp/doc_draft_body.json

score_orchestrate "doc-draft-fast_documentText" 120 "$(cat /tmp/doc_draft_body.json)"

# CNR + cnrFacts injection
score_orchestrate "draft_cnrFacts" 120 \
  '{"prompt":"Draft anticipatory bail for the matter below.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application","cnr":"TSWL000000742024","cnrFacts":"{\"cnr\":\"TSWL000000742024\",\"courtName\":\"High Court of Telangana\",\"petitioner\":\"Sample Petitioner\",\"respondent\":\"State of Telangana\"}","options":{"draftLength":"medium"},"maxTokens":2048}'

# Diary 17329/2025
tmp=$(mktemp)
start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":false}}' \
  "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
ms=$((end_ms - start_ms))
python3 - "$code" "$ms" "$tmp" <<'PY'
import json, sys
code, ms, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    data = d.get('data') or d
    status = data.get('status') or data.get('matchStatus')
    fields = data.get('fields') or {}
    print(f"SCORE diary_17329_2025 http={code} sec={round(int(ms)/1000,1)} status={status} "
          f"found={status not in ('not_found','miss') and d.get('success')} "
          f"petitioner={str(fields.get('petitioner',''))[:40]}")
except Exception as e:
    print(f"SCORE diary_17329_2025 http={code} parse_err={e}")
PY
rm -f "$tmp" /tmp/doc_draft_body.json

echo "=== CROSSCHECK DONE ==="
