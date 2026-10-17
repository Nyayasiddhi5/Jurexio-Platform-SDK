#!/usr/bin/env bash
# NV-SIDDHANTA-CNR-MERGE-OVERLAP-001 — how many cnr_case_details CNRs exist in staging (HC)?
set -uo pipefail
echo "=== CNR MERGE OVERLAP $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
  const creds = JSON.parse(
    (await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString,
  );
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: db,
    user: creds.username,
    password: creds.password,
    ssl: ssl(),
    max: 2,
    statement_timeout: 300000,
  });
}
async function q(pool, label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 200));
  }
}
const caselaw = await pool("nyv_caselaw");
const search = await pool("case_api_search");
await q(caselaw, "CNR_DETAILS_COUNT", "SELECT count(*)::bigint AS n FROM cnr_case_details");
await q(
  search,
  "STAGING_HC_COUNT",
  `SELECT count(*)::bigint AS n FROM cases_search_staging
   WHERE lower(btrim(court_level::text)) IN ('hc', 'high court', 'high_court')`,
);
const sample = await caselaw.query(
  `SELECT cnr FROM cnr_case_details ORDER BY updated_at DESC NULLS LAST LIMIT 5000`,
);
const cnrs = sample.rows.map((r) => String(r.cnr || "").trim()).filter(Boolean);
if (cnrs.length) {
  const ov = await search.query(
    `SELECT count(*)::bigint AS overlap_in_sample
     FROM cases_search_staging s
     WHERE upper(s.cnr) = ANY($1::text[])
       AND lower(btrim(s.court_level::text)) IN ('hc', 'high court', 'high_court')`,
    [cnrs.map((c) => c.toUpperCase())],
  );
  console.log("OVERLAP_IN_5K_RECENT_DETAILS", JSON.stringify({ sample: cnrs.length, ...ov.rows[0] }));
}
await caselaw.end();
await search.end();
NODE
echo "=== CNR MERGE OVERLAP DONE ==="
