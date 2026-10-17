#!/usr/bin/env bash
# Fast read-only watermark + cnr_case_details stats (no full staging scan).
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== RDS WATERMARK ONLY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: db, user: creds.username, password: creds.password,
    ssl: ssl(), max: 1, statement_timeout: 120000,
  });
}
async function q(pool, label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 120));
  }
}
const search = await poolFor("case_api_search");
await q(search, "RDS_LOAD_STATE", `SELECT table_version, applied_at::text AS applied_at FROM rds_load_state ORDER BY applied_at DESC LIMIT 3`);
await q(search, "STAGING_EST", `SELECT reltuples::bigint AS est FROM pg_class WHERE relname='cases_search_staging'`);
await search.end();
const caselaw = await poolFor("nyv_caselaw");
await q(caselaw, "CNR_DETAILS", `SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
await q(caselaw, "DC_JUDGMENTS", `SELECT count(*)::bigint AS dc_total FROM judgments WHERE court_type='dc'`);
await caselaw.end();
NODE
curl -sS -m 8 http://127.0.0.1:8090/health 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('NYSAPI_HEALTH', {k:d.get(k) for k in ['status','table_version','table_stale','rds_enabled']})" 2>/dev/null || echo NYSAPI_HEALTH_FAIL
echo "=== WATERMARK DONE ==="
