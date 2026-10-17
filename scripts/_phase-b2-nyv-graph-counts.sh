#!/usr/bin/env bash
# NYV graph edge counts on nysdev — never echo secrets
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
docker exec -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.NYV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('nv_legal_graph', r.rows[0]);
await c.end();
"
