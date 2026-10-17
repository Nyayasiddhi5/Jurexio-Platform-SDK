#!/usr/bin/env bash
# EC2 P0 fix — seed demo user, fix sentry shape, ensure SDK keys in env.
# Never echoes secret values.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DEMO_PW="${NV_DEMO_PASSWORD:-demo123!demo123}"

append_env_if_missing() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$CANON"; then
    echo "  $key already present — skipping append"
  else
    printf '%s=%s\n' "$key" "$val" >> "$CANON"
    echo "  appended $key"
  fi
}

echo "=== [1] ensure NV_DEMO_PASSWORD in canonical env ==="
if grep -qE '^NV_DEMO_PASSWORD=.+' "$CANON"; then
  pwlen=$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | wc -c | tr -d ' ')
  echo "  NV_DEMO_PASSWORD already set (len~$pwlen)"
else
  append_env_if_missing "NV_DEMO_PASSWORD" "$DEMO_PW"
fi

echo "=== [2] fix invalid Sentry DSN (comment out to restore healthy rollup) ==="
if grep -qE '^(NYV_SENTRY_DSN|SENTRY_DSN)=' "$CANON"; then
  dsn=$(grep -E '^(NYV_SENTRY_DSN|SENTRY_DSN)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" || true)
  case "$dsn" in
    https://*@sentry.io/*) echo "  sentry dsn valid — no change" ;;
    *)
      sed -i.bak-p0sentry 's/^\(NYV_SENTRY_DSN=\)/# \1/; s/^\(SENTRY_DSN=\)/# \1/' "$CANON"
      echo "  commented invalid sentry dsn (backup .bak-p0sentry)"
      ;;
  esac
else
  echo "  no sentry dsn — ok"
fi

echo "=== [3] overlay canonical env into gateway before seed ==="
LIVE_DIR=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  if [ -f "${p}package.json" ] && [ -d "${p}src" ] && [ -d "${p}scripts" ]; then
    LIVE_DIR="${p%/}"
    break
  fi
done
if [ -n "$LIVE_DIR" ]; then
  cp "$CANON" "$LIVE_DIR/.env"
  echo "  overlaid .env to $LIVE_DIR"
fi
docker cp "$CANON" nyv-gateway:/app/.env 2>/dev/null || true

echo "=== [4] seed demo users (DATABASE_URL_ADMIN for RLS bypass) ==="
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" )"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" )"
NODE_ENV_VAL="$(grep -E '^NODE_ENV=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" )"
NODE_ENV_VAL="${NODE_ENV_VAL:-production}"
docker exec \
  -e "NV_DEMO_PASSWORD=${NV_DEMO_PW}" \
  -e "DATABASE_URL=${DB_ADMIN}" \
  -e "NODE_ENV=${NODE_ENV_VAL}" \
  -w /app nyv-gateway \
  npx tsx scripts/jrx-seed-users.ts 2>&1 | sed 's/[Pp]assword[^ ]*/password=<redacted>/g'

echo "=== [5] refresh SDK keys if any NYV_SDK_KEY_* missing ==="
missing=0
for sku in NSP NSPM NSI NSA NSM NYM JRX; do
  if ! grep -qE "^NYV_SDK_KEY_${sku}=.+" "$CANON"; then
    missing=$((missing + 1))
  fi
done
if [ "$missing" -gt 0 ]; then
  echo "  $missing SDK keys missing — running nv-refresh-demo-sdk-bundle.ts"
  docker exec \
    -e "DATABASE_URL=${DB_ADMIN}" \
    -e "NYV_PLATFORM_ENV=production" \
    -w /app nyv-gateway \
    npx tsx scripts/jrx-refresh-demo-sdk-bundle.ts \
    2>&1 | grep -E '^(✓|→|WARN|ERROR|app:|key written|deactivated|bundle|Platform)' || true
  # Merge new keys from bundle output into canonical env (machine-readable json in container)
  BUNDLE=$(docker exec nyv-gateway sh -c 'ls -t /app/.local/run/sdk-bundle-demo-production-*.json 2>/dev/null | head -1' || true)
  if [ -n "$BUNDLE" ]; then
    docker exec nyv-gateway cat "$BUNDLE" > /tmp/sdk-bundle-p0.json
    python3 - /tmp/sdk-bundle-p0.json "$CANON" <<'PY'
