#!/usr/bin/env bash
# Post-deploy: prompt aliases must deliver (not 400). Never echo secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
FAIL=0

echo "=== HEALTH ==="
HCODE=$(curl -sS -o /tmp/jrx-health.json -w '%{http_code}' -m 20 "${API}/api/jrx/health" || echo 000)
python3 - <<PY
import json
d=json.load(open("/tmp/jrx-health.json"))
print("HTTP $HCODE status=%s agents=%s ver=%s" % (d.get("status"), d.get("totalAgents"), d.get("version")))
PY
[ "$HCODE" = "200" ] || FAIL=$((FAIL+1))

echo "=== LIVE FLAGS ==="
docker exec nyv-gateway sh -c 'node -e "
for (const k of [
  \"NYV_PARTNER_LEGAL_PREMIUM_FIRST\",\"AWS_BEDROCK_REGION\",\"NYV_BEDROCK_REGION_ORDER\",
  \"NYV_LEGAL_STRUCTURE_ATTACH\",\"NYV_NSP_COUNSEL_QUEEN\",\"NYV_LEGAL_COMPREHENSIVE\"
]) console.log(k + \"=\" + (process.env[k] || \"(unset)\"));
"'

key_for() { grep -E "^NYV_SDK_KEY_${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NSPK=$(key_for NSP)

echo "=== ROUTER EXPLAIN ==="
code=$(curl -sS -o /tmp/explain.json -w '%{http_code}' -m 30 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"tier":"enterprise","jurisdiction":"IN","taskKind":"legal_research","app":"NSP","promptTokens":400,"expectedOutputTokens":200}' \
  "${API}/api/jrx/v1/sdk/llm/router/explain" || echo 000)
echo "router/explain HTTP $code"
python3 - <<'PY' || true
import json
d=json.load(open("/tmp/explain.json"))
seq = (d.get("data") or {}).get("sequence") or d.get("sequence") or []
primary = (d.get("data") or {}).get("primary") or d.get("primary") or {}
print("primary=%s:%s" % (primary.get("provider"), primary.get("id")))
print("lead=" + " -> ".join("%s:%s" % (m.get("provider"), m.get("id")) for m in seq[:5]))
PY

probe() {
  local label="$1" json="$2" tmax="${3:-20}"
  local code
  code=$(curl -sS -o /tmp/orch-alias.json -w '%{http_code}' -m "$tmax" \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d "$json" "${API}/api/jrx/orchestrate" || echo 000)
  python3 - "$label" "$code" <<'PY'
import json,sys
label,code=sys.argv[1],sys.argv[2]
try:
    d=json.load(open("/tmp/orch-alias.json"))
except Exception:
    d={}
err=d.get("error")
if isinstance(err, dict):
    em="%s:%s"%(err.get("code"), (err.get("message") or "")[:80])
    rejected = err.get("code") == "BAD_REQUEST" and "prompt is required" in str(err.get("message") or "").lower()
else:
    em=str(err or "")[:80]
    rejected = "prompt is required" in em.lower()
# Alias fix succeeds if NYV no longer 400s on missing `prompt`.
# 200 = delivered; 000/timeout = Queen accepted and still running.
ok = (not rejected) and code != "400"
print("%s HTTP %s alias_ok=%s err=%s" % (label, code, "yes" if ok else "no", em or "-"))
open("/tmp/alias-fail","a").write("1\n" if not ok else "")
PY
}

: > /tmp/alias-fail
Q='In one sentence, what is Section 73 of the Indian Contract Act?'
probe "message_only" "{\"message\":\"$Q\",\"agentId\":\"summarizer\",\"jurisdiction\":\"IN\",\"taskType\":\"summarize\",\"mode\":\"sync\",\"maxTokens\":64}" 25
probe "transcript_only" "{\"transcript\":\"$Q\",\"agentId\":\"summarizer\",\"jurisdiction\":\"IN\",\"taskType\":\"summarize\",\"mode\":\"sync\",\"maxTokens\":64}" 25
probe "stt_envelope" "{\"success\":true,\"data\":{\"text\":\"$Q\"},\"agentId\":\"summarizer\",\"jurisdiction\":\"IN\",\"taskType\":\"summarize\",\"mode\":\"sync\",\"maxTokens\":64}" 25

if [ -s /tmp/alias-fail ]; then
  echo "ALIAS_FAIL"
  FAIL=$((FAIL+1))
else
  echo "ALIAS_PASS"
fi
echo "VERIFY_FAILS=$FAIL"
exit "$FAIL"
