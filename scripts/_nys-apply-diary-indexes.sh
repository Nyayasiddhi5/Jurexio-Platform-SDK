#!/usr/bin/env bash
# Diary lookup hot-path indexes on jrx-caselaw-pg (case_no equality scans).
set -euo pipefail
cd /opt/nyv/api
export JRX_ECOSYSTEM_ENV_FILE=/opt/nyv/api/.env
if [ -f "$JRX_ECOSYSTEM_ENV_FILE" ]; then
  RDS_CA_BUNDLE=$(grep -E '^RDS_CA_BUNDLE=' "$JRX_ECOSYSTEM_ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
  RDS_CA_BUNDLE="${RDS_CA_BUNDLE%\"}"; RDS_CA_BUNDLE="${RDS_CA_BUNDLE#\"}"
  export RDS_CA_BUNDLE
fi
echo "=== diary index apply (RDS_CA_BUNDLE len=${#RDS_CA_BUNDLE})"

node <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "jrx-caselaw-pg";

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
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_case_no_idx ON judgments (case_no)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_case_no_court_type_idx ON judgments (case_no, court_type)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cnr_case_details_case_no_idx ON cnr_case_details (case_no)`,
  "ANALYZE judgments",
  "ANALYZE cnr_case_details",
];

const client = await connect();
for (const sql of stmts) {
  const tag = sql.trim().split(/\s+/).slice(0, 4).join(" ");
  const t0 = Date.now();
  await client.query(sql);
  console.log(`OK ${tag} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
const idx = await client.query(
  `SELECT indexname FROM pg_indexes
   WHERE indexname = ANY($1::text[]) ORDER BY 1`,
  [
    [
      "judgments_case_no_idx",
      "judgments_case_no_court_type_idx",
      "cnr_case_details_case_no_idx",
    ],
  ],
);
console.log("=== verify diary indexes ===");
for (const r of idx.rows) console.log(r.indexname);
await client.end();
NODE
