#!/usr/bin/env bash
set -uo pipefail
echo "=== CNR MERGE SMOKE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
    ssl: ssl(), max: 2, statement_timeout: 120000,
  });
}
const caselaw = await pool("nyv_caselaw");
const search = await pool("case_api_search");
const d = await caselaw.query(
  `SELECT cnr, acts_sections::text AS acts FROM cnr_case_details
   WHERE acts_sections IS NOT NULL AND acts_sections::text NOT IN ('[]')
   ORDER BY updated_at DESC LIMIT 1`,
);
const row = d.rows[0];
console.log("DETAIL_SAMPLE", row?.cnr, "acts_len", row?.acts?.length ?? 0);
if (row?.cnr) {
  const before = await search.query(
    `SELECT cnr, court_level, left(acts_json::text, 40) AS acts
     FROM cases_search_staging WHERE upper(cnr)=upper($1) LIMIT 3`,
    [row.cnr],
  );
  console.log("STAGING_BEFORE", JSON.stringify(before.rows));
  const upd = await search.query(
    `UPDATE cases_search_staging SET acts_json = $2::jsonb
     WHERE upper(cnr)=upper($1)
       AND lower(btrim(court_level::text)) IN ('hc', 'high court', 'high_court')
       AND (acts_json IS NULL OR btrim(acts_json::text) IN ('', '[]', 'null', '{}'))
     RETURNING cnr, court_level`,
    [row.cnr, row.acts],
  );
  console.log("SMOKE_UPDATE rowCount", upd.rowCount, JSON.stringify(upd.rows));
}
await caselaw.end();
await search.end();
NODE
echo "=== CNR MERGE SMOKE DONE ==="
