#!/usr/bin/env bash
# Lightweight CNR + diary accept probe (caselaw-worker localhost).
set -uo pipefail
cd /opt/nyv/api || exit 1

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
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 60 -X POST \
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
 print(f"API {label} http={code} ms={ms} lookup={data.get('lookupType')} status={data.get('status')} source={data.get('source')} err={err.get('code')}")
except Exception as e:
 print(f"API {label} http={code} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

# One fast RDS sample per court (LIMIT 1, no regex scan)
node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const REGION = "ap-south-1";
function ssl(){const p=process.env.RDS_CA_BUNDLE;if(p&&existsSync(p))return{rejectUnauthorized:true,ca:readFileSync(p,"utf8")};return{rejectUnauthorized:false};}
const rds=new RDSClient({region:REGION});
const inst=(await rds.send(new DescribeDBInstancesCommand({DBInstanceIdentifier:"nyv-caselaw-pg"}))).DBInstances?.[0];
const creds=JSON.parse((await new SecretsManagerClient({region:REGION}).send(new GetSecretValueCommand({SecretId:inst.MasterUserSecret.SecretArn}))).SecretString??"{}");
const pool=new pg.Pool({host:inst.Endpoint.Address,port:inst.Endpoint.Port??5432,database:inst.DBName??"nyv_caselaw",user:creds.username,password:creds.password,ssl:ssl(),max:1,statement_timeout:8000});
for (const ct of ["sc","hc","dc"]) {
  const t0=Date.now();
  const r=await pool.query(`SELECT case_no, cnr FROM judgments WHERE court_type=$1 AND case_no IS NOT NULL AND position('/' in case_no)>0 ORDER BY id DESC LIMIT 1`,[ct]);
  console.log("RDS_SAMPLE", ct, "ms", Date.now()-t0, r.rows[0]||"none");
}
await pool.end();
NODE

probe "CNR_TSWL" '{"cnr":"TSWL000000742024","options":{"includeDocuments":false}}'
probe "CNR_RJHC" '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false}}'
probe "CNR_DC" '{"cnr":"TSHM010005562026","options":{"includeDocuments":false}}'

# Diary probes — RDS samples (2026-09-03 worker probe)
probe "DIARY_SC" '{"diaryNumber":"2023 INSC 1081","options":{"courtType":"sc","includeDocuments":false}}'
probe "DIARY_HC" '{"diaryNumber":"256000007942025","options":{"courtType":"hc","includeDocuments":false}}'

DC_CASE=$(node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const REGION = "ap-south-1";
function ssl(){const p=process.env.RDS_CA_BUNDLE;if(p&&existsSync(p))return{rejectUnauthorized:true,ca:readFileSync(p,"utf8")};return{rejectUnauthorized:false};}
const rds=new RDSClient({region:REGION});
const inst=(await rds.send(new DescribeDBInstancesCommand({DBInstanceIdentifier:"nyv-caselaw-pg"}))).DBInstances?.[0];
const creds=JSON.parse((await new SecretsManagerClient({region:REGION}).send(new GetSecretValueCommand({SecretId:inst.MasterUserSecret.SecretArn}))).SecretString??"{}");
const pool=new pg.Pool({host:inst.Endpoint.Address,port:inst.Endpoint.Port??5432,database:inst.DBName??"nyv_caselaw",user:creds.username,password:creds.password,ssl:ssl(),max:1});
const r=await pool.query(`SELECT case_no FROM judgments WHERE cnr=$1 LIMIT 1`,["TSHM010005562026"]);
console.log(r.rows[0]?.case_no||"");
await pool.end();
NODE
)
if [[ -n "$DC_CASE" ]]; then
  probe "DIARY_DC" "{\"diaryNumber\":\"${DC_CASE}\",\"options\":{\"courtType\":\"dc\",\"includeDocuments\":false}}"
fi

echo "DIARY_PROBE_DONE"
