#!/usr/bin/env node
/** One-shot DC ingest smoke — run on worker after GO. No secrets logged. */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";

function loadEnv() {
  const p = process.env.NYS_ENV_FILE || "/opt/nyv/api/.env";
  if (!existsSync(p)) return;
  for (const ln of readFileSync(p, "utf8").split(/\n/)) {
    if (!ln.trim() || ln.startsWith("#") || !ln.includes("=")) continue;
    const i = ln.indexOf("=");
    const k = ln.slice(0, i).trim();
    let v = ln.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const REGION = "ap-south-1";
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }),
  );
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) throw new Error("no endpoint");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }),
  );
  const creds = JSON.parse(secret.SecretString);
  const caPath = process.env.RDS_CA_BUNDLE;
  const ssl =
    caPath && existsSync(caPath)
      ? { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") }
      : { rejectUnauthorized: false };
  const pool = new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 60000");
    const cnr = process.argv[2] || "TSWL000000742024";
    const hit = await client.query(
      `SELECT id, court_type, court, bench_name, year, left(title,120) AS title, cnr, source
       FROM judgments WHERE cnr = $1 LIMIT 3`,
      [cnr],
    );
    const dc = await client.query(
      `SELECT count(*)::bigint AS n FROM judgments WHERE court_type = 'dc'`,
    );
    const ck = await client.query(
      `SELECT partition_key, row_count FROM ingest_progress
       WHERE partition_key LIKE 'dc/%' ORDER BY 1`,
    );
    console.log(
      JSON.stringify(
        { cnr, dc_rows: dc.rows[0].n, hit: hit.rows, checkpoints: ck.rows },
        null,
        2,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("SMOKE_FAIL", e);
  process.exit(1);
});
