#!/usr/bin/env bash
# Wave C partner contracts — Legal Work, Matter Vault, evidence pack (NSP full green).
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

hit() {
  local label="$1" method="$2" path="$3" body="${4:-}" max="${5:-60}"
  tmp=$(mktemp)
  if [ -n "$body" ]; then
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$max" -X "$method" \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "$body" "$API$path" 2>/dev/null || echo ERR)
  else
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$max" -X "$method" \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
      "$API$path" 2>/dev/null || echo ERR)
  fi
  echo "$label http=$code"
  if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "202" ]; then
    head -c 200 "$tmp" 2>/dev/null; echo
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
  return 0
}

echo "=== WAVE C contracts ==="
hit "legal-work-tasks" GET "/api/jrx/legal-work/tasks?jurisdiction=IN&limit=3" "" 45 && pass legal-work-tasks || fail legal-work-tasks
tmp_lw=$(mktemp)
code_lw=$(curl -sS -o "$tmp_lw" -w '%{http_code}' --max-time 185 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"instruction":"Summarise limitation for promissory note suit in India in two sentences.","timeoutMs":120000}' \
  "$API/api/jrx/legal-work/evaluate" 2>/dev/null || echo ERR)
echo "legal-work-evaluate http=$code_lw"
if [ "$code_lw" = "200" ] || [ "$code_lw" = "202" ]; then pass legal-work-evaluate; else fail "legal-work-evaluate http=$code_lw"; fi
rm -f "$tmp_lw"
hit "matter-vault-health" GET "/api/jrx/matter-vault/health" "" 30 && pass matter-vault-health || fail matter-vault-health
hit "matter-vault-packs" GET "/api/jrx/matter-vault/packs" "" 30 && pass matter-vault-packs || fail matter-vault-packs
hit "evidence-pack-get" GET "/api/jrx/compliance/evidence-pack" "" 90 && pass evidence-pack-get || fail evidence-pack-get

# nsp-ai-summary wire: document-analyst via orchestrate analyzeDocument (short doc)
SAMPLE='IN THE COURT OF SESSIONS AT HYDERABAD. Petition under Section 438 CrPC for anticipatory bail. Facts: FIR 123/2024. Prayer: grant bail.'
tmp=$(mktemp)
body=$(python3 - <<PY
import json
print(json.dumps({
  "prompt": "Extract parties, relief sought, and statutes cited.",
  "taskType": "analyzeDocument",
  "agentKey": "document-analyst",
  "jurisdiction": "IN",
  "documentText": """$SAMPLE""",
  "maxTokens": 512,
}))
PY
)
start_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 180 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d "$body" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
end_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
python3 - "$code" "$tmp" "$((end_ms - start_ms))" <<'PY'
import json, sys
code, path, elapsed = sys.argv[1:4]
d = json.load(open(path))
data = d.get("data") or d
content = str(data.get("content") or "")
qe = data.get("qualityEnvelope") or {}
err = (d.get("error") or {}).get("code")
print(f"analyzeDocument-agent\thttp={code}\telapsed_ms={elapsed}\tsuccess={d.get('success')}\terr={err}\tcontent_len={len(content)}\tqe_ok={qe.get('ok')}")
if code != "200" or not d.get("success") or len(content) < 20:
    sys.exit(1)
if err == "QUALITY_ENVELOPE_FAILED":
    sys.exit(1)
PY
if [ $? -eq 0 ]; then pass analyzeDocument-agent; else fail analyzeDocument-agent; fi
rm -f "$tmp"

echo "=== SUMMARY fail_count=$FAIL ==="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
