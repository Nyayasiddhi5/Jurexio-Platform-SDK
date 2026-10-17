#!/usr/bin/env bash
# Local workstation crosscheck against live API — keys from .local/secrets/runtime.env only.
set -uo pipefail
cd "$(dirname "$0")/.."
API="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
SECRETS="../.local/secrets/runtime.env"
if [ -f "$SECRETS" ]; then set -a; source "$SECRETS"; set +a; fi
NSPK="${NYV_SDK_KEY_NSP:-}"
echo "=== LOCAL NSP CROSSCHECK $(date -u +%Y-%m-%dT%H:%M:%SZ) target=$API ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
[ "$(printf %s "$NSPK" | wc -c)" -gt 16 ] || { echo SKIP; exit 1; }

score() {
  local label="$1" timeout="$2" body="$3"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
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
    sm_core = sum(1 for k in ('prayer','verification','causeTitle','numberedParas') if sm.get(k)) if isinstance(sm, dict) else 0
    route = (data.get('routing') or {}).get('path') if isinstance(data.get('routing'), dict) else data.get('routing')
    ph = dq.get('placeholdersRemaining', len(re.findall(r'\[\[PLACEHOLDER:[^\]]+\]\]', content)))
    auth = dq.get('authoritiesDelivered', 0)
    print(f"SCORE {label} http={code} sec={round(int(ms)/1000,1)} route={route} chars={len(content)} "
          f"markers={sm_core}/4+limit={sm.get('limitationChecked')} sm={sm} ph={ph} auth={auth} "
          f"sources={bool(SOURCES.search(content))} ni138={bool(NI138.search(content))} "
          f"review={dq.get('reviewRecommended')} err={err.get('code')}")
except Exception as e:
    print(f"SCORE {label} http={code} sec={round(int(ms)/1000,1)} parse_err={e}")
PY
  rm -f "$tmp"
}

FIXTURE='IN THE COURT OF THE SESSIONS JUDGE, BENGALURU
CRL.MISC.NO. 123/2026 — Petitioner: Raj Kumar v. State of Karnataka
FIR 456/2026 PS Koramangala — BNS s.103. Accused in custody since 01-Jan-2026.'

score "legal-chat-fast_bail" 90 \
  '{"prompt":"What are twin conditions for anticipatory bail under BNSS?","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":512}'

score "legal-draft-fast_bail_medium" 120 \
  '{"prompt":"Draft anticipatory bail application for accused in custody, FIR 456/2026 Bengaluru, BNS s.103.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"medium"},"maxTokens":2560}'

score "legal-draft_bail_queen" 180 \
  '{"prompt":"Draft comprehensive anticipatory bail with full grounds for FIR 456/2026.","taskType":"legal-draft","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"comprehensive"},"maxTokens":4096,"syncTimeoutMs":120000}'

score "legal_notice_medium" 120 \
  '{"prompt":"Draft legal notice for cheque dishonour Rs 5 lakh, drawer ABC Ltd.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"legal_notice"},"options":{"draftLength":"medium"},"maxTokens":2048}'

score "writ_petition_comprehensive" 120 \
  '{"prompt":"Draft writ petition under Article 226 challenging arbitrary termination of government contract.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"writ_petition"},"options":{"draftLength":"comprehensive"},"maxTokens":4096}'

score "caselaw-research_420" 120 \
  '{"prompt":"Find Supreme Court precedents on Section 420 IPC cheating. List authorities.","taskType":"caselaw-research","jurisdiction":"IN","enableRAG":true,"maxTokens":1024}'

score "statute-research_BNS103" 90 \
  '{"prompt":"Map IPC Section 420 to BNS 2023 equivalent and explain elements.","taskType":"statute-research","jurisdiction":"IN","enableRAG":true,"maxTokens":512}'

python3 - <<PY > /tmp/doc_body.json
import json
fixture = """$FIXTURE"""
print(json.dumps({
  "prompt": "Draft bail application grounded on attached petition facts.",
  "documentText": fixture,
  "taskType": "doc-draft-fast",
  "jurisdiction": "IN",
  "parameters": {"documentType": "bail_application"},
  "options": {"draftLength": "medium"},
  "maxTokens": 2048
}))
PY
score "doc-draft-fast_documentText" 120 "$(cat /tmp/doc_body.json)"

score "draft_cnrFacts" 120 \
  '{"prompt":"Draft anticipatory bail for the matter below.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application","cnrFacts":"{\"cnr\":\"TSWL000000742024\",\"courtName\":\"High Court of Telangana\",\"petitioner\":\"Sample Petitioner\",\"respondent\":\"State of Telangana\"}","options":{"draftLength":"medium"},"maxTokens":2048}'

# Diary + CNR resolve (non-orchestrate)
for probe in \
  'DIARY|120|{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate"}}' \
  'CNR_TSWL|120|{"cnr":"TSWL000000742024","options":{"includeDocuments":false}}'; do
  IFS='|' read -r lbl to body <<< "$probe"
  tmp=$(mktemp)
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$to" -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  python3 - "$lbl" "$code" "$((end-start))" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path)); data = d.get('data') or d
    status = data.get('status') or data.get('matchStatus')
    tier = data.get('tier') or data.get('source')
    fields = data.get('fields') or {}
    print(f"SCORE {label} http={code} sec={round(int(ms)/1000,1)} status={status} tier={tier} success={d.get('success')} petitioner={str(fields.get('petitioner',''))[:30]}")
except Exception as e:
    print(f"SCORE {label} http={code} parse_err={e}")
PY
  rm -f "$tmp"
done
rm -f /tmp/doc_body.json
echo "=== DONE ==="
