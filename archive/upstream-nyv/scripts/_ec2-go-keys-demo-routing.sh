#!/usr/bin/env bash
# NV-GO-KEYS-DEMO-ROUTING-001 — patch EC2 canonical env (keys + demo cascade), restart gateway, smoke.
# Keys are injected via PATCH_B64 (base64 of key=value lines). Never prints secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${CANON}.backup-${STAMP}"

patch_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$CANON"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$CANON"
  else
    echo "${key}=${val}" >> "$CANON"
  fi
}

echo "=== BACKUP CANONICAL ENV ==="
cp "$CANON" "$BACKUP"
echo "backup_path=$BACKUP"

if [ -n "${PATCH_B64:-}" ]; then
  echo "=== APPLY KEY PATCH (names only logged) ==="
  PATCH_FILE="/tmp/nyv-key-patch-${STAMP}.env"
  echo "$PATCH_B64" | base64 -d > "$PATCH_FILE"
  chmod 600 "$PATCH_FILE"
  python3 - "$PATCH_FILE" "$CANON" <<'PY'
import pathlib, sys
patch = pathlib.Path(sys.argv[1])
canon = pathlib.Path(sys.argv[2])
keys = {}
for line in patch.read_text(encoding='utf-8', errors='replace').splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    keys[k.strip()] = v.strip()
lines = canon.read_text(encoding='utf-8', errors='replace').splitlines()
out = []
seen = set()
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k = line.split('=', 1)[0].strip()
        if k in keys:
            out.append(f"{k}={keys[k]}")
            seen.add(k)
            print(f"  patched {k} len={len(keys[k])}")
            continue
    out.append(line)
for k, v in keys.items():
    if k not in seen:
        out.append(f"{k}={v}")
        print(f"  appended {k} len={len(v)}")
canon.write_text('\n'.join(out) + ('\n' if out else ''), encoding='utf-8')
PY
  rm -f "$PATCH_FILE"
fi

echo "=== KEY AUDIT (presence + len only) ==="
python3 - <<'PY'
import os
canon = "/opt/Nyayavigya/secrets/.env.production"
keys = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEYS",
  "AWS_BEARER_TOKEN_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK_US_EAST_1",
  "AWS_BEARER_TOKEN_BEDROCK_AP_SOUTH_1", "SERPER_API_KEY", "OPENROUTER_API_KEY",
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
    pref = v[:6] + "…" if len(v) > 6 else ("<empty>" if not v else "<short>")
    print(f"  {k:<42} present={'yes' if v else 'no':<4} len={len(v) if v else 0} prefix={pref}")
PY

echo "=== DEMO ROUTING PATCH ==="
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

echo "=== RECREATE GATEWAY ==="
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

echo "=== GATEWAY ENV (routing keys, redacted) ==="
docker exec nyv-gateway printenv NYV_PARTNER_LEGAL_PREMIUM_FIRST NYV_LLM_CASCADE_LEAD NYV_GEMINI_STT_MODEL 2>/dev/null \
  | sed 's/=global\.anthropic\.claude-sonnet-5,.*/=<cascade-lead-set>/; s/=gemini-3\.7-flash$/=<gemini-3.7-flash>/'

NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')

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
print('STT HTTP', sys.argv[1], 'sim=', t.get('isSimulation'), 'prov=', t.get('provider'))
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

echo "=== GO KEYS + DEMO ROUTING COMPLETE $STAMP ==="
