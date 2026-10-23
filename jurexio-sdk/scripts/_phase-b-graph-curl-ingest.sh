#!/usr/bin/env bash
# Curl graph JSONL from worker private IP and ingest into JRX RDS
set -euo pipefail
WORKER_IP="${WORKER_IP:-172.31.13.128}"
CANON="/opt/Jurexio/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"

curl -sf -m 180 -o /tmp/graph-edges-pending.jsonl "http://${WORKER_IP}:9876/graph-edges-pending.jsonl"
echo "downloaded $(wc -c < /tmp/graph-edges-pending.jsonl) bytes $(wc -l < /tmp/graph-edges-pending.jsonl) lines"
docker cp /tmp/graph-edges-pending.jsonl jrx-gateway:/tmp/graph-edges-pending.jsonl

docker exec -e JRX_DATABASE_URL="$DB" -w /app jrx-gateway node --input-type=module - <<'NODE'
import pg from 'pg';
import fs from 'fs';
const client = new pg.Client({ connectionString: process.env.JRX_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const lines = fs.readFileSync('/tmp/graph-edges-pending.jsonl', 'utf8').split('\n');
let n = 0, e = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.op === 'entity') {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_entities (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [r.id, r.type, r.value, r.normalizedValue, r.jurisdiction ?? 'IN', r.year ?? null, JSON.stringify(r.metadata ?? {})],
    );
  } else if (r.op === 'edge') {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_edges (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at)
       VALUES ($1, NULL, $2, $3, $4, 1.0, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.sourceId, r.targetId, r.edgeType, r.docId ?? null, r.confidence ?? 0.8],
    );
    e++;
  }
  n++;
  if (n % 5000 === 0) console.log('INGEST_PROGRESS', n, e);
}
const counts = await client.query(
  'SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges',
);
console.log('GRAPH_INGEST_DONE', { lines: n, edges: e, counts: counts.rows[0] });
await client.end();
NODE

echo "GRAPH CURL INGEST COMPLETE"
