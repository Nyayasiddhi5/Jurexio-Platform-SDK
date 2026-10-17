#!/usr/bin/env bash
# Hot-patch auth RLS fix onto running EC2 gateway (no full SSM deploy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/jrx-source-dev-deploy-env.sh"

encode_file() {
  if base64 -w0 "$1" >/dev/null 2>&1; then base64 -w0 "$1"; else base64 < "$1" | tr -d '\n'; fi
}

AUTH_DB_B64=$(encode_file "$ROOT/src/db/jrx-auth-db.ts")
AUTH_RT_B64=$(encode_file "$ROOT/src/routes/jrx-auth-routes.ts")

read -r -d '' EC2 <<EOF || true
set -euo pipefail
LIVE=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  [ -f "\${p}docker-compose.aws-dev.yml" ] && LIVE="\${p%/}" && break
done
[ -n "\$LIVE" ] || { echo FATAL no live dir; exit 1; }
mkdir -p "\$LIVE/src/db" "\$LIVE/src/routes"
echo '$AUTH_DB_B64' | base64 -d > "\$LIVE/src/db/jrx-auth-db.ts"
echo '$AUTH_RT_B64' | base64 -d > "\$LIVE/src/routes/jrx-auth-routes.ts"
CANON=/opt/Nyayavigya/secrets/.env.production
cp "\$CANON" "\$LIVE/.env"
cd "\$LIVE"
docker stop nyv-gateway 2>/dev/null || true
docker rm nyv-gateway 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
for i in \$(seq 1 24); do
  docker inspect -f '{{.State.Running}}' nyv-gateway 2>/dev/null | grep -q true && break
  sleep 2
done
docker cp "\$LIVE/src/db/jrx-auth-db.ts" nyv-gateway:/app/src/db/jrx-auth-db.ts
docker cp "\$LIVE/src/routes/jrx-auth-routes.ts" nyv-gateway:/app/src/routes/jrx-auth-routes.ts
docker restart nyv-gateway
for i in \$(seq 1 24); do
  code=\$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)
  [ "\$code" = "200" ] && echo gateway healthy && break
  sleep 5
done
CANON=/opt/Nyayavigya/secrets/.env.production
NV_DEMO_PW=\$(grep -E '^NV_DEMO_PASSWORD=' "\$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
LOGIN=\$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 15 -X POST http://127.0.0.1:5000/api/jrx/auth/login \\
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \\
  -d "{\\"email\\":\\"admin@nyayavigya.in\\",\\"password\\":\\"\${NV_DEMO_PW}\\"}" || echo 000)
echo "login HTTP \$LOGIN"
EOF

TMP=$(mktemp)
printf '%s' "$EC2" > "$TMP"
bash "$ROOT/scripts/jrx-ec2-ssm-run.sh" "$TMP" "hotpatch-auth-rls"
rm -f "$TMP"
