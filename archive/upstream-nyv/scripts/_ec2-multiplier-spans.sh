#!/usr/bin/env bash
# NV-MULTIPLIER-SPANS-001 — count REAL LLM generation spans for one request.
# Counting '"model":"x"' occurrences overcounts (trace + hedge lines repeat it).
# Authoritative source = llm.trace spans + hedge branch records.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

BEFORE=$(docker logs --tail 200000 "$GID" 2>&1 | wc -l)
curl -sS -m 240 -o /tmp/s.json \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
  -d '{"prompt":"Explain the anticipatory bail standard under BNSS 482 for economic offences.","jurisdiction":"IN"}' \
  "${API}/api/jrx/orchestrate" >/dev/null
sleep 4
docker logs --tail 200000 "$GID" 2>&1 | tail -n +"$BEFORE" > /tmp/s.log

echo "=== hedge success line (full) ==="
grep 'hedge success' /tmp/s.log | cut -c1-700

echo
echo "=== llm.trace spans: name + model + tokens ==="
python3 - <<'PY'
import json
spans=[]
for line in open('/tmp/s.log'):
    line=line.strip()
    if '"llm.trace"' not in line and '"message":"trace"' not in line: continue
    try: rec=json.loads(line)
    except Exception: continue
    for rs in rec.get('resourceSpans') or []:
        for ss in rs.get('scopeSpans') or []:
            for sp in ss.get('spans') or []:
                a={}
                for at in sp.get('attributes') or []:
                    v=at.get('value') or {}
                    a[at.get('key')]=v.get('stringValue') or v.get('intValue') or v.get('doubleValue') or v.get('boolValue')
                spans.append((sp.get('name'), a))
gen=[s for s in spans if any(k in (s[1] or {}) for k in ('llm.model','gen_ai.request.model','model'))]
print(f"total spans={len(spans)}  spans carrying a model={len(gen)}")
for n,a in gen:
    m=a.get('llm.model') or a.get('gen_ai.request.model') or a.get('model')
    it=a.get('llm.tokens.input') or a.get('gen_ai.usage.input_tokens') or a.get('inputTokens')
    ot=a.get('llm.tokens.output') or a.get('gen_ai.usage.output_tokens') or a.get('outputTokens')
    print(f"  span={n:38.38} model={m} in={it} out={ot}")
names={}
for n,_ in spans: names[n]=names.get(n,0)+1
print("span name histogram:", dict(sorted(names.items(), key=lambda x:-x[1])[:20]))
PY

echo
echo "=== counts of distinct request-scoped LLM markers ==="
for p in 'hedge success' 'hedge start' 'hedge fired' 'llm_call' 'llm.complete' 'generateContent' 'cot' 'maker'; do
  printf '%-18s %s\n' "$p" "$(grep -ci "$p" /tmp/s.log)"
done

echo
echo "=== tier resolved for this SDK key ==="
grep -oE '"tier":"[^"]*"|"userTier":"[^"]*"|"billingTier":"[^"]*"' /tmp/s.log | sort | uniq -c
