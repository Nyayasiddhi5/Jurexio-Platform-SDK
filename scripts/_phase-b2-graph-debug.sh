#!/usr/bin/env bash
# Debug graph ingest failure on nysdev
set -uo pipefail
echo "=== FULL INGEST LOG ==="
cat /tmp/graph-ingest.log 2>/dev/null | tail -40
echo "=== RLS on graph tables ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
docker exec -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.NYV_DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\`
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='nv_schema' AND c.relname LIKE 'nv_legal_graph%'
\`);
console.log(r.rows);
await c.end();
"
