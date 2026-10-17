#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env <<'NODE'
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const rds = new RDSClient({ region: "ap-south-1" });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: "ap-south-1" }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: { rejectUnauthorized: false }, max: 1,
});
const r = await pool.query(`
  SELECT column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases_search_staging' AND column_name='acts_json'
`);
console.log("ACTS_JSON_COL", JSON.stringify(r.rows));
await pool.end();
NODE
