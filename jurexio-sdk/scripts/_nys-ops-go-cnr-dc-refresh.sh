#!/usr/bin/env bash
# NV-JRX-OPS-GO-001 — cnr_case_details refresh + DC delta ingest (caselaw-worker)
# Run via: bash scripts/_nys-ssm-run.sh scripts/_nys-ops-go-cnr-dc-refresh.sh "ops-go-cnr-dc"
set -euo pipefail
API="${JRX_ECOSYSTEM_API_DIR:-/opt/nyv/api}"
LOG_DIR="/var/log/nys-ops"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/ops-go-cnr-dc-${STAMP}.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== NV-JRX-OPS-GO-001 start $STAMP ==="
echo "host=$(hostname) api=$API"

# NV-JRX-OPS-OOM-001: hyparquet's parquetReadObjects() materialises whole DC
# parquet files in memory. The 2GB v8 default heap OOM'd 3a (ingest-cnr-case-
# details) and aborted before 3b ever launched. Host has ~7.8GB RAM + 4GB swap,
# so raise the ceiling for every node child. Override with JRX_ECOSYSTEM_NODE_HEAP_MB.
export NODE_OPTIONS="--max-old-space-size=${JRX_ECOSYSTEM_NODE_HEAP_MB:-4096} ${NODE_OPTIONS:-}"
echo "NODE_OPTIONS=$NODE_OPTIONS"

cd "$API" || exit 1

# Baseline counts (fast — no full-table GROUP BY on staging)
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
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 2,
  statement_timeout: 300000,
});

async function q(label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log("BASELINE", label, "ms", Date.now() - t0, JSON.stringify(r.rows));
  } catch (e) {
    console.log("BASELINE", label, "ERR", String(e.message).slice(0, 120));
  }
}

await q("CNR_DETAILS", `SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
await q("DC_JUDGMENTS", `SELECT count(*)::bigint AS dc_total FROM judgments WHERE court_type='dc'`);
await q("INGEST_DC_CHECKPOINT", `
  SELECT partition_key, row_count, completed_at::text
  FROM ingest_progress WHERE partition_key LIKE 'dc/%' ORDER BY completed_at DESC NULLS LAST LIMIT 3
`);
await pool.end();
NODE

echo "--- 3a: cnr_case_details refresh (ingest-cnr-case-details limit=50) ---"
DETAILS=""
for f in ingest-cnr-case-details.mjs ingest-cnr-case-details.js; do
  [[ -f "$API/$f" ]] && DETAILS="$f" && break
done
if [[ -z "$DETAILS" ]]; then
  echo "BLOCKED: ingest-cnr-case-details missing under $API"
  exit 2
fi
export JRX_ECOSYSTEM_CNR_DETAILS_LIMIT="${JRX_ECOSYSTEM_CNR_DETAILS_LIMIT:-50}"
# NV-JRX-OPS-OOM-001: 3a must NOT abort 3b. cnr_case_details is already fresh
# (refreshed independently); the DC delta ingest (3b) is the CNR-closure priority.
if node "$API/$DETAILS" "$JRX_ECOSYSTEM_CNR_DETAILS_LIMIT"; then
  echo "3a OK: cnr_case_details refresh completed (limit=$JRX_ECOSYSTEM_CNR_DETAILS_LIMIT)"
else
  echo "3a NON-FATAL FAILURE (rc=$?): continuing to 3b delta-dc — cnr_case_details left as-is"
fi

echo "--- post 3a counts ---"
node --env-file="$API/.env" <<'NODE' || echo "post-3a counts probe failed (non-fatal)"
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
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 300000,
});
const r = await pool.query(`SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details`);
console.log("AFTER_3A", JSON.stringify(r.rows));
await pool.end();
NODE

echo "--- 3b: DC delta ingest (ingest-rds delta-dc) — async background ---"
INGEST=""
for f in ingest-rds.mjs ingest-rds.js; do
  [[ -f "$API/$f" ]] && INGEST="$f" && break
done
if [[ -z "$INGEST" ]]; then
  echo "BLOCKED: ingest-rds missing under $API"
  exit 3
fi
DC_LOG="$LOG_DIR/delta-dc-${STAMP}.log"
# NV-JRX-OPS-GO-001: batch DC ingest needs a longer statement ceiling than the
# API default. Honour a caller override, else pin to 600s (matches ingest-rds's
# own internal default). Prevents the prior statement_timeout stall on DC years.
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"
echo "3b RDS_STATEMENT_TIMEOUT_MS=$RDS_STATEMENT_TIMEOUT_MS"
# Avoid duplicate runs
if pgrep -f "ingest-rds.*delta-dc" >/dev/null 2>&1; then
  echo "3b SKIPPED: delta-dc already running pid=$(pgrep -f 'ingest-rds.*delta-dc' | head -1)"
else
  nohup node "$API/$INGEST" delta-dc >>"$DC_LOG" 2>&1 &
  DC_PID=$!
  echo "3b STARTED: delta-dc pid=$DC_PID log=$DC_LOG"
fi

echo "=== NV-JRX-OPS-GO-001 phase-1 done $(date -u +%Y-%m-%dT%H:%M:%SZ) log=$LOG ==="
echo "NOTE: delta-dc continues in background — poll $DC_LOG and re-run freshness probe"
