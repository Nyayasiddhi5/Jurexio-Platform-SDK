#!/usr/bin/env bash
# Poll NV-NYS-OPS-GO-001 background jobs + post counts
set -uo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
echo "=== OPS POLL $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- delta-dc process ---"
pgrep -af "ingest-rds.*delta-dc" || echo "delta-dc: not running"
LATEST_DC_LOG=$(ls -t /var/log/nys-ops/delta-dc-*.log 2>/dev/null | head -1)
if [[ -n "$LATEST_DC_LOG" ]]; then
  echo "delta-dc log: $LATEST_DC_LOG"
  tail -20 "$LATEST_DC_LOG" 2>/dev/null || true
fi

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
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 300000,
});
async function q(label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 120));
  }
}
await q("CNR_DETAILS", `SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
await q("DC_JUDGMENTS", `SELECT count(*)::bigint AS dc_total FROM judgments WHERE court_type='dc'`);
await q("INGEST_PROGRESS_COLS", `SELECT column_name FROM information_schema.columns WHERE table_name='ingest_progress' ORDER BY ordinal_position`);
await q("INGEST_PROGRESS_SAMPLE", `SELECT * FROM ingest_progress ORDER BY 1 DESC LIMIT 5`);
await pool.end();
NODE
echo "=== POLL DONE ==="
