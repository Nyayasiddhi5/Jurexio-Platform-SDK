#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
LIVE=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  [ -f "${p}docker-compose.aws-dev.yml" ] && LIVE="${p%/}" && break
done
BUNDLE=$(docker exec nyv-gateway sh -c 'ls -t /app/.local/run/sdk-bundle-demo-production-*.json 2>/dev/null | head -1')
docker exec nyv-gateway cat "$BUNDLE" > /tmp/sdk-bundle-rotate.json
python3 - /tmp/sdk-bundle-rotate.json "$CANON" <<'PY'
import json, pathlib, re, sys
bundle = json.loads(pathlib.Path(sys.argv[1]).read_text())
env_path = pathlib.Path(sys.argv[2])
lines = [l for l in env_path.read_text().splitlines() if not re.match(r'^NYV_SDK_KEY_', l)]
for entry in bundle.get('platforms', bundle.get('keys', [])):
    var = entry.get('envVar')
    val = entry.get('rawKey')
    if var and val:
        lines.append(f'{var}={val}')
        print(f'  merged {var}')
env_path.write_text('\n'.join(lines) + '\n')
PY
cp "$CANON" "$LIVE/.env"
cd "$LIVE"
docker stop nyv-gateway && docker rm nyv-gateway
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
sleep 20
[ -f "$LIVE/src/db/jrx-auth-db.ts" ] && docker cp "$LIVE/src/db/jrx-auth-db.ts" nyv-gateway:/app/src/db/jrx-auth-db.ts
[ -f "$LIVE/src/routes/jrx-auth-routes.ts" ] && docker cp "$LIVE/src/routes/jrx-auth-routes.ts" nyv-gateway:/app/src/routes/jrx-auth-routes.ts
docker restart nyv-gateway && sleep 20
KEY=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
code=$(curl -sS -o /dev/null -w '%{http_code}' -m 30 -H "X-API-Key: ${KEY}" https://api.nyayasiddhi.online/api/jrx/gateway/health)
echo "NSP gateway/health HTTP $code"
