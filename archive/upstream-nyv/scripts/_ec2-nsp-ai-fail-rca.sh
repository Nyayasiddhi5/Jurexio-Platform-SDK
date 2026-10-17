#!/usr/bin/env bash
# NSP AI failure RCA — no secrets in output.
set -euo pipefail
echo "=== HEALTH ==="
curl -sS -m 15 https://api.nyayasiddhi.online/api/jrx/health | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status"),d.get("totalAgents"),d.get("version"))'

echo "=== LIVE LLM FLAGS ==="
docker exec nyv-gateway sh -c 'node -e "
const ks=[
  \"NYV_LLM_CASCADE_LEAD\",\"NYV_PARTNER_LEGAL_PREMIUM_FIRST\",\"AWS_BEDROCK_REGION\",
  \"NYV_LLM_HEDGE_MS\",\"NYV_LLM_PROVIDER_TIMEOUT_MS\",\"NYV_LLM_PROVIDER_STREAM_TIMEOUT_MS\",
  \"NYV_ORCH_WALL_CLOCK_MS\",\"NYV_NSP_COUNSEL_QUEEN\",\"NYV_PARTNER_MAX_TOKENS_FLOOR\",
  \"NYV_PARTNER_MAX_TOKENS_CHAT\",\"NYV_PARTNER_MAX_TOKENS_FAST\"
];
for (const k of ks) console.log(k+\"=\"+(process.env[k]||\"(unset)\"));
"'

echo "=== LOG COUNTS 3h ==="
docker logs nyv-gateway --since 3h 2>&1 | python3 -c '
import sys,re,collections
c=collections.Counter()
models=collections.Counter()
errs=collections.Counter()
bedrock_fail=0
gemini=0
timeout=0
orch400=0
orch5xx=0
prompt_req=0
for line in sys.stdin:
    l=line.lower()
    if "prompt is required" in l: prompt_req += 1
    if "orchestrate" in l and (" 500" in l or "\"status\":500" in l): orch5xx += 1
    if "orchestrate" in l and (" 400" in l or "bad_request" in l): orch400 += 1
    if "timeout" in l or "timed out" in l or "etimedout" in l or "undici" in l:
        timeout += 1
        c["timeout_line"] += 1
    if "bedrock" in l and any(x in l for x in ("fail","error","denied","429","403","400","timeout")):
        bedrock_fail += 1
    if "gemini" in l or "google" in l:
        gemini += 1
    if "llm-orchestrator" in l:
        c["llm_orch"] += 1
        if "failed" in l or "advancing fallback" in l: c["llm_fallback"] += 1
        if "hedge success" in l: c["hedge_ok"] += 1
        if "never-empty" in l or "never_empty" in l: c["never_empty"] += 1
        if "agentzero" in l: c["agentzero"] += 1
    m=re.search(r"model[=:][\s\"]*([A-Za-z0-9._:/-]+)", line)
    if m and ("claude" in m.group(1).lower() or "gemini" in m.group(1).lower() or "deepseek" in m.group(1).lower() or "nova" in m.group(1).lower()):
        models[m.group(1)[:80]] += 1
    if any(x in l for x in ("access denied","invalid_payment","throttl","too many requests","validationexception","model timed out")):
        errs[line.strip()[:160]] += 1
print("prompt_required", prompt_req)
print("orch_400ish", orch400)
print("orch_5xxish", orch5xx)
print("timeout_lines", timeout)
print("bedrock_failish", bedrock_fail)
print("gemini_mentions", gemini)
print("counters", dict(c))
print("top_models")
for k,v in models.most_common(15):
    print(" ", v, k)
print("top_err_snippets")
for k,v in errs.most_common(12):
    print(" ", v, k.replace("\\n"," ")[:180])
'

echo "=== RECENT LLM FAIL LINES ==="
docker logs nyv-gateway --since 3h 2>&1 | grep -E 'llm-orchestrator: model failed|hedge success|never-empty|AgentZero|INVALID_PAYMENT|Access denied|Throttl|prompt is required|ETIMEDOUT|UND_ERR|ORCH_WALL|provider quarantined|\[Bedrock\] attempt failed' | tail -80 || true

echo "=== NSP ORCHESTRATE STATUS SAMPLE ==="
docker logs nyv-gateway --since 3h 2>&1 | grep -E 'POST /api/jrx/orchestrate|legal-chat|llm-orchestrator: success' | tail -40 || true

echo "=== ROUTER EXPLAIN + TIMED ORCH ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
API="https://api.nyayasiddhi.online"
curl -sS -o /tmp/explain.json -w 'explain HTTP %{http_code}\n' -m 25 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"tier":"enterprise","jurisdiction":"IN","taskKind":"legal_research","app":"NSP","promptTokens":400,"expectedOutputTokens":200}' \
  "${API}/api/jrx/v1/sdk/llm/router/explain" || true
python3 - <<'PY' || true
import json
d=json.load(open("/tmp/explain.json"))
seq = (d.get("data") or {}).get("sequence") or d.get("sequence") or []
primary = (d.get("data") or {}).get("primary") or d.get("primary") or {}
print("primary=%s:%s" % (primary.get("provider"), primary.get("id")))
print("lead=" + " -> ".join("%s:%s" % (m.get("provider"), m.get("id")) for m in seq[:8]))
PY
START=$(date +%s)
code=$(curl -sS -o /tmp/orch-rca.json -w '%{http_code}' -m 70 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"prompt":"In two sentences, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":256}' \
  "${API}/api/jrx/orchestrate" || echo 000)
ELAP=$(( $(date +%s) - START ))
python3 - "$code" "$ELAP" <<'PY'
import json,sys
code,elap=sys.argv[1],sys.argv[2]
try:
    d=json.load(open("/tmp/orch-rca.json"))
except Exception:
    d={}
data=d.get("data") or d
err=d.get("error")
em=err if isinstance(err,str) else (err or {}).get("message","") if isinstance(err,dict) else ""
content=str(data.get("content") or data.get("response") or "")[:80]
print("summarize HTTP %s elapsed_s=%s model=%s provider=%s content_len=%s err=%s preview=%s" % (
    code, elap, data.get("model"), data.get("provider"), len(str(data.get("content") or "")),
    str(em)[:80] or "-", content.replace("\n"," ")
))
PY
