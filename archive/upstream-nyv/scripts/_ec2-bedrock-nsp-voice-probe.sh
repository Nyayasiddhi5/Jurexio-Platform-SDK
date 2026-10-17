#!/usr/bin/env bash
# Crosscheck Bedrock model enablement + NSP chat alias delivery. Never echo secrets.
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

echo "=== BEDROCK ENV (presence only) ==="
docker exec nyv-gateway sh -c 'node -e "
const ks=[
  \"AWS_BEARER_TOKEN_BEDROCK\",\"AWS_BEARER_TOKEN_BEDROCK_US_EAST_1\",\"AWS_BEARER_TOKEN_BEDROCK_AP_SOUTH_1\",
  \"BEDROCK_API_KEY\",\"BEDROCK_API_KEY_US_EAST_1\",\"AWS_BEDROCK_REGION\",\"AWS_REGION\",
  \"NYV_BEDROCK_REGION_ORDER\",\"NYV_BEDROCK_ENABLED\",\"NYV_PARTNER_LEGAL_PREMIUM_FIRST\",
  \"NYV_LLM_CASCADE_LEAD\",\"NYV_LEGAL_STRUCTURE_ATTACH\",\"NYV_NSP_COUNSEL_QUEEN\"
];
for (const k of ks) {
  const v = process.env[k] || \"\";
  if (k.includes(\"TOKEN\") || k.includes(\"KEY\")) {
    console.log(k + \" present=\" + (v ? \"yes\" : \"no\") + \" len=\" + v.length);
  } else {
    console.log(k + \"=\" + (v || \"(unset)\"));
  }
}
"'

echo "=== BEDROCK INVOKE us-east-1 (status only) ==="
docker exec nyv-gateway sh -c 'node -e "
const fs = require(\"fs\");
const https = require(\"https\");
const token = process.env.AWS_BEARER_TOKEN_BEDROCK_US_EAST_1
  || process.env.BEDROCK_API_KEY_US_EAST_1
  || process.env.AWS_BEARER_TOKEN_BEDROCK
  || process.env.BEDROCK_API_KEY
  || \"\";
console.log(\"bearer_present=\" + (token ? \"yes\" : \"no\") + \" len=\" + token.length);
if (!token) process.exit(0);
const models = [
  [\"global.anthropic.claude-sonnet-5\", \"claude\"],
  [\"global.anthropic.claude-sonnet-4-6\", \"claude\"],
  [\"global.anthropic.claude-opus-4-6-v1\", \"claude\"],
  [\"deepseek.v3.2\", \"openai\"],
  [\"us.amazon.nova-pro-v1:0\", \"nova\"],
  [\"us.amazon.nova-lite-v1:0\", \"nova\"],
];
function bodyFor(kind) {
  if (kind === \"claude\") return JSON.stringify({
    anthropic_version: \"bedrock-2023-05-31\",
    max_tokens: 16,
    messages: [{ role: \"user\", content: \"Reply with the single word OK.\" }],
  });
  if (kind === \"nova\") return JSON.stringify({
    schemaVersion: \"messages-v1\",
    messages: [{ role: \"user\", content: [{ text: \"Reply with the single word OK.\" }] }],
    inferenceConfig: { maxNewTokens: 16, temperature: 0 },
  });
  return JSON.stringify({
    messages: [{ role: \"user\", content: \"Reply with the single word OK.\" }],
    max_tokens: 16,
  });
}
function invoke(modelId, kind) {
  return new Promise((resolve) => {
    const payload = bodyFor(kind);
    const req = https.request({
      hostname: \"bedrock-runtime.us-east-1.amazonaws.com\",
      path: \"/model/\" + encodeURIComponent(modelId) + \"/invoke\",
      method: \"POST\",
      headers: {
        Authorization: \"Bearer \" + token,
        \"Content-Type\": \"application/json\",
        Accept: \"application/json\",
        \"Content-Length\": Buffer.byteLength(payload),
      },
      timeout: 25000,
    }, (res) => {
      let data = \"\";
      res.on(\"data\", (c) => { data += c; if (data.length > 800) data = data.slice(0, 800); });
      res.on(\"end\", () => {
        const snippet = data.replace(/\"[A-Za-z0-9+\\/=]{20,}\"/g, \"\\\"[redacted]\\\"\").slice(0, 180).replace(/\\s+/g, \" \");
        resolve({ modelId, status: res.statusCode, snippet });
      });
    });
    req.on(\"timeout\", () => { req.destroy(); resolve({ modelId, status: 0, snippet: \"timeout\" }); });
    req.on(\"error\", (e) => resolve({ modelId, status: 0, snippet: String(e.message || e).slice(0, 120) }));
    req.write(payload);
    req.end();
  });
}
(async () => {
  for (const [id, kind] of models) {
    const r = await invoke(id, kind);
    console.log(\"INVOKE \" + r.modelId + \" HTTP \" + r.status + \" \" + r.snippet);
  }
})();
"'

key_for() { grep -E "^NYV_SDK_KEY_${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NSPK=$(key_for NSP)
if [ -z "$NSPK" ]; then echo "FAIL no NSP key"; FAIL=$((FAIL+1)); fi

echo "=== ROUTER EXPLAIN (cascade lead) ==="
if [ -n "$NSPK" ]; then
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
print("lead=" + " -> ".join("%s:%s" % (m.get("provider"), m.get("id")) for m in seq[:6]))
PY
fi

echo "=== NSP ORCHESTRATE FIELD ALIASES (copy-resend) ==="
probe_body() {
  local label="$1"
  local json="$2"
  local tmax="${3:-25}"
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
else:
    em=str(err or "")[:80]
ok="yes" if d.get("answer") or d.get("content") or d.get("success") else "no"
print("%s HTTP %s delivered=%s err=%s" % (label, code, ok, em or "-"))
PY
}

if [ -n "$NSPK" ]; then
  # Fast 400/accept check — copied STT often lands in message/text/transcript, not prompt.
  probe_body "prompt" '{"prompt":"In one sentence, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 90
  probe_body "message_only" '{"message":"In one sentence, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 25
  probe_body "text_only" '{"text":"In one sentence, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 25
  probe_body "transcript_only" '{"transcript":"In one sentence, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 25
  probe_body "stt_envelope" '{"success":true,"data":{"text":"In one sentence, what is Section 73 of the Indian Contract Act?"},"agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 25
  probe_body "messages_array" '{"messages":[{"role":"user","content":"In one sentence, what is Section 73 of the Indian Contract Act?"}],"agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 25
  probe_body "nbsp_prompt" '{"prompt":"\u00a0In one sentence, what is Section 73 of the Indian Contract Act?\u00a0","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' 90
fi

echo "=== GATEWAY LOGS (48h) prompt-required / legal-chat 4xx ==="
docker logs nyv-gateway --since 48h 2>&1 | grep -E 'prompt is required|BAD_REQUEST|AUDIO_REQUIRED|legal-chat|/orchestrate' | grep -E '400|required|fail|error' | tail -40 || true
echo "=== LOG COUNTS ==="
docker logs nyv-gateway --since 48h 2>&1 | python3 -c '
import sys
from collections import Counter
c=Counter()
for line in sys.stdin:
    l=line.lower()
    if "prompt is required" in l: c["prompt_is_required"] += 1
    if "audio_required" in l or "audio required" in l: c["audio_required"] += 1
    if "stt_provider" in l: c["stt_provider"] += 1
    if "/orchestrate" in l and (" 400" in l or "bad_request" in l): c["orchestrate_400"] += 1
print(dict(c) or {"counts":"none"})
' || true

echo "PROBE_FAILS=$FAIL"
exit 0
