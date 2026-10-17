#!/usr/bin/env bash
set +e
# Confirm nv_app (runtime role, RLS-subject) can read the new tables BEFORE restart.
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"
APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/')"
echo "=== nv_app read check ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F "|" -c "SELECT (SELECT count(*) FROM nv_llm_providers) providers, (SELECT count(*) FROM nv_courts) courts;"' 2>&1
echo "=== restarting gateway to clear schema-introspection caches ==="
docker restart nyv-gateway >/dev/null 2>&1 && echo "restart issued"
# Wait for health
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/jrx/health 2>/dev/null)
  if [ "$code" = "200" ]; then echo "gateway healthy after ${i}x2s"; break; fi
  sleep 2
done
echo "final_health=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/jrx/health 2>/dev/null)"
