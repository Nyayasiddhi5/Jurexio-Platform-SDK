#!/usr/bin/env bash
# Phase B-2 graph ingest on nysdev — curl JSONL, write ingest script, docker exec
set -euo pipefail
WORKER_IP="${WORKER_IP:-172.31.13.128}"
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
JSONL="/tmp/graph-edges-pending.jsonl"
INGEST="/tmp/graph-ingest-run.mjs"
PORT=9876

echo "=== CURL worker ${WORKER_IP}:${PORT} ==="
curl -sf -m 180 -o "$JSONL" "http://${WORKER_IP}:${PORT}/graph-edges-pending.jsonl"
echo "downloaded bytes=$(wc -c < "$JSONL") lines=$(wc -l < "$JSONL")"

cat > "$INGEST" << 'MJS'
import pg from 'pg';
import fs from 'fs';
const client = new pg.Client({ connectionString: process.env.NYV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const lines = fs.readFileSync('/tmp/graph-edges-pending.jsonl', 'utf8').split('\n');
let n = 0, edgeLines = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.op === 'entity') {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_entities (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [row.id, row.type, row.value, row.normalizedValue, row.jurisdiction ?? 'IN', row.year ?? null, JSON.stringify(row.metadata ?? {})],
    );
  } else if (row.op === 'edge') {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_edges (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at)
       VALUES ($1, NULL, $2, $3, $4, 1.0, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
      [row.id, row.sourceId, row.targetId, row.edgeType, row.docId ?? null, row.confidence ?? 0.8],
    );
    edgeLines++;
  }
  n++;
  if (n % 5000 === 0) console.log('INGEST_PROGRESS', n, 'edges', edgeLines);
}
const counts = await client.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('GRAPH_INGEST_DONE', JSON.stringify({ lines: n, edgeLines, counts: counts.rows[0] }));
await client.end();
MJS

docker cp "$JSONL" nyv-gateway:/tmp/graph-edges-pending.jsonl
docker cp "$INGEST" nyv-gateway:/app/graph-ingest-run.mjs
docker exec -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node /app/graph-ingest-run.mjs

echo "=== GRAPH INGEST COMPLETE ==="
