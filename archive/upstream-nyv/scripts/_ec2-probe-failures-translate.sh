#!/usr/bin/env bash
# Probe counsel-grade failures + translate on nysdev (read-only except env patch when GO).
set -euo pipefail
ENV_FILE="${NYV_ENV_FILE:-/opt/Nyayavigya/secrets/.env.production}"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" | cut -d= -f2-)"
API='http://127.0.0.1:5000'
HDR=(-H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json")

echo "=== env language/cascade ==="
docker exec nyv-gateway printenv NYV_LANGUAGE_PROVIDER NYV_GEMINI_LANGUAGE_MODEL NYV_LLM_TIMEOUT_MS 2>/dev/null | sort || true
docker exec nyv-gateway sh -c 'test -n "$SARVAM_API_KEY" && echo SARVAM_KEY=set || echo SARVAM_KEY=unset'

echo "=== translate smoke ==="
curl -sS -m 60 -o /tmp/tr.json -w 'translate_http=%{http_code}\n' -X POST "${HDR[@]}" \
  -d '{"text":"Anticipatory bail application","sourceLanguage":"en","targetLanguage":"hi"}' \
  "$API/api/jrx/gateway/translate"
python3 <<'PY'
import json
d=json.load(open('/tmp/tr.json'))
data=d.get('data') or d
print('provider=', data.get('provider'))
meta=data.get('metadata') or {}
print('model=', meta.get('model'))
print('translated_len=', len(str(data.get('translatedText') or '')))
PY

echo "=== analysis-msa-risk (full harness body) ==="
python3 <<'PY' > /tmp/msa-body.json
import json
body={
  "taskType":"analysis",
  "jurisdiction":"IN",
  "tier":"pro",
  "prompt":"Analyse the risk allocation in this clause set and identify every obligation, risk and deadline.\n\nCLAUSE 11.2 (INDEMNITY): The Supplier shall indemnify, defend and hold harmless the Customer against all claims, losses and damages arising out of or in connection with the Services, without limitation.\n\nCLAUSE 12.1 (LIABILITY CAP): Notwithstanding anything to the contrary, the aggregate liability of either party shall not exceed the fees paid in the twelve months preceding the claim.\n\nCLAUSE 14.1 (TERMINATION): The Customer may terminate this Agreement for convenience upon thirty (30) days written notice.\n\nCLAUSE 18 (GOVERNING LAW): This Agreement is governed by the laws of India and the courts at Bengaluru shall have exclusive jurisdiction.\n\nCLAUSE 6.3 (RENEWAL): This Agreement renews automatically unless either party gives notice ninety (90) days before the end of the initial term."
}
print(json.dumps(body))
PY
curl -sS -m 180 -o /tmp/msa.json -w 'msa_http=%{http_code} time=%{time_total}\n' -X POST "${HDR[@]}" -d @/tmp/msa-body.json "$API/api/jrx/orchestrate"
python3 <<'PY'
import json
d=json.load(open('/tmp/msa.json'))
c=str(d.get('content') or d.get('response') or '')
print('chars=', len(c))
print('model=', d.get('model'))
print('provider=', d.get('provider'))
print('preview=', c[:400].replace('\n',' '))
PY

echo "=== research-section-138 (authority probe) ==="
python3 <<'PY' > /tmp/138-body.json
import json
print(json.dumps({
  "taskType":"legal_research",
  "jurisdiction":"IN",
  "tier":"pro",
  "prompt":"What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases."
}))
PY
curl -sS -m 180 -o /tmp/138.json -w '138_http=%{http_code} time=%{time_total}\n' -X POST "${HDR[@]}" -d @/tmp/138-body.json "$API/api/jrx/orchestrate"
python3 <<'PY'
import json,re
d=json.load(open('/tmp/138.json'))
c=str(d.get('content') or '')
print('chars=', len(c))
reporters=re.findall(r'\(\d{4}\)\s*\d+\s+SCC|\d+\s+SCC\s+\d+|AIR\s+\d{4}', c)
print('reporter_hits=', len(reporters), reporters[:5])
print('model=', d.get('model'))
PY
