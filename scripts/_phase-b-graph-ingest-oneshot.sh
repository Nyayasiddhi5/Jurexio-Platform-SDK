#!/usr/bin/env bash
# Phase B graph ingest one-shot on jrx-prod
set -uo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
REPO=/opt/Jurexio/repo/current
SCRIPT="$REPO/scripts/jrx-treatment-graph-ingest.mjs"
if [ ! -f "$SCRIPT" ]; then SCRIPT="/opt/nyv/scripts/jrx-treatment-graph-ingest.mjs"; fi

echo "=== PRE GRAPH COUNTS ==="
docker exec -e "DB=$DB" -w /app jrx-gateway node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.DB,ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log(r.rows[0]);
await c.end();
"

echo "=== B4 GRAPH INGEST ONE-SHOT ==="
docker exec -e "JRX_DATABASE_URL=$DB" -e "GRAPH_INGEST_POLL_MS=1000" -w /app jrx-gateway node --input-type=module -e "
import pg from 'pg';
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
const REGION='ap-south-1', BUCKET='jrx-sdk-distribution', PREFIX='caselaw-worker/graph-edges/';
const s3=new S3Client({region:REGION});
const client=new pg.Client({connectionString:process.env.JRX_DATABASE_URL,ssl:{rejectUnauthorized:false}});
await client.connect();
async function ingestLine(line){
  const row=JSON.parse(line);
  if(row.op==='entity'){
    await client.query(\`INSERT INTO nv_schema.nv_legal_graph_entities (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at) VALUES (\$1,NULL,\$2,\$3,\$4,\$5,\$6,\$7::jsonb,now(),now()) ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()\`,[row.id,row.type,row.value,row.normalizedValue,row.jurisdiction??'IN',row.year??null,JSON.stringify(row.metadata??{})]);
  } else if(row.op==='edge'){
    await client.query(\`INSERT INTO nv_schema.nv_legal_graph_edges (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at) VALUES (\$1,NULL,\$2,\$3,\$4,1.0,\$5,\$6,now()) ON CONFLICT (id) DO NOTHING\`,[row.id,row.sourceId,row.targetId,row.edgeType,row.docId??null,row.confidence??0.8]);
  }
}
const listed=await s3.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:PREFIX,MaxKeys:50}));
const keys=(listed.Contents??[]).map(o=>o.Key).filter(k=>k&&k.endsWith('.jsonl'));
let total=0;
for(const key of keys.sort()){
  const got=await s3.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const text=await got.Body.transformToString();
  for(const line of text.split('\\n')){ if(!line.trim()) continue; await ingestLine(line); total++; }
  await s3.send(new DeleteObjectCommand({Bucket:BUCKET,Key:key}));
  console.log('INGESTED', key, 'lines');
}
const counts=await client.query('SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities, (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges');
console.log('GRAPH_ONE_SHOT', {batches:keys.length, lines:total, counts:counts.rows[0]});
await client.end();
"

echo "=== PHASE B GRAPH INGEST COMPLETE ==="
