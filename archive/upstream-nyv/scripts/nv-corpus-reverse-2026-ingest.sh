#!/usr/bin/env bash
# NV-CORPUS-REVERSE-2026-001 — reverse-year DC ingest (2026 → 2025 → …) AP+TG.
# Non-blocking: run via nohup on caselaw-worker; live resolve unchanged.
#
# Fixes prior delta-dc statement_timeout crashes:
#   - RDS_STATEMENT_TIMEOUT_MS=600000 (10 min; rdsPool reads this env)
#   - Year-at-a-time reverse loop (2026 before 2025) — no delta-dc race
#   - Optional INGEST_BATCH_SIZE + INGEST_REVERSE_YEARS when worker ingest-rds is synced
#
# Usage (on caselaw-worker):
#   nohup bash scripts/jrx-corpus-reverse-2026-ingest.sh \
#     >> /var/log/nys-ops/reverse-dc-$(date -u +%Y%m%dT%H%M%SZ).log 2>&1 &
#
# From workstation:
#   bash scripts/_nys-ssm-run.sh scripts/jrx-corpus-reverse-2026-ingest.sh "reverse-dc-2026"
set -euo pipefail

API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

NOW_YEAR="$(date -u +%Y)"
export CORPUS_END_YEAR="${CORPUS_END_YEAR:-$NOW_YEAR}"
export CORPUS_START_YEAR="${CORPUS_START_YEAR:-$((NOW_YEAR - 1))}"
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"
export INGEST_BATCH_SIZE="${INGEST_BATCH_SIZE:-100}"
export INGEST_REVERSE_YEARS="${INGEST_REVERSE_YEARS:-1}"

echo "=== NV-CORPUS-REVERSE-2026-001 start $STAMP ==="
echo "host=$(hostname) api=$API years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR} reverse=$INGEST_REVERSE_YEARS batch=$INGEST_BATCH_SIZE timeout_ms=$RDS_STATEMENT_TIMEOUT_MS"

cd "$API" || exit 1

INGEST=""
for f in ingest-rds.mjs ingest-rds.js; do
  [[ -f "$API/$f" ]] && INGEST="$f" && break
done
if [[ -z "$INGEST" ]]; then
  echo "BLOCKED: ingest-rds missing under $API"
  exit 2
fi

if pgrep -f "ingest-rds" >/dev/null 2>&1; then
  echo "SKIPPED: ingest-rds already running pid=$(pgrep -f 'ingest-rds' | head -1)"
  exit 0
fi

echo "--- baseline DC count ---"
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
const r = await pool.query(`SELECT count(*)::bigint AS dc_total FROM judgments WHERE court_type='dc'`);
console.log("BASELINE_DC", JSON.stringify(r.rows));
await pool.end();
NODE

clear_dc_year() {
  local year="$1"
  node --env-file="$API/.env" <<NODE
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
const year = ${year};
const keys = [\`dc/\${year}/state=2\`, \`dc/\${year}/state=29\`];
for (const k of keys) {
  const r = await pool.query("DELETE FROM ingest_progress WHERE partition_key = \$1 RETURNING partition_key", [k]);
  console.log("CLEARED", k, "rows", r.rowCount);
}
await pool.end();
NODE
}

# Prefer single delta-dc when worker has NV-CORPUS-REVERSE-2026 ingest-rds build synced.
if [[ "${USE_DELTA_DC:-0}" == "1" ]]; then
  echo "--- starting delta-dc (env reverse + timeout) ---"
  exec node "$API/$INGEST" delta-dc
fi

echo "--- reverse-year DC loop (newest first) ---"
for ((y = CORPUS_END_YEAR; y >= CORPUS_START_YEAR; y--)); do
  echo "=== YEAR $y ==="
  clear_dc_year "$y"
  node "$API/$INGEST" dc "$y" "$y"
  echo "=== YEAR $y done ==="
done

echo "=== NV-CORPUS-REVERSE-2026-001 complete $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
