#!/usr/bin/env node
/**
 * NV-TREATMENT-GRAPH-001 — ingest graph JSONL batches from S3 into nv_legal_graph_*.
 * Run on nysdev (background):
 *   nohup node /opt/nyayavigya/repo/current/scripts/nv-treatment-graph-ingest.mjs >> /opt/nyv/logs/graph-ingest.log 2>&1 &
 *
 * Requires DATABASE_URL / NYV_DATABASE_URL pointing at gateway Postgres.
 */
import pg from "pg";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const REGION = process.env.NYV_AWS_REGION ?? "ap-south-1";
const BUCKET = process.env.NYV_DEPLOY_BUCKET ?? "nyv-sdk-distribution";
const PREFIX = "caselaw-worker/graph-edges/";
const POLL_MS = Number(process.env.GRAPH_INGEST_POLL_MS ?? "120000");
const CHECKPOINT_KEY = `${PREFIX}.ingest-checkpoint.json`;

function dbUrl() {
  return process.env.NYV_DATABASE_URL ?? process.env.DATABASE_URL;
}

async function loadCheckpoint(s3) {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: CHECKPOINT_KEY }));
    return JSON.parse(await got.Body.transformToString());
  } catch {
    return { processedKeys: [] };
  }
}

async function saveCheckpoint(s3, state) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: CHECKPOINT_KEY,
      Body: JSON.stringify(state),
      ContentType: "application/json",
    }),
  );
}

async function ingestLine(client, line) {
  const row = JSON.parse(line);
  if (row.op === "entity") {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_entities
         (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         value = EXCLUDED.value,
         normalized_value = EXCLUDED.normalized_value,
         year = COALESCE(EXCLUDED.year, nv_schema.nv_legal_graph_entities.year),
         metadata = nv_schema.nv_legal_graph_entities.metadata || EXCLUDED.metadata,
         updated_at = now()`,
      [
        row.id,
        row.type,
        row.value,
        row.normalizedValue,
        row.jurisdiction ?? "IN",
        row.year ?? null,
        JSON.stringify(row.metadata ?? {}),
      ],
    );
    return;
  }
  if (row.op === "edge") {
    await client.query(
      `INSERT INTO nv_schema.nv_legal_graph_edges
         (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at)
       VALUES ($1, NULL, $2, $3, $4, 1.0, $5, $6, now())
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.sourceId, row.targetId, row.edgeType, row.docId ?? null, row.confidence ?? 0.8],
    );
  }
}

async function processObject(client, s3, key) {
  const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const text = await got.Body.transformToString();
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    await ingestLine(client, line);
    n += 1;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  console.log("GRAPH_INGEST_OK", { key, lines: n });
  return n;
}

async function pollOnce(client, s3, state) {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, MaxKeys: 50 }),
  );
  const keys = (listed.Contents ?? [])
    .map((o) => o.Key)
    .filter((k) => k && k.endsWith(".jsonl") && !state.processedKeys.includes(k));
  keys.sort();
  let total = 0;
  for (const key of keys) {
    total += await processObject(client, s3, key);
    state.processedKeys.push(key);
    if (state.processedKeys.length > 500) {
      state.processedKeys = state.processedKeys.slice(-200);
    }
  }
  if (keys.length) await saveCheckpoint(s3, state);
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) AS entities,
       (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) AS edges`,
  );
  console.log("GRAPH_INGEST_POLL", { batches: keys.length, lines: total, counts: counts.rows[0] });
}

async function main() {
  const url = dbUrl();
  if (!url) throw new Error("NYV_DATABASE_URL or DATABASE_URL required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const s3 = new S3Client({ region: REGION });
  const state = await loadCheckpoint(s3);
  console.log("GRAPH_INGEST_START", { prefix: PREFIX, pollMs: POLL_MS });

  for (;;) {
    try {
      await pollOnce(client, s3, state);
    } catch (err) {
      console.error("GRAPH_INGEST_ERR", String(err));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("GRAPH_INGEST_FAIL", e);
  process.exit(1);
});
