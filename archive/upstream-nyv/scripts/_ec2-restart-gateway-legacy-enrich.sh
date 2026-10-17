#!/usr/bin/env bash
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || cat /opt/nyayavigya/CURRENT_DEPLOY)"
echo "CURRENT_DEPLOY=$DEP"
cd "/opt/Nyayavigya/repo/${DEP}"
docker compose -p nyayavigya-platform-312 -f docker-compose.aws-dev.yml up -d --no-deps --force-recreate gateway
sleep 12
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:5000/api/jrx/health
grep -E '^NYV_F_CASE_API_LEGACY_ENRICH=' /opt/Nyayavigya/secrets/.env.production | head -1
