#!/usr/bin/env bash
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB = "jrx-caselaw-pg";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB }));
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
const idx = await pool.query(
  "SELECT indexname FROM pg_indexes WHERE tablename='judgments' AND indexname LIKE '%cnr%'",
);
console.log("cnr indexes", idx.rows.map((r) => r.indexname));
for (const cnr of ["TSWL000000742024", "RJHC010324382023"]) {
  for (const timeout of [8000, 30000]) {
    const t0 = Date.now();
    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      const res = await client.query(
        "SELECT id, cnr, court_type FROM judgments WHERE cnr = $1 LIMIT 1",
        [cnr],
      );
      await client.query("COMMIT");
      console.log(cnr, "timeout", timeout, "rows", res.rowCount, "ms", Date.now() - t0);
    } catch (e) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {}
      }
      console.log(cnr, "timeout", timeout, "ERR", e.code, "ms", Date.now() - t0);
    } finally {
      client?.release();
    }
  }
}
await pool.end();
NODE
