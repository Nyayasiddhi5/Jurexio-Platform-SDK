#!/usr/bin/env bash
# Inspect orchestrate response shape only (no secret/body dump).
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
print("HTTP", code)
d=json.load(open("/tmp/orch-msg.json"))
print("top_keys", sorted(d.keys()))
def slen(v):
    if isinstance(v, str): return len(v)
    if v is None: return 0
    return "type="+type(v).__name__
for k in ("success","model","provider","answer","content","output","result","text","error"):
    if k in d:
        print(f"  {k}={slen(d[k]) if k not in ('success','model','provider') else d[k]}")
data=d.get("data")
if isinstance(data, dict):
    print("data_keys", sorted(data.keys())[:30])
    for k in ("answer","content","output","result","text","model","provider"):
        if k in data:
            print(f"  data.{k}={slen(data[k]) if k not in ('model','provider') else data[k]}")
elif data is not None:
    print("data_type", type(data).__name__, "len", slen(data) if isinstance(data,str) else "-")
# outcome envelope
for k in ("outcome","curated","final","response"):
    v=d.get(k)
    if isinstance(v, dict):
        print(k+"_keys", sorted(v.keys())[:20])
        for sk in ("answer","content","output","text","summary"):
            if sk in v and isinstance(v[sk], str):
                print(f"  {k}.{sk}_len={len(v[sk])}")
print("bytes", open("/tmp/orch-msg.json").seek(0) or __import__("os").path.getsize("/tmp/orch-msg.json"))
PY
