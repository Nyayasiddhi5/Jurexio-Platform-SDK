#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 lite — case_api grep + judgments row + targeted S3 head (no recursive ls).
set -uo pipefail
CNR="${1:-APHC010000832023}"
export CNR
echo "=== PROBE-LITE cnr=$CNR ==="
ROOT="/home/ubuntu/scripts/case_api"
[ -d "$ROOT" ] && grep -R -n -E 'display_pdf|download_order|order_pdf|final_orders' "$ROOT" 2>/dev/null | head -20 | cut -c1-180

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
  database: "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});
const j = await pool.query(
  `SELECT id, left(cnr,24) cnr, court_type, left(pdf_link,80) pdf_link, left(source,40) source, decision_date::text
   FROM judgments WHERE cnr=$1 LIMIT 5`, [CNR]);
console.log("judgments_for_cnr", JSON.stringify(j.rows));
await pool.end();
NODE

# Targeted public judgment key pattern (APHC 2023 — year=2023 court=2 is common AP HC code in corpus)
for key in \
  "data/pdf/year=2023/court=2/bench=1/${CNR}_1_2026-08-19.pdf" \
  "data/pdf/year=2023/court=2/bench=1/${CNR}_12_2026-08-19.pdf"; do
  for bucket in indian-high-court-judgments ns-indian-highcourt-judgements-2; do
    len=$(aws s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text 2>/dev/null || echo MISSING)
    echo "head bucket=$bucket key_tail=${key: -45} len=$len"
  done
done
echo "=== DONE ==="
