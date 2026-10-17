#!/usr/bin/env bash
# Ingest graph JSONL from worker private IP into NYV RDS (runs on nysdev)
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
WORKER_IP=$(aws ec2 describe-instances --instance-ids i-000115b19219bb766 --region ap-south-1 --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text 2>/dev/null || echo "")
JSONL="/tmp/graph-edges-pending.jsonl"

echo "=== FETCH JSONL from worker $WORKER_IP ==="
# Worker exposes no HTTP for file; use SSM on worker to write to shared S3 via nysdev role
# Fallback: nysdev uploads from developer-staged S3 object
if aws s3 cp s3://nyayavigya-sdk-devapp/deploys/phase-b/graph-edges-pending.jsonl "$JSONL" --region ap-south-1 2>/dev/null; then
  echo "Fetched from S3 staging"
else
  echo "S3 staging missing — run: aws s3 cp from worker via manual staging"
  exit 1
fi

echo "=== INGEST $(wc -l < "$JSONL") lines ==="
docker exec -i -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module - <<'NODE'
import pg from 'pg';
import fs from 'fs';
const client = new pg.Client({ connectionString: process.env.NYV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const lines = fs.readFileSync('/dev/stdin', 'utf8').split('\n');
let n = 0;
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
  }
  n++;
  if (n % 5000 === 0) console.log('INGEST_PROGRESS', n);
}
const counts = await client.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('GRAPH_INGEST_DONE', { lines: n, counts: counts.rows[0] });
await client.end();
NODE < "$JSONL"

echo "=== GRAPH INGEST FROM STAGING COMPLETE ==="
