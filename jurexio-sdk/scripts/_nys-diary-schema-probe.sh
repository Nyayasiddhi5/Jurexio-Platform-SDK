#!/usr/bin/env bash
# Probe RDS for diary-related columns and sample values (SC/HC/DC).
set -uo pipefail
cd /opt/nyv/api || exit 1
node --env-file=/opt/nyv/api/.env <<'NODE'
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
const inst = desc.DBInstances?.[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString ?? "{}");
const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 1,
});

// Column discovery
const cols = await pool.query(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('judgments', 'cnr_case_details')
    AND column_name ILIKE '%diary%'
  ORDER BY table_name, column_name
`);
console.log("DIARY_COLUMNS", JSON.stringify(cols.rows));

// SC: case_no often stores diary (case_id from parquet)
for (const ct of ["sc", "hc", "dc"]) {
  const t0 = Date.now();
  const res = await pool.query(`
    SELECT id, cnr, case_no, court_type, court, year, title
    FROM judgments
    WHERE court_type = $1
      AND case_no IS NOT NULL
      AND case_no ~ '^[0-9]+/[0-9]{4}$'
    ORDER BY id DESC
    LIMIT 3
  `, [ct]);
  console.log(`SAMPLES_${ct.toUpperCase()}`, "ms", Date.now() - t0, JSON.stringify(res.rows.map(r => ({
    id: r.id, cnr: r.cnr, case_no: r.case_no, court: r.court, year: r.year, title: (r.title||'').slice(0,60)
  }))));
}

// cnr_case_details raw JSON diary keys
const rawProbe = await pool.query(`
  SELECT cnr, court_code, case_no,
         raw->>'diary_number' AS diary_number,
         raw->>'diary_no' AS diary_no,
         raw->>'diaryNumber' AS diaryNumber
  FROM cnr_case_details
  WHERE raw IS NOT NULL
    AND (
      raw ? 'diary_number' OR raw ? 'diary_no' OR raw ? 'diaryNumber'
      OR raw::text ILIKE '%diary%'
    )
  LIMIT 5
`);
console.log("CASE_DETAILS_DIARY_RAW", JSON.stringify(rawProbe.rows));

await pool.end();
NODE
