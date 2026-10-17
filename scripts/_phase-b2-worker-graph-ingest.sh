#!/usr/bin/env bash
# Phase B-2 — ingest graph JSONL from worker into NYV RDS (direct Secrets Manager)
set -euo pipefail
cd /opt/nyv/api
JSONL="/opt/nyv/api/graph-edges-pending.jsonl"
if [ ! -f "$JSONL" ]; then echo "MISSING $JSONL"; exit 1; fi
echo "jsonl_lines=$(wc -l < "$JSONL")"
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
const REGION = 'ap-south-1';
const JSONL = '/opt/nyv/api/graph-edges-pending.jsonl';
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: 'nyv-dev-edge-pg' }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const client = new pg.Client({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? 'nyayavigya',
  user: creds.username,
  password: creds.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const lines = readFileSync(JSONL, 'utf8').split('\n');
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
console.log('GRAPH_NYV_INGEST_DONE', JSON.stringify({ lines: n, edgeLines, counts: counts.rows[0] }));
await client.end();
NODE
