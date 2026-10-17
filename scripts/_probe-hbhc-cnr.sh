#!/usr/bin/env bash
# Probe HBHC010225192023 on caselaw-worker — RDS + API default vs caseCreate
set -uo pipefail
cd /opt/nyv/api || { echo "missing /opt/nyv/api"; exit 1; }

CNR="HBHC010225192023"
CNR_GOOD="TSWL000000742024"

echo "=== RDS direct (judgments) ==="
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
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const inst = desc.DBInstances?.[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString ?? "{}");
const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 1,
});

for (const cnr of ["HBHC010225192023", "TSWL000000742024"]) {
  const t0 = Date.now();
  const res = await pool.query("SELECT cnr, court_type FROM judgments WHERE cnr = $1 LIMIT 1", [cnr]);
  const row = res.rows[0];
  console.log("RDS", cnr, "rows", res.rowCount, "court_type", row?.court_type ?? "null", "ms", Date.now() - t0);
}
await pool.end();
NODE

KEY=$(node -e "
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  if (line.startsWith('NYS_SDK_API_KEYS=')) {
    const v=line.split('=').slice(1).join('=').trim().replace(/^[\"']|[\"']$/g,'');
    console.log(v.split(',')[0].trim()); break;
  }
}")
echo "api_key_len=${#KEY}"

echo "=== health ==="
curl -sS -o /dev/null -w "health HTTP=%{http_code}\n" -H "X-API-Key: $KEY" "http://127.0.0.1:8080/healthz" --max-time 5 2>/dev/null || echo "health unreachable"

probe() {
  local label="$1"; shift
  local body="$1"
  local max="${2:-120}"
  tmp=$(mktemp)
  start=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m "$max" -X POST \
    -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
    -d "$body" "http://127.0.0.1:8080/api/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json,sys
label,code,ms,path=sys.argv[1:5]
try:
 d=json.load(open(path))
 data=d.get('data') or {}
 err=d.get('error') or {}
 print(f"API {label} http={code} ms={ms} status={data.get('status')} source={data.get('source')} metaMs={data.get('meta',{}).get('latencyMs')} sourcesTried={data.get('sourcesTried')} err={err.get('code')}")
except Exception as e:
 print(f"API {label} http={code} ms={ms} parse_err={e} body={open(path).read()[:200]}")
PY
  rm -f "$tmp"
}

probe "HBHC_default" '{"cnr":"HBHC010225192023","options":{"profile":"default","includeDocuments":true,"courtType":"hc"}}' 30
probe "HBHC_caseCreate" '{"cnr":"HBHC010225192023","options":{"profile":"caseCreate","includeDocuments":true,"courtType":"hc"}}' 180
probe "TSWL_default" '{"cnr":"TSWL000000742024","options":{"profile":"default","includeDocuments":true}}' 30
probe "TSWL_caseCreate" '{"cnr":"TSWL000000742024","options":{"profile":"caseCreate","includeDocuments":true}}' 180
