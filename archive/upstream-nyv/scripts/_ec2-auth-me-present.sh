#!/usr/bin/env bash
set -euo pipefail
echo "=== image / live src markers ==="
docker exec nyv-gateway sh -c 'grep -l findUserByIdForSession /app/src/db/jrx-auth-db.ts /app/src/routes/jrx-auth-routes.ts /app/dist/src/db/jrx-auth-db.js /app/dist/src/routes/jrx-auth-routes.js 2>/dev/null || true'
echo "=== grep me handler ==="
docker exec nyv-gateway sh -c 'grep -n "findUserByIdForSession\|getAuthDb() ?? db" /app/src/routes/jrx-auth-routes.ts /app/dist/src/routes/jrx-auth-routes.js 2>/dev/null | head -20'
echo "=== latest deploy dir ==="
ls -1dt /opt/Nyayavigya/repo/2026-08-1* 2>/dev/null | head -3
echo "=== host src marker ==="
grep -n findUserByIdForSession /opt/Nyayavigya/repo/2026-08-12T0121Z-aws-ssm-ca201d15/src/db/jrx-auth-db.ts 2>/dev/null | head -3 || echo "not in 0121 host tree"
grep -n findUserByIdForSession /opt/Nyayavigya/repo/2026-08-11T1829Z-aws-ssm-ca201d15/src/db/jrx-auth-db.ts 2>/dev/null | head -3 || echo "not in 1829 host tree"
