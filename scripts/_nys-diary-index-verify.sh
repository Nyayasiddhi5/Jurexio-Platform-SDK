#!/usr/bin/env bash
# List diary hot-path indexes on nyv-caselaw-pg (read-only).
set -euo pipefail
cd /opt/nyv/api
export NYS_ENV_FILE=/opt/nyv/api/.env
if [ -f "$NYS_ENV_FILE" ]; then
  RDS_CA_BUNDLE=$(grep -E '^RDS_CA_BUNDLE=' "$NYS_ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
  RDS_CA_BUNDLE="${RDS_CA_BUNDLE%\"}"; RDS_CA_BUNDLE="${RDS_CA_BUNDLE#\"}"
  export RDS_CA_BUNDLE
fi
node <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const NAMES = [
  "judgments_case_no_idx",
  "judgments_case_no_court_type_idx",
  "cnr_case_details_case_no_idx",
];
const REGION = "ap-south-1";
function sslConfig() {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (caPath && existsSync(caPath)) return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances?.[0];
const sm = new SecretsManagerClient({ region: REGION });
const creds = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString ?? "{}");
const client = new pg.Client({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: sslConfig(),
});
await client.connect();
const idx = await client.query(
  `SELECT indexname, indexdef FROM pg_indexes WHERE indexname = ANY($1::text[]) ORDER BY 1`,
  [NAMES],
);
const inProgress = await client.query(`
  SELECT pid, phase, blocks_done, blocks_total, command
  FROM pg_stat_progress_create_index
  WHERE relid IN ('judgments'::regclass, 'cnr_case_details'::regclass)
`);
console.log("=== diary index verify ===");
for (const n of NAMES) {
  const found = idx.rows.some((r) => r.indexname === n);
  console.log(found ? "PRESENT" : "MISSING", n);
}
if (inProgress.rows.length) {
  console.log("BUILD_IN_PROGRESS", JSON.stringify(inProgress.rows));
}
await client.end();
NODE
