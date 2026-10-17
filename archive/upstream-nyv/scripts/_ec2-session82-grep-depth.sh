#!/usr/bin/env bash
set -uo pipefail
ROOT=/home/ubuntu/scripts/case_api
grep -R -n -E 'filename|display_pdf|mobile|depth|captcha|JSESSION|php' "$ROOT/build/merge_hcservices_depth.py" "$ROOT/build/ingest_hcservices_depth.py" 2>/dev/null | head -40
echo "--- search pdf_url in staging extra sample ---"
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env <<'NODE'
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { readFileSync, existsSync } from "node:fs";
const CNR = "APHC010000832023";
const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({ host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432, database: "case_api_search", user: creds.username, password: creds.password, ssl: ssl(), max: 2 });
const r = await pool.query(`SELECT extra FROM cases_search_staging WHERE cnr=$1`, [CNR]);
const extra = r.rows[0]?.extra || {};
const fo = extra.final_orders || extra.finalOrders || [];
const io = extra.interim_orders || extra.interimOrders || [];
console.log("final0", JSON.stringify(fo[0] || {}).slice(0,400));
console.log("interim0", JSON.stringify(io[0] || {}).slice(0,400));
await pool.end();
NODE
echo "--- grep nyv api for order pdf ---"
grep -R -n -E 'display_pdf|orders/pdf|hc/orders' /opt/nyv/api 2>/dev/null | head -20
echo DONE
