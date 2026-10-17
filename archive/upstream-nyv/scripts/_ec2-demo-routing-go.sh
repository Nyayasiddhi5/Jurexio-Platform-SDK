#!/usr/bin/env bash
# NV-DEMO-ROUTING-GO-001 — audit keys (len only), probe models, patch demo cascade, smoke tasks.
# Keys conclusion method: canonical EC2 .env + gateway container env + runtime probes — NOT grep alone.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK_US_EAST_1=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
[ -z "$TOKEN" ] && TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')

echo "=== KEY AUDIT (presence + len only) ==="
python3 - <<'PY'
import os
canon = "/opt/Nyayavigya/secrets/.env.production"
keys = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK_US_EAST_1",
  "NYV_SDK_KEY_NSP", "NYV_SARVAM_API_KEY", "OPENROUTER_API_KEY",
]
vals = {}
for line in open(canon, encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k, v = k.strip(), v.strip().strip('"').strip("'")
    if k in keys and k not in vals and v:
        vals[k] = v
for k in keys:
    v = vals.get(k, "")
    print(f"  {k:<42} present={'yes' if v else 'no':<4} len={len(v) if v else 0}")
PY

echo "=== CONFIG BEFORE (routing keys only) ==="
grep -E '^(NYV_PARTNER_LEGAL_PREMIUM_FIRST|NYV_LLM_CASCADE_LEAD|NYV_PARTNER_LEGAL_PREMIUM_MODELS|NYV_LLM_CASCADE_GEMINI|NYV_GEMINI_STT_MODEL|NYV_GEMINI_FLASH_MODEL)=' "$CANON" \
  | sed 's/=.*/=<set>/'

echo "=== GATEWAY CONTAINER ENV (routing keys) ==="
docker exec nyv-gateway printenv NYV_PARTNER_LEGAL_PREMIUM_FIRST NYV_LLM_CASCADE_LEAD NYV_GEMINI_STT_MODEL 2>/dev/null \
  | sed 's/=.*,global/=<lead-truncated>/; s/=gemini.*/=<gemini>/' || echo "  gateway unavailable"

echo "=== BEDROCK PROBE (200-OK only for cascade) ==="
PASS_BR=()
for M in \
  global.anthropic.claude-sonnet-5 \
  us.anthropic.claude-opus-5 \
  global.anthropic.claude-opus-5 \
  global.anthropic.claude-sonnet-4-6 \
  global.anthropic.claude-opus-4-6-v1 \
  deepseek.v3.2
do
  CODE=$(curl -sS -m 25 -o /tmp/br.json -w '%{http_code}' \
    -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d '{"anthropic_version":"bedrock-2023-05-31","max_tokens":8,"messages":[{"role":"user","content":"Reply OK"}]}' \
    "https://bedrock-runtime.us-east-1.amazonaws.com/model/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$M'))")/invoke" || echo 000)
  echo "  $M HTTP $CODE"
  [ "$CODE" = "200" ] && PASS_BR+=("$M")
done

echo "=== GEMINI PROBE ==="
PASS_GM=()
for M in gemini-3.7-flash gemini-3-1-pro-preview; do
  CODE=$(curl -sS -m 30 -o /tmp/gm.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"Reply OK"}]}],"generationConfig":{"maxOutputTokens":8}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${GK}" || echo 000)
  echo "  $M HTTP $CODE"
  [ "$CODE" = "200" ] && PASS_GM+=("$M")
done

echo "=== APPLY DEMO CASCADE PATCH ==="
BACKUP="${CANON}.demo-routing-backup-${STAMP}"
cp "$CANON" "$BACKUP"
echo "backup=$BACKUP"
patch_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$CANON"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$CANON"
  else
    echo "${key}=${val}" >> "$CANON"
  fi
}
patch_kv NYV_PARTNER_LEGAL_PREMIUM_FIRST 0
patch_kv NYV_ROUTER_BEDROCK_FIRST on
patch_kv NYV_BEDROCK_ENABLED on
patch_kv NYV_LLM_OPENROUTER_FREE_FIRST off
patch_kv NYV_LADDER_COST_FIRST 0
patch_kv NYV_LLM_CASCADE_LEAD 'us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,global.anthropic.claude-sonnet-4-6,global.anthropic.claude-opus-4-6-v1,deepseek.v3.2,us.deepseek.r1-v1:0'
patch_kv NYV_PARTNER_LEGAL_PREMIUM_MODELS 'us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,gemini-3.7-flash,gemini-3-1-pro-preview'
patch_kv NYV_LLM_CASCADE_GEMINI 'gemini-3.7-flash,gemini-3-1-pro-preview,gemini-3-flash-preview,gemini-3.1-flash-lite'
patch_kv NYV_GEMINI_FLASH_MODEL gemini-3.7-flash
patch_kv NYV_GEMINI_STT_MODEL gemini-3.7-flash
patch_kv NYV_DEMO_WEEK_QUALITY_UNTIL '2026-08-27T23:59:59Z'

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [ -n "$LIVE" ] && [ -d "$LIVE" ]; then
  cp "$CANON" "$LIVE/.env"
  echo "synced canonical -> $LIVE/.env"
