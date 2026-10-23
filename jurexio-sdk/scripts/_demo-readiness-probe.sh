#!/usr/bin/env bash
# Demo readiness probe — runs ON jrx-prod EC2. Never echo secret values.
set -uo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
API="https://api.jurexio.com"
NSPK=$(grep -E '^JRX_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n"'"'"')
if [ "$(printf %s "$NSPK" | wc -c)" -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi

echo "=== ROUTING ENV (redacted) ==="
grep -E '^(JRX_PARTNER_LEGAL_PREMIUM_FIRST|JRX_LLM_CASCADE_LEAD|JRX_PARTNER_LEGAL_PREMIUM_MODELS|JRX_LLM_CASCADE_GEMINI|JRX_GEMINI_STT_MODEL|JRX_GEMINI_FLASH_MODEL|JRX_ROUTER_BEDROCK_FIRST|JRX_BEDROCK_ENABLED|JRX_DEMO_WEEK_QUALITY_UNT)=' "$CANON" | sed 's/=.*/=<set>/'

echo "=== KEY PRESENCE (len only) ==="
python3 - <<'PY'
canon = "/opt/Jurexio/secrets/.env.production"
keys = ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY","OPENROUTER_API_KEY","DEEPGRAM_API_KEY","JRX_DEEPGRAM_API_KEY","TAVILY_API_KEY","SERPER_API_KEY","AWS_BEARER_TOKEN_BEDROCK_US_EAST_1","JRX_SDK_KEY_NSP"]
vals = {}
for line in open(canon, encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, v = line.split("=", 1)
    k, v = k.strip(), v.strip().strip('"').strip("'")
    if k in keys and k not in vals and v: vals[k] = v
for k in keys:
    v = vals.get(k, "")
    print(f"  {k:<42} present={'yes' if v else 'no':<4} len={len(v) if v else 0}")
PY

echo "=== GATEWAY CONTAINER ENV ==="
docker exec jrx-gateway printenv JRX_PARTNER_LEGAL_PREMIUM_FIRST JRX_LLM_CASCADE_LEAD JRX_GEMINI_STT_MODEL JRX_GEMINI_FLASH_MODEL 2>/dev/null | sed 's/=global\.anthropic\.claude-sonnet-5,.*/=<cascade-lead-set>/; s/=gemini-3\.7-flash,.*/=<gemini-cascade>/; s/=gemini-3\.7-flash$/=<gemini-3.7-flash>/' || echo "  gateway_unavailable"

echo "=== DEPLOY ==="
cat /opt/Jurexio/CURRENT_DEPLOY 2>/dev/null || true
docker inspect jrx-gateway --format 'gateway_image={{.Config.Image}} restarts={{.RestartCount}} started={{.State.StartedAt}}' 2>/dev/null || true

echo "=== HEALTH ==="
curl -sS -m 15 -o /tmp/h.json -w "platform_health http=%{http_code}\n" "$API/api/jrx/health"
python3 -c "import json;d=json.load(open('/tmp/h.json')); print('  agents=', d.get('totalAgents'), 'version=', d.get('version'), 'llm_configured=', d.get('services',{}).get('llm_providers',{}).get('configuredProviders'))"

echo "=== MODEL REGISTRY ==="
curl -sS -m 30 -o /tmp/models.json -w "models http=%{http_code}\n" -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" "$API/api/jrx/models"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/models.json'))
    models = d.get('data') or d.get('models') or d
    if isinstance(models, list):
        print('  count=', len(models), 'sample=', [(m.get('id') if isinstance(m,dict) else m) for m in models[:6]])
    elif isinstance(models, dict):
        print('  keys=', list(models.keys())[:10])
    else:
        print('  body_keys=', list(d.keys())[:10])
except Exception as e:
    print('  parse_err', e)
PY

probe_orch() {
  local label="$1" task="$2" prompt="$3"
  echo "=== ORCH: $label ($task) ==="
  curl -sS -m 120 -o "/tmp/${task}.json" -w "http=%{http_code} time=%{time_total}s\n" -X POST -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" -H "Content-Type: application/json" -d "{\"prompt\":\"${prompt}\",\"taskType\":\"${task}\",\"jurisdiction\":\"IN\",\"maxTokens\":128}" "$API/api/jrx/orchestrate"
  python3 - "$task" <<'PY'
import json, sys
task = sys.argv[1]
d = json.load(open(f'/tmp/{task}.json'))
data = d.get('data') or d
route = data.get('routing') or {}
print('  model=', data.get('model') or d.get('model'))
print('  provider=', data.get('provider') or d.get('provider'))
print('  isSimulation=', data.get('isSimulation'))
print('  routing.path=', route.get('path') if isinstance(route, dict) else route)
print('  requestPhase=', data.get('requestPhase') or d.get('requestPhase'))
print('  success=', d.get('success'))
print('  content_len=', len(str(data.get('content') or '')))
err = d.get('error') or {}
if err: print('  error=', err.get('code'), str(err.get('message',''))[:100])
PY
}

probe_orch "legal-chat" "legal-chat-fast" "One line: what is anticipatory bail under BNSS?"
probe_orch "legal-draft" "legal-draft-fast" "Draft one sentence for a bail application."
probe_orch "legal-research" "legal_research" "Brief: PMLA anticipatory bail availability."
probe_orch "doc-draft" "doc-draft-fast" "Draft a legal notice for unpaid invoice."

echo "=== GATEWAY TRANSLATE ==="
curl -sS -m 60 -o /tmp/translate.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" -H "Content-Type: application/json" -d '{"text":"Anticipatory bail application","sourceLanguage":"en","targetLanguage":"hi"}' "$API/api/jrx/gateway/translate"
python3 -c "import json;d=json.load(open('/tmp/translate.json')); print('  success=',d.get('success'),'provider=',(d.get('data') or d).get('provider'),'model=',(d.get('data') or d).get('model'))"

echo "=== GATEWAY RESEARCH ==="
curl -sS -m 120 -o /tmp/research.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" -H "Content-Type: application/json" -d '{"query":"Is anticipatory bail available in PMLA?","jurisdiction":"IN"}' "$API/api/jrx/gateway/research/query"
python3 -c "import json;d=json.load(open('/tmp/research.json')); data=d.get('data') or d; print('  success=',d.get('success'),'model=',data.get('model'),'provider=',data.get('provider'))"

echo "=== CNR RESOLVE ==="
curl -sS -m 60 -o /tmp/cnr.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" -H "Content-Type: application/json" -d '{"cnr":"TSWL010000012024","claimEcourts":false}' "$API/api/jrx/v1/sdk/cnr/resolve"
python3 -c "import json;d=json.load(open('/tmp/cnr.json')); data=d.get('data') or d; print('  success=',d.get('success'),'status=',data.get('status') or data.get('analysisStatus'),'keys=',list(data.keys())[:8])"

echo "=== STT PROBE ==="
python3 <<'PY' > /tmp/b64.txt
import struct, wave, base64, math
fr = 16000
n = int(fr * 1.0)
samples = [int(3000 * math.sin(2 * math.pi * 440 * i / fr)) for i in range(n)]
with wave.open('/tmp/stt.wav', 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(fr)
    w.writeframes(struct.pack('<' + 'h' * n, *samples))
print(base64.b64encode(open('/tmp/stt.wav', 'rb').read()).decode())
PY
B64=$(cat /tmp/b64.txt)
for EP in /api/jrx/legal-chat/voice/transcribe /api/jrx/voice/transcribe; do
  echo "--- STT $EP ---"
  curl -sS -m 90 -o /tmp/stt.json -w "http=%{http_code}\n" -X POST -H "X-API-Key: ${NSPK}" -H "Content-Type: application/json" -d "{\"audioBase64\":\"${B64}\",\"language\":\"en-IN\",\"format\":\"wav\"}" "http://127.0.0.1:5000${EP}"
  python3 -c "import json;d=json.load(open('/tmp/stt.json')); t=d.get('transcription') or d.get('data') or d; print('  sim=',t.get('isSimulation'),'prov=',t.get('provider'),'model=',t.get('model'),'text=',str(t.get('text',''))[:80])"
done

echo "=== RECENT LOGS (15m) ==="
docker logs jrx-gateway --since 15m 2>&1 | grep -iE 'gemini_stt|openrouter.whisper|whisper_api|nv_stt_service_init|legal-draft-fast|legal-chat-fast|cascade' | tail -15 || true

echo "=== DEMO READINESS PROBE COMPLETE ==="
