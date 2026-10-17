#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 probe5 — case_api order fetch code + staging extra + S3 grep CNR.
set -uo pipefail
CNR="${1:-APHC010000832023}"
export CNR
echo "=== PROBE5 cnr=$CNR ==="

echo "=== case_api grep (order pdf / display_pdf / download) ==="
ROOT="/home/ubuntu/scripts/case_api"
if [ -d "$ROOT" ]; then
  grep -R -n -E 'display_pdf|final_orders|interim_orders|order.*pdf|download.*order' "$ROOT" 2>/dev/null | head -25 | sed 's/\t/ /g'
else
  echo "case_api_missing"
fi

node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const CNR = process.env.CNR;
const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});
const r = await pool.query(`SELECT extra::text AS extra FROM cases_search_staging WHERE cnr=$1`, [CNR]);
console.log("staging_extra_len", (r.rows[0]?.extra || "").length);
console.log("staging_extra_snip", (r.rows[0]?.extra || "").slice(0, 500));
await pool.end();
NODE

echo "=== s3 recursive grep CNR (owned + public, timeout 90s) ==="
for bucket in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket; do
  n=$(timeout 90 aws s3 ls "s3://${bucket}/data/pdf/" --recursive 2>/dev/null | grep -c "$CNR" || echo 0)
  echo "bucket=$bucket cnr_key_lines=$n"
  timeout 90 aws s3 ls "s3://${bucket}/data/pdf/" --recursive 2>/dev/null | grep "$CNR" | head -3 | while read -r a b c key; do
    echo "  key_tail=${key: -75}"
  done
done
pub=$(timeout 60 aws s3 ls "s3://indian-high-court-judgments/data/pdf/" --recursive 2>/dev/null | grep -c "$CNR" || echo 0)
echo "public_bucket_cnr_key_lines=$pub"
timeout 60 aws s3 ls "s3://indian-high-court-judgments/data/pdf/" --recursive 2>/dev/null | grep "$CNR" | head -2 | while read -r a b c key; do echo "  pub_key_tail=${key: -75}"; done

echo "=== DONE ==="
