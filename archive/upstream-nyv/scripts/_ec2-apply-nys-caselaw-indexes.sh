#!/usr/bin/env bash
# Apply NYS caselaw RDS indexes via nyv-caselaw-pg master secret (not app DATABASE_URL).
set -euo pipefail
cd /opt/nyv/api
export NYS_ENV_FILE=/opt/nyv/api/.env
# Load RDS_CA_BUNDLE only (avoid sourcing full .env)
if [ -f "$NYS_ENV_FILE" ]; then
  RDS_CA_BUNDLE=$(grep -E '^RDS_CA_BUNDLE=' "$NYS_ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
  RDS_CA_BUNDLE="${RDS_CA_BUNDLE%\"}"; RDS_CA_BUNDLE="${RDS_CA_BUNDLE#\"}"
  export RDS_CA_BUNDLE
fi
echo "=== nyv-caselaw-pg admin connect (RDS_CA_BUNDLE len=${#RDS_CA_BUNDLE})"

node <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";

function sslConfig() {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (caPath && existsSync(caPath)) {
    return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  }
  return { rejectUnauthorized: false };
}

async function connect() {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }));
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) throw new Error("RDS not available");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
  const creds = JSON.parse(secret.SecretString ?? "{}");
  const client = new pg.Client({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl: sslConfig(),
  });
  await client.connect();
  await client.query("SET statement_timeout = 0");
  console.log("pg connected ok db=" + (inst.DBName ?? "nyv_caselaw"));
  return client;
}

const stmts = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_cnr_idx ON judgments (cnr)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_embedding_hnsw
     ON judgments USING hnsw (embedding vector_cosine_ops)
     WITH (m = 16, ef_construction = 64)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_sc_embedding_partial
     ON judgments (id)
     WHERE embedding IS NOT NULL AND court_type = 'sc'`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cnr_case_details_cnr_idx
     ON cnr_case_details (cnr)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_case_no_idx ON judgments (case_no)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_case_no_court_type_idx ON judgments (case_no, court_type)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cnr_case_details_case_no_idx ON cnr_case_details (case_no)`,
  "ANALYZE judgments",
    // statutes table absent on nyv_caselaw — skip
  "ANALYZE cnr_case_details",
];

const client = await connect();
for (const sql of stmts) {
  const tag = sql.trim().split(/\s+/).slice(0, 3).join(" ");
  const t0 = Date.now();
  await client.query(sql);
  console.log(`OK ${tag} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
const idx = await client.query(
  `SELECT indexname FROM pg_indexes
   WHERE indexname = ANY($1::text[]) ORDER BY 1`,
  [["judgments_cnr_idx", "judgments_embedding_hnsw", "judgments_sc_embedding_partial", "cnr_case_details_cnr_idx", "judgments_case_no_idx", "judgments_case_no_court_type_idx", "cnr_case_details_case_no_idx"]],
);
console.log("=== verify indexes ===");
for (const r of idx.rows) console.log(r.indexname);
const est = await client.query(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'judgments'`);
console.log("judgments_est_rows", est.rows[0]?.n ?? "null");
await client.end();
NODE
