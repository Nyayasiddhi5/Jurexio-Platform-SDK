#!/usr/bin/env bash
# Transfer graph JSONL worker→nysdev via temp HTTP, ingest to NYV RDS
set -uo pipefail
WORKER_IP=$(aws ec2 describe-instances --instance-ids i-000115b19219bb766 --region ap-south-1 --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
CANON="/opt/Nyayavigya/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
JSONL="/tmp/graph-edges-pending.jsonl"
PORT=9876

echo "=== START HTTP on worker (via SSM) ==="
aws ssm send-command --instance-ids i-000115b19219bb766 --region ap-south-1 --document-name AWS-RunShellScript \
  --parameters "commands=[\"pkill -f 'http.server ${PORT}' || true\",\"cd /opt/nyv/api && nohup python3 -m http.server ${PORT} >/tmp/http-${PORT}.log 2>&1 &\",\"sleep 2\",\"curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/graph-edges-pending.jsonl\"]" \
  --output text --query Command.CommandId > /tmp/ssm-http.txt
sleep 8
HTTP_CMD=$(cat /tmp/ssm-http.txt)
aws ssm get-command-invocation --command-id "$HTTP_CMD" --instance-id i-000115b19219bb766 --region ap-south-1 --query StandardOutputContent --output text

echo "=== CURL from nysdev worker_ip=$WORKER_IP ==="
curl -sf -m 120 -o "$JSONL" "http://${WORKER_IP}:${PORT}/graph-edges-pending.jsonl" && echo "downloaded $(wc -c < "$JSONL") bytes" || { echo "CURL FAILED"; exit 1; }

echo "=== INGEST ==="
docker exec -i -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module - <<'NODE'
import pg from 'pg';
import fs from 'fs';
const path = '/tmp/graph-edges-pending.jsonl';
const client = new pg.Client({ connectionString: process.env.NYV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const lines = fs.readFileSync(path, 'utf8').split('\n');
let n = 0, edges = 0;
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
    edges++;
  }
  n++;
  if (n % 5000 === 0) console.log('INGEST_PROGRESS', n, 'edges', edges);
}
const counts = await client.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('GRAPH_INGEST_DONE', { lines: n, edgeLines: edges, counts: counts.rows[0] });
await client.end();
NODE

echo "=== CLEANUP worker HTTP ==="
aws ssm send-command --instance-ids i-000115b19219bb766 --region ap-south-1 --document-name AWS-RunShellScript \
  --parameters "commands=[\"pkill -f 'http.server ${PORT}' || true\"]" --output text --query Command.CommandId >/dev/null

echo "=== GRAPH TRANSFER+INGEST COMPLETE ==="
