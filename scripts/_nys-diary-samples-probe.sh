#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api || exit 1
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
const pool=new pg.Pool({host:inst.Endpoint.Address,port:inst.Endpoint.Port??5432,database:inst.DBName??"nyv_caselaw",user:creds.username,password:creds.password,ssl:ssl(),max:1});
const client=await pool.connect();
await client.query('BEGIN READ ONLY');
await client.query('SET LOCAL statement_timeout = 8000');
for (const ct of ["sc","hc","dc"]) {
  const t0=Date.now();
  const r=await client.query(`SELECT case_no, cnr FROM judgments WHERE court_type=$1 AND year >= 2023 AND case_no IS NOT NULL LIMIT 3`,[ct]);
  console.log("CT", ct, "ms", Date.now()-t0, JSON.stringify(r.rows));
}
await client.query('COMMIT');
client.release();
await pool.end();
NODE
