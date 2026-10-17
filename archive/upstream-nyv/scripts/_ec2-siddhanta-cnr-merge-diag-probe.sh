#!/usr/bin/env bash
set -uo pipefail
echo "=== CNR MERGE DIAG $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
async function pool(db) {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: db, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: 180000,
  });
}
async function q(pool, label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 180));
  }
}
const search = await pool("case_api_search");
await q(search, "COURT_LEVELS", `
  SELECT lower(court_level::text) AS cl, count(*)::bigint AS n
  FROM cases_search_staging
  GROUP BY 1 ORDER BY n DESC LIMIT 8
`);
const caselaw = await pool("nyv_caselaw");
const sample = await caselaw.query("SELECT cnr FROM cnr_case_details LIMIT 5");
const cnrs = sample.rows.map((r) => r.cnr);
for (const cnr of cnrs) {
  const r = await search.query(
    `SELECT cnr, court_level, (acts_json IS NOT NULL AND length(btrim(acts_json::text))>2) AS has_acts
     FROM cases_search_staging WHERE upper(cnr)=upper($1) LIMIT 5`,
    [cnr],
  );
  console.log("SAMPLE_MATCH", cnr, JSON.stringify(r.rows));
}
await q(search, "JOIN_EST", `
  SELECT count(*)::bigint AS staging_hc_cnrs
  FROM cases_search_staging s
  WHERE lower(s.court_level::text) IN ('hc','high court')
  LIMIT 1
`);
await caselaw.end();
await search.end();
NODE
echo "=== CNR MERGE DIAG DONE ==="
