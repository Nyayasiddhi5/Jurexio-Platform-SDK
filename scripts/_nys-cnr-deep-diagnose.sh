#!/usr/bin/env bash
# Deep CNR diagnose on caselaw-worker — RDS locks, EXPLAIN, case_details, idle tx.
set -uo pipefail
cd /opt/nyv/api || exit 1
node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB = "nyv-caselaw-pg";
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

console.log("=== IDLE IN TX ===");
const idle = await pool.query(`
  SELECT pid, state, wait_event_type, wait_event,
         now() - xact_start AS xact_age,
         left(query, 80) AS q
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state = 'idle in transaction (aborted)'
  ORDER BY xact_start NULLS LAST
  LIMIT 10`);
console.log("aborted_idle_count", idle.rowCount);
for (const r of idle.rows) console.log(JSON.stringify(r));

console.log("=== EXPLAIN TSWL ===");
try {
  const ex = await pool.query(
    "EXPLAIN (FORMAT TEXT) SELECT id FROM judgments WHERE cnr = $1 LIMIT 1",
    ["TSWL000000742024"],
  );
  console.log(ex.rows.map((r) => r["QUERY PLAN"]).join("\n"));
} catch (e) {
  console.log("EXPLAIN_ERR", e.code, String(e).slice(0, 120));
}

for (const cnr of ["TSWL000000742024", "RJHC010324382023"]) {
  console.log(`=== LOOKUP ${cnr} ===`);
  for (const table of ["judgments", "cnr_case_details"]) {
    const t0 = Date.now();
    try {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE cnr = $1`,
        [cnr],
      );
      console.log(table, "count", res.rows[0].n, "ms", Date.now() - t0);
    } catch (e) {
      console.log(table, "ERR", e.code, "ms", Date.now() - t0);
    }
  }
}

console.log("=== DC CNR SAMPLE ===");
const dc = await pool.query(`
  SELECT cnr, court_type, left(title,60) AS title
  FROM judgments
  WHERE court_type = 'dc' AND cnr IS NOT NULL AND cnr <> ''
  LIMIT 3`);
console.log("dc_samples", dc.rowCount, dc.rows);

console.log("=== EMBED ACTIVITY ===");
const embed = await pool.query(`
  SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND query ILIKE '%embed%' AND state = 'active'`);
console.log("active_embed_queries", embed.rows[0].n);

await pool.end();
NODE
