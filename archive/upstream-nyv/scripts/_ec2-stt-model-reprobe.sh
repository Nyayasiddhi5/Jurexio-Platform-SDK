#!/usr/bin/env bash
# NV-STT-MODEL-REPROBE-001 — Bedrock/Gemini model probe + STT + orchestrate smoke. Never echo secrets.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK_US_EAST_1=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
[ -z "$TOKEN" ] && TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')

echo "=== BEDROCK MODEL PROBE (us-east-1, status only) ==="
for M in \
  global.anthropic.claude-sonnet-5 \
  global.anthropic.claude-sonnet-4-6 \
  global.anthropic.claude-opus-4-6-v1 \
  us.anthropic.claude-opus-5 \
  global.anthropic.claude-opus-4-8 \
  deepseek.v3.2
do
  CODE=$(curl -sS -m 25 -o /tmp/br.json -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"anthropic_version":"bedrock-2023-05-31","max_tokens":8,"messages":[{"role":"user","content":"Reply OK"}]}' \
    "https://bedrock-runtime.us-east-1.amazonaws.com/model/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$M'))")/invoke" || echo 000)
  ERR=$(python3 -c "import json;d=json.load(open('/tmp/br.json')); print(str(d.get('message') or d.get('Message') or d.get('error',''))[:70])" 2>/dev/null || echo parse_err)
  echo "  $M HTTP $CODE ${ERR}"
done

echo "=== GEMINI MODEL PROBE ==="
for M in gemini-3.7-flash gemini-3-1-pro-preview gemini-3.1-pro-preview; do
  CODE=$(curl -sS -m 30 -o /tmp/gm.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"Reply OK"}]}],"generationConfig":{"maxOutputTokens":8}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${GK}" || echo 000)
  MSG=$(python3 -c "import json;d=json.load(open('/tmp/gm.json')); print((d.get('error',{}).get('message') or 'ok')[:70])" 2>/dev/null || echo err)
  echo "  $M HTTP $CODE $MSG"
done

echo "=== STT REPROBE (tone wav, en-IN) ==="
python3 <<'PY' > /tmp/b64.txt
import struct, wave, base64, math
fr = 16000
n = int(fr * 0.5)
samples = [int(3000 * math.sin(2 * math.pi * 440 * i / fr)) for i in range(n)]
with wave.open('/tmp/stt.wav', 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(fr)
    w.writeframes(struct.pack('<' + 'h' * n, *samples))
print(base64.b64encode(open('/tmp/stt.wav', 'rb').read()).decode())
PY
B64=$(cat /tmp/b64.txt)
CODE=$(curl -sS -o /tmp/stt.json -w '%{http_code}' -m 90 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d "{\"audioBase64\":\"${B64}\",\"language\":\"en-IN\",\"format\":\"wav\"}" \
  http://127.0.0.1:5000/api/jrx/voice/transcribe || echo 000)
python3 - "$CODE" <<'PY'
import json, sys
code = sys.argv[1]
try:
    d = json.load(open('/tmp/stt.json'))
except Exception:
    print('HTTP', code, 'parse_fail'); raise SystemExit(0)
t = d.get('transcription') or d.get('data') or {}
print('HTTP', code, 'sim=', t.get('isSimulation'), 'prov=', t.get('provider'), 'text=', str(t.get('text', ''))[:120])
PY

echo "=== ORCHESTRATE SMOKE (legal-chat-fast) ==="
CODE2=$(curl -sS -o /tmp/orch.json -w '%{http_code}' -m 60 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"prompt":"One line: what is bail under Indian law?","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":64}' \
  http://127.0.0.1:5000/api/jrx/orchestrate || echo 000)
python3 - "$CODE2" <<'PY'
import json, sys
code = sys.argv[1]
d = json.load(open('/tmp/orch.json'))
print('HTTP', code, 'model=', d.get('model') or d.get('modelUsed'), 'provider=', d.get('provider'), 'sim=', d.get('isSimulation'))
PY

echo "=== RECENT STT LOGS (10m) ==="
docker logs nyv-gateway --since 10m 2>&1 | grep -iE 'gemini_stt|whisper_api|nv_stt_service_init' | tail -10 || true
