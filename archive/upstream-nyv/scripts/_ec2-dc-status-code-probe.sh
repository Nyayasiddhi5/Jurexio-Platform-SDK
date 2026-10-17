#!/usr/bin/env bash
# NV-DC-STATUS-DECODE-001 — read-only: DC case_status in case_api staging.
# Is DC case_status a bare numeric eCourts code, and does the row co-publish a
# TEXT disposal_nature we could VERIFY a numeric->label pair from (not fabricate)?
# READ-ONLY. No writes. No secret values printed.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== DC STATUS STAGING PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
async function poolFor(db) {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({ host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432, database: db, user: creds.username, password: creds.password, ssl: ssl(), max: 1, statement_timeout: 180000 });
}
async function q(pool, label, sql) {
  try { const r = await pool.query(sql); console.log(label, JSON.stringify(r.rows)); }
  catch (e) { console.log(label, "ERR", String(e.message).slice(0, 160)); }
}
const s = await poolFor("case_api_search");
await q(s, "DC_STATUS_NUMERIC_SHARE", `SELECT (case_status ~ '^[0-9]+$') AS is_numeric, count(*)::bigint AS n FROM cases_search_staging WHERE court_level='DC' AND case_status IS NOT NULL AND case_status <> '' GROUP BY 1 ORDER BY n DESC`);
await q(s, "DC_STATUS_TOP", `SELECT case_status, count(*)::bigint AS n FROM cases_search_staging WHERE court_level='DC' AND case_status IS NOT NULL AND case_status <> '' GROUP BY case_status ORDER BY n DESC LIMIT 30`);
await q(s, "DC_NUMERIC_STATUS_WITH_DISPOSAL", `SELECT case_status, disposal_nature, count(*)::bigint AS n FROM cases_search_staging WHERE court_level='DC' AND case_status ~ '^[0-9]+$' AND disposal_nature IS NOT NULL AND disposal_nature <> '' AND disposal_nature !~ '^[0-9]+$' GROUP BY case_status, disposal_nature ORDER BY n DESC LIMIT 40`);
await q(s, "DC_DISPOSAL_NUMERIC_SHARE", `SELECT (disposal_nature ~ '^[0-9]+$') AS is_numeric, count(*)::bigint AS n FROM cases_search_staging WHERE court_level='DC' AND disposal_nature IS NOT NULL AND disposal_nature <> '' GROUP BY 1 ORDER BY n DESC`);
await s.end();
NODE
echo "=== DC STATUS STAGING PROBE DONE ==="
