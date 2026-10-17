#!/usr/bin/env bash
# Disk cleanup + gateway/console recovery for 2026-09-12T0845Z deploy.
set -euo pipefail

TARGET_DEPLOY="2026-09-12T0845Z-aws-ssm-94bececc"
CANON="/opt/Nyayavigya/secrets/.env.production"
NET="nyayavigya-platform-312_nyv-net"
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312

echo "=== DISK BEFORE ==="
df -h / /opt /var/lib/docker 2>/dev/null | sed 's/^/  /'
echo "docker system df:"
docker system df 2>/dev/null | sed 's/^/  /' || true
echo "repo deploy dirs: $(find /opt/Nyayavigya/repo /opt/nyayavigya/repo -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"

echo "=== PROTECT SECRETS ==="
if [ -f /opt/Nyayavigya/secrets/.env.production ]; then
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  cp -a "$CANON" "/opt/Nyayavigya/secrets/.env.production.snapshot-${STAMP}"
  cp -a "$CANON" "/opt/Nyayavigya/secrets/LAST_GOOD.env"
  echo "  snapshot OK key_count=$(grep -cE '^[A-Z_]+=' "$CANON" 2>/dev/null || echo 0)"
fi

echo "=== PRUNE OLD REPO DIRS (keep 3 newest incl target) ==="
mkdir -p /opt/nyayavigya/archive/repo
KEEP=3
for REPO_ROOT in /opt/Nyayavigya/repo /opt/nyayavigya/repo; do
  [ -d "$REPO_ROOT" ] || continue
  mapfile -t dirs < <(find "$REPO_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r)
  n=${#dirs[@]}
  echo "  $REPO_ROOT: $n dirs"
  if (( n > KEEP )); then
    for ((i=KEEP; i<n; i++)); do
      base=$(basename "${dirs[i]}")
      # never delete target or current
      if [[ "$base" == "$TARGET_DEPLOY" ]] || [[ "$base" == "2026-09-12T0805Z-aws-ssm-21656597" ]]; then
        echo "  skip protected: $base"
        continue
      fi
      echo "  archive+rm: $base"
      tar -czf "/opt/nyayavigya/archive/repo/${base}.tar.gz" -C "$REPO_ROOT" "$base" 2>/dev/null || true
      rm -rf "${dirs[i]}"
    done
  fi
done

echo "=== DOCKER PRUNE (images/containers only — NO volumes) ==="
docker container prune -f 2>/dev/null || true
docker image prune -af 2>/dev/null || true
docker builder prune -af 2>/dev/null || true
# Keep running containers' images; remove dangling only if system prune needed
docker system prune -af --filter "until=24h" 2>/dev/null || true

echo "=== DISK AFTER PRUNE ==="
df -h / /opt /var/lib/docker 2>/dev/null | sed 's/^/  /'
docker system df 2>/dev/null | sed 's/^/  /' || true

LIVE_DIR="/opt/Nyayavigya/repo/${TARGET_DEPLOY}"
[ -d "$LIVE_DIR" ] || LIVE_DIR="/opt/nyayavigya/repo/${TARGET_DEPLOY}"
[ -d "$LIVE_DIR" ] || { echo "FATAL: missing $TARGET_DEPLOY"; ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -5; exit 1; }
cd "$LIVE_DIR"
cp "$CANON" .env

echo "=== GATEWAY RECREATE ==="
DRAIN_TIMEOUT=25
docker stop -t "$DRAIN_TIMEOUT" nyv-gateway 2>/dev/null || true
docker rm nyv-gateway 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway

echo "=== POLL :5000 health (180s) ==="
HEALTH_OK=0
for i in $(seq 1 36); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  body_status=$(curl -sS -m 5 http://127.0.0.1:5000/api/jrx/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), (d.get('services') or {}).get('storage',{}).get('status','?'))" 2>/dev/null || echo "? ?")
  echo "  attempt $i: HTTP $code status=$body_status"
  if [ "$code" = "200" ]; then HEALTH_OK=1; break; fi
  sleep 5
done

echo "=== NETWORK BRIDGE ==="
if docker network inspect "$NET" >/dev/null 2>&1; then
  if ! docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${NET}\""; then
    docker network connect --alias gateway --alias nyv-gateway "$NET" nyv-gateway 2>/dev/null || true
    echo "  bridged"
  fi
fi

echo "=== CONSOLE RECREATE ==="
docker stop nyv-console 2>/dev/null || true
docker rm nyv-console 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps console
sleep 8

echo "=== INGRESS POLL :80 ==="
PROXY_OK=0
for i in $(seq 1 18); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health 2>/dev/null || echo 000)
  echo "  attempt $i: HTTP $code"
  [ "$code" = "200" ] && PROXY_OK=1 && break
  sleep 5
done

echo "=== UPDATE CURRENT_DEPLOY ==="
echo "$TARGET_DEPLOY" > /opt/Nyayavigya/CURRENT_DEPLOY
if [ "$PROXY_OK" = "1" ] && [ "$HEALTH_OK" = "1" ]; then
  echo "$TARGET_DEPLOY" > /opt/Nyayavigya/LAST_GOOD_DEPLOY
fi
echo "$(date -u +%FT%TZ) | DISK-RECOVER-0845 | 94bececc | $LIVE_DIR | gw=$([ "$HEALTH_OK" = "1" ] && echo OK || echo FAIL) ingress=$([ "$PROXY_OK" = "1" ] && echo OK || echo WARN)" >> /opt/Nyayavigya/deploys.log

echo "=== FINAL ==="
echo "CURRENT_DEPLOY=$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
df -h / | tail -1
echo "gateway: $(docker inspect nyv-gateway --format '{{.State.Status}} health={{.State.Health.Status}}' 2>/dev/null)"
echo ":5000 $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health)"
echo ":80 $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health)"

[ "$HEALTH_OK" = "1" ] || exit 1
[ "$PROXY_OK" = "1" ] || exit 2
