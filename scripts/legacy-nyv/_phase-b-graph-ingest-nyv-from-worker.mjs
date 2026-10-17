#!/usr/bin/env node
/**
 * Phase B — ingest local graph-edges-pending.jsonl into NYV RDS nv_legal_graph_*.
 * Runs on caselaw worker; uses Secrets Manager for nyv-dev-edge-pg (gateway DB).
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";

const REGION = "ap-south-1";
const NYV_DB_INSTANCE = process.env.NYV_DB_INSTANCE_ID || "nyv-dev-edge-pg";
const JSONL =
  process.env.GRAPH_JSONL || "/opt/nyv/api/graph-edges-pending.jsonl";

async function nyvPool() {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: NYV_DB_INSTANCE }),
  );
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) throw new Error(`NYV RDS ${NYV_DB_INSTANCE} unavailable`);
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) throw new Error("NYV RDS no MasterUserSecret");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(secret.SecretString);
  return new pg.Client({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyayavigya",
    user: creds.username,
    password: creds.password,
    ssl: { rejectUnauthorized: false },
  });
}

async function main() {
  if (!existsSync(JSONL)) throw new Error(`Missing ${JSONL}`);
  const lines = readFileSync(JSONL, "utf8").split("\n");
  const client = await nyvPool();
  await client.connect();
  let n = 0;
  let edgeLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.op === "entity") {
      await client.query(
        `INSERT INTO nv_schema.nv_legal_graph_entities
           (id, org_id, type, value, normalized_value, jurisdiction, year, metadata, created_at, updated_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
         ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
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
    } else if (row.op === "edge") {
      await client.query(
        `INSERT INTO nv_schema.nv_legal_graph_edges
           (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence, created_at)
         VALUES ($1, NULL, $2, $3, $4, 1.0, $5, $6, now()) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.sourceId, row.targetId, row.edgeType, row.docId ?? null, row.confidence ?? 0.8],
      );
      edgeLines++;
    }
    n++;
    if (n % 5000 === 0) console.log("INGEST_PROGRESS", { n, edgeLines });
  }
  const counts = await client.query(
    `SELECT (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_entities) entities,
            (SELECT count(*)::bigint FROM nv_schema.nv_legal_graph_edges) edges`,
  );
  console.log("GRAPH_NYV_INGEST_DONE", { lines: n, edgeLines, counts: counts.rows[0] });
  await client.end();
}

main().catch((e) => {
  console.error("GRAPH_NYV_INGEST_FAIL", e.message);
  process.exit(1);
});
