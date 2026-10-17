#!/usr/bin/env bash
# #3 — DC case-api vs judgments gap: sync job presence + sample counts (read-only).
set -uo pipefail
echo "=== DC INDEX SYNC PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
API="${NYS_API_DIR:-/opt/nyv/api}"
for f in nys-cnr-index-sync.mjs ingest-rds.mjs; do
  if [ -f "$API/$f" ]; then echo "script_present $f bytes=$(wc -c < "$API/$f")"; else echo "script_missing $f"; fi
done
echo "--- cron hints ---"
grep -h "nys-cnr-index-sync\|ingest-rds\|ingest-cnr" /etc/cron.d/* 2>/dev/null | head -5 || echo "no cron lines matched"
ls -lt /var/log/nys-ops/*cnr* /var/log/nys-ops/*index* 2>/dev/null | head -4 || true

cd "$API" || exit 1
node --env-file="$API/.env" <<'NODE'
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
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432, database: db,
    user: creds.username, password: creds.password, ssl: ssl(), max: 2, statement_timeout: 120000,
  });
}
async function q(p, label, sql) {
  try {
    const r = await p.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160));
  }
}
const caselaw = await pool("nyv_caselaw");
const search = await pool("case_api_search");
await q(caselaw, "JUDGMENTS_DC", `SELECT count(*)::bigint AS dc FROM judgments WHERE court_type='dc'`);
await q(search, "STAGING_DC", `SELECT count(*)::bigint AS dc FROM cases_search_staging WHERE lower(btrim(court_level::text)) IN ('dc','district court','district_court')`);
await q(caselaw, "CNR_DETAILS", `SELECT count(*)::bigint AS n, max(updated_at)::text AS max_updated FROM cnr_case_details`);
await q(caselaw, "INGEST_PROGRESS_DC", `SELECT partition_key, updated_at::text FROM ingest_progress WHERE partition_key LIKE 'dc/%' ORDER BY updated_at DESC NULLS LAST LIMIT 5`);
await caselaw.end();
await search.end();
NODE
echo "=== DC INDEX SYNC DONE ==="
