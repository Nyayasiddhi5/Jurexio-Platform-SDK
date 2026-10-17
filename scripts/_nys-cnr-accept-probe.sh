#!/usr/bin/env bash
# Post-fix CNR acceptance — direct RDS + NYS API (default + caseCreate).
set -uo pipefail
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

for (const cnr of ["TSWL000000742024", "RJHC010324382023", "TSHM010005562026"]) {
  const t0 = Date.now();
  const res = await pool.query("SELECT id, court_type FROM judgments WHERE cnr = $1 LIMIT 1", [cnr]);
  console.log("RDS", cnr, "rows", res.rowCount, "ms", Date.now() - t0);
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

probe() {
  local label="$1"; shift
  local body="$1"
  tmp=$(mktemp)
  start=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 90 -X POST \
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
 print(f"API {label} http={code} ms={ms} status={data.get('status')} source={data.get('source')} err={err.get('code')}")
except Exception as e:
 print(f"API {label} http={code} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

probe "TSWL_default" '{"cnr":"TSWL000000742024","options":{"includeDocuments":false}}'
probe "RJHC_default" '{"cnr":"RJHC010324382023","options":{"includeDocuments":false}}'
probe "RJHC_caseCreate" '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false}}'
probe "DC_default" '{"cnr":"TSHM010005562026","options":{"includeDocuments":false}}'
