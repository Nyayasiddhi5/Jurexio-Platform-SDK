#!/usr/bin/env bash
set -euo pipefail
ENVF="/opt/Nyayavigya/secrets/.env.production"
if ! grep -qE '^NYV_F_CASE_API_LEGACY_ENRICH=' "$ENVF" 2>/dev/null; then
  echo "NYV_F_CASE_API_LEGACY_ENRICH=1" >> "$ENVF"
  echo "APPENDED_NYV_F_CASE_API_LEGACY_ENRICH=1"
else
  echo "SKIP_NYV_F_CASE_API_LEGACY_ENRICH=already_set"
fi
grep -E '^NYV_F_CASE_API_LEGACY_ENRICH=' "$ENVF" | head -1
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
cd "/opt/Nyayavigya/repo/${DEP}"
docker compose -f docker-compose.aws-dev.yml up -d --no-deps --force-recreate gateway
sleep 8
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:5000/api/jrx/health