import json, pathlib, sys
bundle = json.loads(pathlib.Path(sys.argv[1]).read_text())
env_path = pathlib.Path(sys.argv[2])
lines = env_path.read_text().splitlines()
existing = {l.split('=',1)[0] for l in lines if '=' in l and not l.strip().startswith('#')}
added = []
for entry in bundle.get('keys', []):
    var = entry.get('envVar') or entry.get('env_var')
    val = entry.get('rawKey') or entry.get('raw_key')
    if var and val and var not in existing:
        lines.append(f'{var}={val}')
        added.append(var)
pathlib.Path(env_path).write_text('\n'.join(lines) + ('\n' if lines else ''))
print('  merged keys:', ', '.join(added) if added else '(none new)')
PY
    rm -f /tmp/sdk-bundle-p0.json
  else
    echo "  WARN: no bundle json found after refresh"
  fi
else
  echo "  all 7 SDK keys present"
fi

echo "=== [6] overlay .env + restart gateway ==="
if [ -n "$LIVE_DIR" ] && [ -f "$LIVE_DIR/docker-compose.aws-dev.yml" ]; then
  cp "$CANON" "$LIVE_DIR/.env"
  cd "$LIVE_DIR"
  docker stop nyv-gateway 2>/dev/null || true
  docker rm nyv-gateway 2>/dev/null || true
  docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
  echo "  gateway recreated with updated env"
else
  # Fallback: restart with env-file injection
  docker stop nyv-gateway 2>/dev/null || true
  docker rm nyv-gateway 2>/dev/null || true
  DEPLOY_ROOT=$(find /opt/Nyayavigya/repo -maxdepth 2 -name docker-compose.aws-dev.yml 2>/dev/null | head -1)
  if [ -n "$DEPLOY_ROOT" ]; then
    cd "$(dirname "$DEPLOY_ROOT")"
    cp "$CANON" .env
    docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
    echo "  gateway recreated via compose root"
  else
    echo "  WARN: could not find compose root — manual restart needed"
  fi
fi

echo "=== [7] restart console (nginx upstream refresh) ==="
COMPOSE_DIR="$LIVE_DIR"
if [ -z "$COMPOSE_DIR" ] || [ ! -f "$COMPOSE_DIR/docker-compose.aws-dev.yml" ]; then
  COMPOSE_DIR="$(dirname "$(find /opt/Nyayavigya/repo -maxdepth 3 -name docker-compose.aws-dev.yml 2>/dev/null | head -1)")"
fi
if [ -f "$COMPOSE_DIR/docker-compose.aws-dev.yml" ]; then
  cd "$COMPOSE_DIR"
  docker compose -f docker-compose.aws-dev.yml build console 2>/dev/null || true
  docker compose -f docker-compose.aws-dev.yml up -d --no-deps console 2>/dev/null || \
    docker compose -f docker-compose.aws-dev.yml restart console 2>/dev/null || true
  echo "  console rebuilt/restarted"
fi

echo "=== [8] wait for gateway health ==="
for i in $(seq 1 24); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)
  if [ "$code" = "200" ]; then echo "  gateway healthy after $((i*5))s"; break; fi
  sleep 5
done

echo "=== [9] verify login (no password in output) ==="
LOGIN_CODE=$(curl -sS -o /tmp/login-p0.json -w '%{http_code}' -m 15 \
  -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" || echo 000)
echo "  login HTTP $LOGIN_CODE"

echo "=== [10] health/full status ==="
curl -sS http://127.0.0.1:5000/api/jrx/health/full | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  overall:', d.get('status'))
for k,v in (d.get('services') or {}).items():
    if v.get('status') not in ('healthy','not_configured'):
        print(f'  {k}: {v.get(\"status\")}')
"

echo "=== DONE ==="
