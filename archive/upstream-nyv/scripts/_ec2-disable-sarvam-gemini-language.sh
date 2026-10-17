#!/usr/bin/env bash
# NV-SARVAM-DISABLE-DEMO-001 — keep Sarvam out of LLM cascade + language stack on gemini-3.7-flash.
set -euo pipefail
ENV_FILE="${NYV_ENV_FILE:-/opt/Nyayavigya/secrets/.env.production}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${ENV_FILE}.sarvam-disable-backup-${STAMP}"
cp "$ENV_FILE" "$BACKUP"
echo "backup=$BACKUP"

patch_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

patch_kv NYV_SARVAM_DISABLED 1
patch_kv NYV_LANGUAGE_PROVIDER gemini
patch_kv NYV_GEMINI_LANGUAGE_MODEL gemini-3.7-flash
patch_kv NYV_SARVAM_STT_ENABLED 0
patch_kv NYV_SARVAM_TTS_ENABLED 0
# Immediate cascade skip before NYV_SARVAM_DISABLED ships: blank live keys (backup preserves values).
for _sk in SARVAM_API_KEY NYV_SARVAM_API_KEY; do
  if grep -q "^${_sk}=" "$ENV_FILE"; then
    _val="$(grep -E "^${_sk}=" "$ENV_FILE" | cut -d= -f2-)"
    grep -q "^#NYV_DEMO_SARVAM_BACKUP_${_sk}=" "$ENV_FILE" || echo "#NYV_DEMO_SARVAM_BACKUP_${_sk}=${_val}" >> "$ENV_FILE"
    sed -i "s|^${_sk}=.*|${_sk}=|" "$ENV_FILE"
  fi
done

LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
if [[ -n "$LIVE" && -d "$LIVE" ]]; then
  cp "$ENV_FILE" "$LIVE/.env"
fi

echo "=== env patch diff ==="
diff "$BACKUP" "$ENV_FILE" | grep -E '^[<>].*(SARVAM|LANGUAGE|GEMINI)' || true

DRAIN="${NYV_GATEWAY_DRAIN_SEC:-30}"
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
if [[ -n "$LIVE" && -f "$LIVE/docker-compose.aws-dev.yml" ]]; then
  (cd "$LIVE" && docker compose -f docker-compose.aws-dev.yml up -d gateway) 2>&1 | tail -5
elif docker ps --format '{{.Names}}' | grep -qx nyv-gateway; then
  docker stop -t "$DRAIN" nyv-gateway && docker start nyv-gateway
fi

sleep 8
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_$i=$code"
  [[ "$code" == "200" ]] && break
  sleep 3
done

NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" | cut -d= -f2-)"
curl -sS -m 60 -o /tmp/tr-smoke.json -w 'translate_http=%{http_code}\n' -X POST \
  -H "X-API-Key: $NSPK" -H "Content-Type: application/json" \
  -d '{"text":"Anticipatory bail application","sourceLanguage":"en","targetLanguage":"hi"}' \
  http://127.0.0.1:5000/api/jrx/gateway/translate
python3 -c "import json;d=json.load(open('/tmp/tr-smoke.json')); data=d.get('data') or d; print('provider=',data.get('provider'),'model=',(data.get('metadata') or {}).get('model'))"
docker exec nyv-gateway printenv NYV_SARVAM_DISABLED NYV_LANGUAGE_PROVIDER NYV_GEMINI_LANGUAGE_MODEL 2>/dev/null | sort
echo "=== sarvam disable + gemini language complete ==="
