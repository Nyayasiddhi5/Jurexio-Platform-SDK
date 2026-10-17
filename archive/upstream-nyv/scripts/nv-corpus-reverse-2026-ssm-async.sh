#!/usr/bin/env bash
# SSM-safe async kickoff — self-contained for base64 pipe (no BASH_SOURCE).
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/reverse-dc-${STAMP}.log"
NOW_YEAR="$(date -u +%Y)"
CORPUS_END_YEAR="${CORPUS_END_YEAR:-$NOW_YEAR}"
CORPUS_START_YEAR="${CORPUS_START_YEAR:-$((NOW_YEAR - 1))}"

if pgrep -f "ingest-rds" >/dev/null 2>&1; then
  echo "SKIPPED: ingest-rds already running pid=$(pgrep -f 'ingest-rds' | head -1)"
  exit 0
fi

nohup env \
  RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}" \
  CORPUS_END_YEAR="$CORPUS_END_YEAR" \
  CORPUS_START_YEAR="$CORPUS_START_YEAR" \
  NYS_API_DIR="$API" \
  bash -s >>"$LOG" 2>&1 <<'INGEST' &
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
cd "$API"
INGEST=""
for f in ingest-rds.mjs ingest-rds.js; do
  [[ -f "$API/$f" ]] && INGEST="$f" && break
done
[[ -n "$INGEST" ]] || { echo "BLOCKED: ingest-rds missing"; exit 2; }
echo "=== reverse DC worker start $(date -u +%FT%TZ) years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR} timeout=${RDS_STATEMENT_TIMEOUT_MS} ==="
for ((y = CORPUS_END_YEAR; y >= CORPUS_START_YEAR; y--)); do
  echo "=== YEAR $y ==="
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
const year = ${y};
for (const k of [\`dc/\${year}/state=2\`, \`dc/\${year}/state=29\`]) {
  const r = await pool.query("DELETE FROM ingest_progress WHERE partition_key = \$1 RETURNING partition_key", [k]);
  console.log("CLEARED", k, "rows", r.rowCount);
}
await pool.end();
NODE
  node "$API/$INGEST" dc "$y" "$y"
  echo "=== YEAR $y done ==="
done
echo "=== reverse DC complete $(date -u +%FT%TZ) ==="
INGEST

echo "P2_REVERSE_DC_STARTED pid=$! log=$LOG years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR}"
sleep 3
pgrep -af "ingest-rds" || echo "ingest-rds: not yet visible"
