#!/usr/bin/env bash
# NV-NYS-OPS-GO-003 — P3 cnr_case_details re-run (OOM-safe: 8GB heap, small partition batch).
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/p3-cnr-details-${STAMP}.log"

export NYS_CNR_DETAILS_LIMIT="${NYS_CNR_DETAILS_LIMIT:-5}"
export NYS_NODE_HEAP_MB="${NYS_NODE_HEAP_MB:-8192}"
export NODE_OPTIONS="--max-old-space-size=${NYS_NODE_HEAP_MB} ${NODE_OPTIONS:-}"
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"

if pgrep -f "ingest-cnr-case-details" >/dev/null 2>&1; then
  echo "SKIPPED: ingest-cnr-case-details pid=$(pgrep -f 'ingest-cnr-case-details' | head -1)"
  exit 0
fi

nohup bash -s >>"$LOG" 2>&1 <<'INNER' &
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LIMIT="${NYS_CNR_DETAILS_LIMIT:-5}"
export NODE_OPTIONS="--max-old-space-size=${NYS_NODE_HEAP_MB:-8192}"
cd "$API"
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
const before = await pool.query(`SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
console.log("BEFORE", JSON.stringify(before.rows));
const del = await pool.query(`DELETE FROM ingest_progress WHERE partition_key LIKE 'hc-case-details/%' RETURNING partition_key`);
console.log("CLEARED_CHECKPOINTS", del.rowCount);
await pool.end();
NODE
DETAILS=""
for f in ingest-cnr-case-details.mjs ingest-cnr-case-details.js; do
  [[ -f "$API/$f" ]] && DETAILS="$f" && break
done
[[ -n "$DETAILS" ]] || { echo "BLOCKED: ingest-cnr-case-details missing"; exit 2; }
node "$API/$DETAILS" "$LIMIT"
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
const after = await pool.query(`SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
console.log("AFTER", JSON.stringify(after.rows));
await pool.end();
NODE
echo "=== P3 CNR DETAILS DONE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
INNER

echo "P3_CNR_DETAILS_STARTED pid=$! log=$LOG limit=$NYS_CNR_DETAILS_LIMIT heap=$NYS_NODE_HEAP_MB"
sleep 2
pgrep -af "ingest-cnr-case-details" || true
