#!/usr/bin/env bash
# Force cnr_case_details re-sync — clear hc-case-details checkpoints then re-ingest
set -euo pipefail
API="${JRX_ECOSYSTEM_API_DIR:-/opt/nyv/api}"
LIMIT="${JRX_ECOSYSTEM_CNR_DETAILS_LIMIT:-11}"
echo "=== FORCE CNR DETAILS REFRESH $(date -u +%Y-%m-%dT%H:%M:%SZ) limit=$LIMIT ==="

cd "$API" || exit 1

node --env-file="$API/.env" <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 300000,
});
const before = await pool.query(`SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
console.log("BEFORE", JSON.stringify(before.rows));
const del = await pool.query(`DELETE FROM ingest_progress WHERE partition_key LIKE 'hc-case-details/%' RETURNING partition_key`);
console.log("CLEARED_CHECKPOINTS", del.rowCount, "keys");
await pool.end();
NODE

DETAILS=""
for f in ingest-cnr-case-details.mjs ingest-cnr-case-details.js; do
  [[ -f "$API/$f" ]] && DETAILS="$f" && break
done
[[ -n "$DETAILS" ]] || { echo "BLOCKED: ingest-cnr-case-details missing"; exit 2; }

node "$API/$DETAILS" "$LIMIT"

node --env-file="$API/.env" <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 300000,
});
const after = await pool.query(`SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
console.log("AFTER", JSON.stringify(after.rows));
await pool.end();
NODE

echo "=== FORCE REFRESH DONE ==="
