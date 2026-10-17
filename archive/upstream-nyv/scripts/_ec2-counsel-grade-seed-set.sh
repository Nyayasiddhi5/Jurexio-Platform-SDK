#!/usr/bin/env bash
# Seed counsel-grade eval set into gateway container from SET_B64 env (base64 JSON).
set -uo pipefail
: "${SET_B64:?SET_B64 required}"
docker exec nyv-gateway mkdir -p /app/docs/audit/eval
printf '%s' "$SET_B64" | base64 -d > /tmp/jrx-counsel-grade-set.v1.json
docker cp /tmp/jrx-counsel-grade-set.v1.json nyv-gateway:/app/docs/audit/eval/jrx-counsel-grade-set.v1.json
case_count=$(docker exec nyv-gateway node -e "console.log(JSON.parse(require('fs').readFileSync('/app/docs/audit/eval/jrx-counsel-grade-set.v1.json','utf8')).cases.length)")
echo "CONTROL seeded_case_count=${case_count}"
