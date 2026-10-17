#!/usr/bin/env bash
# Post-deploy verify: health, deploy stamp, cost profile env names, cache columns.
set -euo pipefail

for label in CURRENT LAST_GOOD; do
  for base in /opt/Nyayavigya /opt/nyayavigya; do
    f="$base/${label}_DEPLOY"
    if [ -f "$f" ]; then
      echo "${label}_DEPLOY=$(cat "$f")"
    fi
  done
done

echo "=== gateway env (names only) ==="
for k in NYV_LLM_COST_PROFILE NYV_BEDROCK_REGION_ORDER NYV_NSP_UNLIMITED; do
  if docker exec nyv-gateway printenv "$k" >/dev/null 2>&1; then
    echo "container_present_name=${k}"
  else
    echo "container_absent_name=${k}"
  fi
done

echo "=== health :5000 ==="
code=$(curl -sS -o /tmp/jrx-health.json -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health || echo 000)
echo "health_http_code=${code}"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/tmp/jrx-health.json")
if not p.exists():
    print("health_json=missing")
    raise SystemExit(0)
d = json.loads(p.read_text())
print(f"registryVersion={d.get('registryVersion') or (d.get('agents') or {}).get('registryVersion')}")
agents = d.get("agents") or {}
print(f"totalAgents={agents.get('totalAgents') or d.get('totalAgents')}")
for key in ("gitSha", "sha", "commit", "deploySha", "version"):
    if d.get(key):
        print(f"{key}={d[key]}")
PY

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
echo "admin_dsn_len=${#ADM}"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c '
psql "$PGURL" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'sdk_usage_metering'"'"' AND column_name IN ('"'"'tokens_cache_read'"'"','"'"'tokens_cache_write'"'"') ORDER BY 1;"
'
echo "VERIFY_OK"
