#!/usr/bin/env bash
# NV-MODEL-AVAIL-PROBE-001 — which Gemini (and peer) model ids ACTUALLY answer
# on this account? No model may enter the catalog without a live 200 here.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

echo "=== models the Gemini API itself advertises (generateContent-capable) ==="
curl -sS -m 45 "https://generativelanguage.googleapis.com/v1beta/models?key=${GK}&pageSize=200" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=[]
for m in d.get('models',[]):
    if 'generateContent' not in (m.get('supportedGenerationMethods') or []): continue
    n=m.get('name','').replace('models/','')
    if 'embedding' in n or 'aqa' in n: continue
    rows.append((n, m.get('inputTokenLimit'), m.get('outputTokenLimit')))
rows.sort()
for n,i,o in rows:
    print(f'   {n:<50} in={i} out={o}')
print(f'   TOTAL generateContent models = {len(rows)}')
" 2>&1 | tail -80

echo
echo "=== live latency probe: candidate ids (1 short legal question each) ==="
for M in \
  gemini-3.7-flash \
  gemini-3-flash-preview \
  gemini-3-1-pro-preview \
  gemini-3-1-flash-lite-preview \
  gemini-2.5-pro \
  gemini-2.5-flash
do
  S=$(date +%s.%N)
  R=$(curl -sS -m 90 -o /tmp/g.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"In one sentence: what does BNS section 103 punish?"}]}],"generationConfig":{"maxOutputTokens":120}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${GK}")
  E=$(date +%s.%N)
  CH=$(python3 -c "
import json
try:
    d=json.load(open('/tmp/g.json'))
    c=d['candidates'][0]['content']['parts'][0]['text']
    print(len(c))
except Exception as e:
    try:
        print('ERR:'+str(json.load(open('/tmp/g.json')).get('error',{}).get('message',''))[:90])
    except Exception: print('ERR')
" 2>/dev/null)
  python3 -c "print(f'   {\"${M}\":<34} http=${R} {${E}-${S}:6.2f}s chars=${CH}')"
done
