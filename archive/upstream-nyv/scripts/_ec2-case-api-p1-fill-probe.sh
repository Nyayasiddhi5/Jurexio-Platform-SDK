#!/usr/bin/env bash
# P1 post-complete fill rates (2025+ slice).
set -uo pipefail
echo "=== P1 FILL PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
async function q(pool, label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 200));
  }
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 300000,
});
await q(pool, "P1_TOTALS", `
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE diary_no IS NOT NULL AND btrim(diary_no) <> '')::bigint AS diary,
    count(*) FILTER (WHERE petitioner_address IS NOT NULL AND btrim(petitioner_address) <> '')::bigint AS pet_addr,
    count(*) FILTER (WHERE acts_json IS NOT NULL AND length(btrim(acts_json::text)) > 2)::bigint AS acts
  FROM cases_search_staging
  WHERE decision_date >= '2025-01-01'::date OR filing_date >= '2025-01-01'::date
`);
await q(pool, "P1_ACTS_ALL", `
  SELECT count(*) FILTER (WHERE acts_json IS NOT NULL AND length(btrim(acts_json::text)) > 2)::bigint AS acts_any
  FROM cases_search_staging
`);
await pool.end();
NODE
echo "=== P1 FILL PROBE DONE ==="
