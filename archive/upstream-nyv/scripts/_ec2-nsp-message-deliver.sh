#!/usr/bin/env bash
# One full NSP message-alias orchestrate (wait for body). Never echo secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
code=$(curl -sS -o /tmp/orch-msg.json -w '%{http_code}' -m 120 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"message":"In one sentence, what is Section 73 of the Indian Contract Act?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync","maxTokens":64}' \
  "${API}/api/jrx/orchestrate" || echo 000)
python3 - "$code" <<'PY'
import json,sys
code=sys.argv[1]
d=json.load(open("/tmp/orch-msg.json")) if code!="000" else {}
err=d.get("error")
em=("%s:%s"%(err.get("code"), (err.get("message") or "")[:80])) if isinstance(err, dict) else str(err or "")[:80]
ans=(d.get("answer") or d.get("content") or "")
model=d.get("model") or (d.get("data") or {}).get("model")
print("HTTP %s model=%s answer_len=%s err=%s" % (code, model, len(str(ans)), em or "-"))
print("answer_head=%s" % str(ans)[:160].replace("\n"," "))
sys.exit(0 if code=="200" and len(str(ans))>20 else 1)
PY
