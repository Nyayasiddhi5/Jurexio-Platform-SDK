#!/usr/bin/env bash
# NV-OPUS-DRAFT-ROUTING-GO-001 — Opus-first draft cascade; drop dead global.opus-5; smoke tasks.
# Keys: presence + len only. Never prints secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK_US_EAST_1=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')
[ -z "$TOKEN" ] && TOKEN=$(grep -E '^AWS_BEARER_TOKEN_BEDROCK=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r')

CASCADE_LEAD='us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,global.anthropic.claude-sonnet-4-6,global.anthropic.claude-opus-4-6-v1,deepseek.v3.2,us.deepseek.r1-v1:0'
PREMIUM_MODELS='us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8,global.anthropic.claude-sonnet-5,gemini-3.7-flash,gemini-3-1-pro-preview'
GEMINI_CASCADE='gemini-3.7-flash,gemini-3-1-pro-preview,gemini-3-flash-preview,gemini-3.1-flash-lite'

patch_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$CANON"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$CANON"
  else
    echo "${key}=${val}" >> "$CANON"
  fi
}

echo "=== BACKUP CANONICAL ENV ==="
BACKUP="${CANON}.opus-draft-backup-${STAMP}"
cp "$CANON" "$BACKUP"
echo "backup=$BACKUP"

echo "=== CONFIG BEFORE (routing keys) ==="
grep -E '^(NYV_PARTNER_LEGAL_PREMIUM_FIRST|NYV_LLM_CASCADE_LEAD|NYV_PARTNER_LEGAL_PREMIUM_MODELS|NYV_LLM_CASCADE_GEMINI|NYV_LLM_HEDGE_MS)=' "$CANON" \
  | sed 's/=.*/=<set>/'

echo "=== APPLY OPUS DRAFT CASCADE ==="
patch_kv NYV_PARTNER_LEGAL_PREMIUM_FIRST 0
patch_kv NYV_ROUTER_BEDROCK_FIRST on
patch_kv NYV_BEDROCK_ENABLED on
patch_kv NYV_LLM_OPENROUTER_FREE_FIRST off
patch_kv NYV_LADDER_COST_FIRST 0
patch_kv NYV_LLM_CASCADE_LEAD "$CASCADE_LEAD"
patch_kv NYV_PARTNER_LEGAL_PREMIUM_MODELS "$PREMIUM_MODELS"
patch_kv NYV_LLM_CASCADE_GEMINI "$GEMINI_CASCADE"
patch_kv NYV_GEMINI_FLASH_MODEL gemini-3.7-flash
patch_kv NYV_GEMINI_STT_MODEL gemini-3.7-flash
# Belt-and-suspenders until code hedge-skip ships; harmless once code is live.
patch_kv NYV_LLM_HEDGE_MS 0

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [ -n "$LIVE" ] && [ -d "$LIVE" ]; then
  cp "$CANON" "$LIVE/.env"
  echo "synced canonical -> $LIVE/.env"
fi

echo "=== RECREATE GATEWAY ==="
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
if [ -n "$LIVE" ] && [ -f "$LIVE/docker-compose.aws-dev.yml" ]; then
  cd "$LIVE"
  docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway 2>&1 | tail -8
else
  DRAIN="${NYV_GATEWAY_DRAIN_SEC:-30}"
  docker stop -t "$DRAIN" nyv-gateway 2>/dev/null || true
  docker start nyv-gateway 2>/dev/null || true
fi
sleep 12
for i in 1 2 3 4 5 6 7 8 9 10 12 14; do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_attempt_$i=$code"
  [ "$code" = "200" ] && break
  sleep 4
done

echo "=== BEDROCK PROBE ==="
for M in \
  us.anthropic.claude-opus-5 \
  global.anthropic.claude-opus-4-8 \
  global.anthropic.claude-sonnet-5 \
  global.anthropic.claude-sonnet-4-6 \
  global.anthropic.claude-opus-5
do
  CODE=$(curl -sS -m 30 -o /tmp/br-probe.json -w '%{http_code}' \
    -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d '{"anthropic_version":"bedrock-2023-05-31","max_tokens":8,"messages":[{"role":"user","content":"Reply OK"}]}' \
    "https://bedrock-runtime.us-east-1.amazonaws.com/model/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$M'))")/invoke" || echo 000)
  echo "  $M HTTP $CODE"
done

probe_orch() {
  local label="$1" task="$2" prompt="$3" max="${4:-128}"
  CODE=$(curl -sS -o "/tmp/orch-${label}.json" -w '%{http_code}' -m 120 \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"${prompt}\",\"taskType\":\"${task}\",\"jurisdiction\":\"IN\",\"maxTokens\":${max}}" \
    http://127.0.0.1:5000/api/jrx/orchestrate || echo 000)
  python3 - "$label" "$CODE" <<'PY'
import json, sys
label, http = sys.argv[1], sys.argv[2]
d = json.load(open(f"/tmp/orch-{label}.json"))
data = d.get("data") or d
print(
  f"{label.upper():<18} HTTP {http} model={data.get('model') or d.get('model')} "
  f"provider={data.get('provider') or d.get('provider')} sim={data.get('isSimulation')} success={d.get('success')}"
)
PY
}

echo "=== ORCHESTRATE SMOKE ==="
probe_orch legal-chat-fast legal-chat-fast "One line: what is anticipatory bail under BNSS?"
probe_orch legal-draft-fast legal-draft-fast "Draft one sentence for a bail application."
probe_orch legal-research legal_research "One line on Section 482 CrPC scope."
probe_orch legal-draft legal-draft "Draft a one-sentence prayer for bail."
probe_orch doc-draft-fast doc-draft-fast "Draft one sentence notice under Section 138 NI Act."

echo "=== OPUS DRAFT ROUTING GO COMPLETE $STAMP ==="