fi

echo "=== RECREATE GATEWAY (env_file reload) ==="
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
if [ -n "$LIVE" ] && [ -f "$LIVE/docker-compose.aws-dev.yml" ]; then
  cd "$LIVE"
  docker compose -f docker-compose.aws-dev.yml up -d gateway 2>&1 | tail -5
else
  DRAIN="${NYV_GATEWAY_DRAIN_SEC:-30}"
  docker stop -t "$DRAIN" nyv-gateway 2>/dev/null || true
  docker start nyv-gateway 2>/dev/null || true
fi
sleep 10
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_attempt_$i=$code"
  [ "$code" = "200" ] && break
  sleep 4
done

echo "=== GATEWAY ENV AFTER RECREATE ==="
docker exec nyv-gateway printenv NYV_LLM_CASCADE_LEAD NYV_LLM_CASCADE_GEMINI NYV_PARTNER_LEGAL_PREMIUM_MODELS NYV_GEMINI_STT_MODEL 2>/dev/null \
  | sed 's/=global\.anthropic\.claude-sonnet-5,.*/=<cascade-lead-set>/; s/=gemini-3\.7-flash,.*/=<gemini-cascade-set>/; s/=gemini-3\.7-flash$/=<gemini-3.7-flash>/'

echo "=== CONFIG AFTER ==="
grep -E '^(NYV_PARTNER_LEGAL_PREMIUM_FIRST|NYV_LLM_CASCADE_LEAD|NYV_PARTNER_LEGAL_PREMIUM_MODELS|NYV_LLM_CASCADE_GEMINI|NYV_GEMINI_STT_MODEL)=' "$CANON" \
  | sed 's/=.*/=<set>/'

echo "=== STT SMOKE ==="
python3 <<'PY' > /tmp/b64.txt
import struct, wave, base64, math
fr = 16000
n = int(fr * 0.5)
samples = [int(3000 * math.sin(2 * math.pi * 440 * i / fr)) for i in range(n)]
with wave.open('/tmp/stt.wav', 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(fr)
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
d = json.load(open('/tmp/stt.json'))
t = d.get('transcription') or d.get('data') or {}
print('STT', 'HTTP', sys.argv[1], 'sim=', t.get('isSimulation'), 'prov=', t.get('provider'), 'model=', t.get('model'))
PY

echo "=== ORCHESTRATE SMOKE (legal-chat-fast) ==="
CODE=$(curl -sS -o /tmp/orch-chat.json -w '%{http_code}' -m 120 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"prompt":"One line: what is anticipatory bail under BNSS?","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":128}' \
  http://127.0.0.1:5000/api/jrx/orchestrate || echo 000)
python3 - "$CODE" <<'PY'
import json, sys
d = json.load(open('/tmp/orch-chat.json'))
data = d.get('data') or d
print('CHAT HTTP', sys.argv[1], 'model=', data.get('model') or d.get('model'), 'provider=', data.get('provider') or d.get('provider'), 'sim=', data.get('isSimulation'), 'success=', d.get('success'))
PY

echo "=== ORCHESTRATE SMOKE (legal-draft-fast) ==="
CODE=$(curl -sS -o /tmp/orch-draft.json -w '%{http_code}' -m 120 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"prompt":"Draft one sentence for a bail application.","taskType":"legal-draft-fast","jurisdiction":"IN","maxTokens":128}' \
  http://127.0.0.1:5000/api/jrx/orchestrate || echo 000)
python3 - "$CODE" <<'PY'
import json, sys
d = json.load(open('/tmp/orch-draft.json'))
data = d.get('data') or d
print('DRAFT HTTP', sys.argv[1], 'model=', data.get('model') or d.get('model'), 'provider=', data.get('provider') or d.get('provider'), 'sim=', data.get('isSimulation'), 'success=', d.get('success'))
PY

echo "=== DEMO ROUTING GO COMPLETE $STAMP ==="
