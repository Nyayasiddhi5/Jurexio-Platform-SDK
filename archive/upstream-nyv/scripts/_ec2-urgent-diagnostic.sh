#!/usr/bin/env bash
# Urgent NSP/NYM demo diagnostic — runs ON nysdev EC2. NV-SECRETS-001: never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

echo "=== DISK ==="
df -h / /opt 2>/dev/null | tail -3
echo "docker_root=$(docker info 2>/dev/null | grep 'Docker Root Dir' || echo unknown)"

echo "=== DEPLOY ==="
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "LAST_GOOD=$(cat /opt/nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"
LIVE=$(ls -dt /opt/nyayavigya/repo/* 2>/dev/null | head -1 || true)
echo "LIVE=$LIVE"
if [ -n "$LIVE" ]; then
  echo "live_env_bytes=$(wc -c < "$LIVE/.env" 2>/dev/null | tr -d ' ' || echo 0)"
  echo "live_env_key_count=$(grep -cE '^[A-Z_]+=' "$LIVE/.env" 2>/dev/null || echo 0)"
fi

echo "=== CANON ENV LENS ==="
if [ -f "$CANON" ]; then
  echo "canon_bytes=$(wc -c < "$CANON" | tr -d ' ')"
  echo "canon_mtime=$(stat -c %y "$CANON" 2>/dev/null || stat -f %Sm "$CANON" 2>/dev/null || echo unknown)"
  echo "sdk_key_lines=$(grep -cE '^NYV_SDK_KEY_' "$CANON" 2>/dev/null || echo 0)"
  for k in NYV_SDK_KEY_NSP NYV_SDK_KEY_NYM NYV_SDK_KEY_NSI NYV_SDK_KEY_NSA NYV_SDK_KEY_NSM NYV_SDK_KEY_NSPM NYV_SDK_KEY_JRX; do
    len=$(grep -E "^${k}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
    echo "${k}_len=$len"
  done
  for k in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY BEDROCK AWS_ACCESS_KEY_ID OPENROUTER_API_KEY SARVAM_API_KEY DEEPGRAM_API_KEY; do
    len=$(grep -E "^${k}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | wc -c | tr -d ' ')
    echo "${k}_len=$len"
  done
else
  echo "CANON_MISSING=yes"
fi

echo "=== ENV BACKUPS ==="
ls -la /opt/Nyayavigya/secrets/ 2>/dev/null || echo secrets_dir_missing
for f in /opt/Nyayavigya/secrets/.env.production.bak /opt/Nyayavigya/secrets/.env.production.backup /opt/Nyayavigya/secrets/LAST_GOOD.env /opt/Nyayavigya/secrets/.env.production.*; do
  [ -f "$f" ] && echo "backup $f bytes=$(wc -c < "$f" | tr -d ' ') mtime=$(stat -c %y "$f" 2>/dev/null || stat -f %Sm "$f" 2>/dev/null || echo unknown)"
done

echo "=== DOCKER CONTAINERS ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -10
docker inspect nyv-gateway --format 'gateway_status={{.State.Status}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || echo gateway_missing

echo "=== GATEWAY ENV LENS (docker exec) ==="
for k in NYV_SDK_KEY_NSP NYV_SDK_KEY_NYM OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY OPENROUTER_API_KEY DATABASE_URL NYV_REDIS_TCP_URL; do
  len=$(docker exec nyv-gateway printenv "$k" 2>/dev/null | wc -c | tr -d ' ' || echo 0)
  echo "container_${k}_len=$len"
done

echo "=== COMPOSE ENV OVERLAY ==="
if [ -n "$LIVE" ] && [ -f "$LIVE/docker-compose.aws-dev.yml" ]; then
  grep -A2 'env_file' "$LIVE/docker-compose.aws-dev.yml" | head -6
fi
echo "live_dotenv_link=$(readlink -f "$LIVE/.env" 2>/dev/null || echo not_a_link)"

echo "=== HEALTH ==="
curl -sS -o /dev/null -w 'health_public http=%{http_code} time=%{time_total}s\n' --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo health_ERR

NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\n"'"'"'')
if [ "$(printf %s "$NSPK" | wc -c | tr -d ' ')" -gt 16 ]; then
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d '{"prompt":"One line anticipatory bail","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":64}' \
    "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    route = data.get("routing") or {}
    err = d.get("error") or {}
    print(f"ORCH legal-chat-fast http={code} success={d.get('success')} content_len={len(str(data.get('content') or ''))} err_code={err.get('code')} err_msg={str(err.get('message') or '')[:120]}")
except Exception as e:
    raw = open(path).read()[:200]
    print(f"ORCH legal-chat-fast http={code} parse_err={e} raw={raw}")
PY
  rm -f "$tmp"
else
  echo "ORCH_SKIP=no_nsp_key"
fi

echo "=== GATEWAY LOGS 2h (errors/orchestrate/502/503/cascade) ==="
docker logs nyv-gateway --since 2h 2>&1 | grep -iE 'orchestrat|cascade|exhaust|502|503|401|403|QUALITY_ENVELOPE|LLM|provider|agentzero|ECONNREFUSED|ETIMEDOUT|fatal|Unhandled|"level":"error"' | grep -v '"statusCode":200' | tail -50 || echo gateway_log_clean

echo "=== PRUNE HISTORY (journal/docker events) ==="
journalctl --since "24 hours ago" 2>/dev/null | grep -iE 'prune|docker system|removed' | tail -15 || echo no_journal_prune_entries
docker system df 2>/dev/null || true

echo "=== DIAG COMPLETE ==="
