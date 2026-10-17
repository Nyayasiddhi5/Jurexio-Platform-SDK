#!/usr/bin/env bash
# Poll graph ingest log + NYV edge counts on nysdev
set -uo pipefail
LOG="/tmp/graph-ingest.log"
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
if [ -z "$DB" ]; then DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"; fi
echo "=== INGEST LOG (tail) ==="
tail -10 "$LOG" 2>/dev/null || echo "no log yet"
echo "=== PGREP ==="
pgrep -af 'graph-ingest-run' | sed 's/postgresql:\/\/[^@]*@/postgresql:\/\/***@/g' || echo "ingest not running"
echo "=== EDGE COUNTS ==="
docker exec -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.NYV_DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log(r.rows[0]);
await c.end();
"
