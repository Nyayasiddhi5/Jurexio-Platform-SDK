#!/usr/bin/env bash
# NSP AI task matrix — runs ON nysdev. NV-SECRETS-001: no secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
FAIL=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAIL=$((FAIL + 1)); }

if [ "$(printf %s "$NSPK" | wc -c | tr -d ' ')" -lt 16 ]; then
  echo "PROBE_BROKEN no_nsp_key"; exit 3
fi

orch_json() {
  local label="$1" body="$2" max="${3:-120}"
  local require_qe="${4:-1}"
  tmp=$(mktemp)
  start_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$max" -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  end_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
  elapsed=$((end_ms - start_ms))
  python3 - "$label" "$code" "$tmp" "$require_qe" "$elapsed" <<'PY'
import json, sys
label, code, path, require_qe, elapsed = sys.argv[1:6]
require_qe = require_qe == "1"
ok = code == "200"
try:
    raw = open(path).read().strip()
    if not raw:
        print(f"{label}\thttp={code}\telapsed_ms={elapsed}\tempty_body")
        sys.exit(1)
    d = json.loads(raw)
    err = d.get("error") or {}
    err_code = err.get("code") if isinstance(err, dict) else None
    data = d.get("data") or d
    content = str(data.get("content") or "")
    ws = data.get("webSearch") or d.get("webSearch")
    qe = data.get("qualityEnvelope") or d.get("qualityEnvelope") or {}
    qe_ok = qe.get("ok")
    completed = qe.get("completed") or []
    missing = qe.get("missingMandatory") or []
    has_llm_budget = "llm_route_budget" in completed
    print(
        f"{label}\thttp={code}\telapsed_ms={elapsed}\tsuccess={d.get('success')}\t"
        f"err_code={err_code}\tcontent_len={len(content)}\tqe_ok={qe_ok}\t"
        f"llm_route_budget={has_llm_budget}\tmissing={missing}\twebSearch={ws is not None}"
    )
    if err_code == "QUALITY_ENVELOPE_FAILED":
        sys.exit(1)
    if not ok or not d.get("success") or len(content) < 8:
        sys.exit(1)
    if require_qe and qe_ok is False:
        sys.exit(1)
    if require_qe and not has_llm_budget:
        sys.exit(1)
except Exception as e:
    print(f"{label}\thttp={code}\telapsed_ms={elapsed}\tparse_err={e}")
    sys.exit(1)
PY
  rc=$?
  rm -f "$tmp"
  return $rc
}

echo "=== MATRIX sync orchestrate ==="
orch_json "chat-fast" '{"prompt":"One line anticipatory bail under BNSS","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":128}' 90 && pass chat-fast || fail chat-fast
orch_json "draft-fast" '{"prompt":"Draft one bail application sentence","taskType":"legal-draft-fast","jurisdiction":"IN","maxTokens":128}' 90 && pass draft-fast || fail draft-fast
orch_json "researcher-tools" '{"prompt":"Latest BNSS anticipatory bail Supreme Court India","taskType":"web-search","agentKey":"legal-researcher","tools":["web-search"],"jurisdiction":"IN","maxTokens":256}' 90 && pass researcher-tools || fail researcher-tools
orch_json "web-search" '{"prompt":"Latest Supreme Court anticipatory bail news India","taskType":"web-search","jurisdiction":"IN","maxTokens":256}' 120 && pass web-search || fail web-search
orch_json "chat-tools" '{"prompt":"Latest BNSS bail legal news India","taskType":"legal-chat-fast","tools":["web-search"],"jurisdiction":"IN","maxTokens":256}' 120 && pass chat-tools || fail chat-tools

tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"query":"Indian BNSS bail","limit":3}' "$API/api/jrx/enterprise/web-search/search" 2>/dev/null || echo ERR)
if [ "$code" = "200" ]; then pass enterprise-web-search; else fail "enterprise-web-search http=$code"; fi
rm -f "$tmp"

tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"query":"Indian BNSS bail","options":{"limit":3}}' "$API/api/jrx/sdk/enterprise/search/web" 2>/dev/null || echo ERR)
[ "$code" = "200" ] && pass sdk-search-web || fail "sdk-search-web http=$code"
rm -f "$tmp"

for mode in fts hybrid; do
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 25 \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
    "$API/api/jrx/knowledge/caselaw/search?q=anticipatory+bail&limit=3&mode=$mode" 2>/dev/null || echo ERR)
  python3 - "$mode" "$code" "$tmp" <<'PY'
import json, sys
mode, code, path = sys.argv[1:4]
d = json.load(open(path))
data = d.get("data") or d
results = data.get("results") or []
total = data.get("total", len(results))
fb = data.get("searchMode") or data.get("fallbackMode")
print(f"caselaw_{mode}\thttp={code}\ttotal={total}\tresults={len(results)}\tfallback={fb}")
if code != "200" or (total == 0 and len(results) == 0):
    sys.exit(1)
PY
  if [ $? -eq 0 ]; then pass "caselaw-$mode"; else fail "caselaw-$mode"; fi
  rm -f "$tmp"
done

echo "=== STREAM web-search + tools ==="
stream_out=$(curl -sS -N --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"prompt":"Latest SC bail news one paragraph","taskType":"legal-chat-fast","tools":["web-search"],"jurisdiction":"IN","maxTokens":200}' \
  "$API/api/jrx/orchestrate/stream" 2>/dev/null || true)
if echo "$stream_out" | grep -qE 'web_search_ready|"type":"web_search_ready"'; then
  pass stream-web-search-ready-event
else
  echo "NOTE stream-web-search-ready-event absent (optional SSE); checking run_completed.webSearch"
fi
if echo "$stream_out" | grep -qE '"webSearch"|webSearch'; then
  pass stream-webSearch-in-run-completed
else
  fail stream-webSearch-in-run-completed
fi
echo "$stream_out" | grep -q 'run_completed' && pass stream-run-completed || fail stream-run-completed

echo "=== SUMMARY fail_count=$FAIL ==="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
