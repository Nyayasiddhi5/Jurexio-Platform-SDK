#!/usr/bin/env bash
set -euo pipefail
ENVF="/opt/Nyayavigya/secrets/.env.production"
if ! grep -qE '^NYV_F_TEXTRACT=' "$ENVF" 2>/dev/null; then
  echo "NYV_F_TEXTRACT=1" >> "$ENVF"
  echo "APPENDED_NYV_F_TEXTRACT=1"
else
  if grep -qE '^NYV_F_TEXTRACT=0' "$ENVF" 2>/dev/null; then
    sed -i 's/^NYV_F_TEXTRACT=0/NYV_F_TEXTRACT=1/' "$ENVF"
    echo "UPDATED_NYV_F_TEXTRACT=0_to_1"
  else
    echo "SKIP_NYV_F_TEXTRACT=already_set"
  fi
fi
grep -E '^NYV_F_TEXTRACT=' "$ENVF" | head -1
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
DEST="/opt/Nyayavigya/repo/${DEP}"
LIVE_DIR="$(find "$DEST" -maxdepth 2 -type d -name 'nyayavigya-platform-312' | head -1)"
[ -n "$LIVE_DIR" ] || LIVE_DIR="$DEST"
cp "$ENVF" "$LIVE_DIR/.env"
cd "$LIVE_DIR"
DRAIN_TIMEOUT="${NYV_DEPLOY_STOP_TIMEOUT:-25}"
docker stop -t "$DRAIN_TIMEOUT" nyv-gateway 2>/dev/null || true
docker rm nyv-gateway 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
for i in $(seq 1 24); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)"
  if [ "$code" = "200" ]; then
    echo "health=${code} after $((i * 5))s"
    exit 0
  fi
  sleep 5
done
echo "health=000 after 120s"
exit 1
