#!/usr/bin/env bash
# Decode SSM-staged base64 graph JSONL and ingest into JRX RDS on jrx-prod
set -euo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
B64_KEY="${1:-deploys/phase-b/ssm-graph-b64/latest/graph.b64}"
JSONL="/tmp/graph-edges-pending.jsonl"

echo "=== DOWNLOAD b64 from s3://jurexio-sdk-devapp/$B64_KEY ==="
aws s3 cp "s3://jurexio-sdk-devapp/$B64_KEY" /tmp/graph.b64 --region ap-south-1
base64 -d /tmp/graph.b64 > "$JSONL"
echo "Decoded $(wc -c < "$JSONL") bytes, $(wc -l < "$JSONL") lines"

echo "=== INGEST to JRX RDS ==="
docker cp "$JSONL" jrx-gateway:/tmp/graph-edges-pending.jsonl
docker exec -e JRX_DATABASE_URL="$DB" -w /app jrx-gateway node --input-type=module -e "
import pg from 'pg';
import fs from 'fs';
const client = new pg.Client({ connectionString: process.env.JRX_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const lines = fs.readFileSync('/tmp/graph-edges-pending.jsonl', 'utf8').split('\n');
let n = 0, edgeLines = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.op === 'entity') {
    await client.query(
      \`INSERT INTO nv_schema.nv_legal_graph_entities (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at)
       VALUES (\$1, NULL, \$2, \$3, \$4, \$5, \$6, \$7::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()\`,
      [row.id, row.type, row.value, row.normalizedValue, row.jurisdiction ?? 'IN', row.year ?? null, JSON.stringify(row.metadata ?? {})],
    );
  } else if (row.op === 'edge') {
    await client.query(
      \`INSERT INTO nv_schema.nv_legal_graph_edges (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at)
       VALUES (\$1, NULL, \$2, \$3, \$4, 1.0, \$5, \$6, now()) ON CONFLICT (id) DO NOTHING\`,
      [row.id, row.sourceId, row.targetId, row.edgeType, row.docId ?? null, row.confidence ?? 0.8],
    );
    edgeLines++;
  }
  n++;
  if (n % 5000 === 0) console.log('INGEST_PROGRESS', n, edgeLines);
}
const counts = await client.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('GRAPH_INGEST_DONE', { lines: n, edgeLines, counts: counts.rows[0] });
await client.end();
"
echo "=== DONE ==="
