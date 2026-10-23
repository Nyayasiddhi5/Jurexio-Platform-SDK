#!/usr/bin/env node
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
  const p = "/opt/nyv/api/.env";
  if (!existsSync(p)) return;
  for (const ln of readFileSync(p, "utf8").split(/\n/)) {
    if (!ln.trim() || ln.startsWith("#") || !ln.includes("=")) continue;
    const i = ln.indexOf("=");
    const k = ln.slice(0, i).trim();
    let v = ln.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function pool() {
  const rds = new RDSClient({ region: "ap-south-1" });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }),
  );
  const inst = desc.DBInstances?.[0];
  const sm = new SecretsManagerClient({ region: "ap-south-1" });
  const sec = await sm.send(
    new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }),
  );
  const c = JSON.parse(sec.SecretString);
  const ca = process.env.RDS_CA_BUNDLE
    ? { rejectUnauthorized: true, ca: readFileSync(process.env.RDS_CA_BUNDLE, "utf8") }
    : { rejectUnauthorized: false };
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port,
    database: inst.DBName || "nyv_caselaw",
    user: c.username,
    password: c.password,
    ssl: ca,
    statement_timeout: 20_000,
  });
}

async function main() {
  loadEnv();
  const cnr = process.argv[2] || "RJHC010324382023";
  const p = await pool();
  let t0 = Date.now();
  try {
    const ex = await p.query(
      "EXPLAIN (FORMAT TEXT) SELECT id FROM judgments WHERE cnr = $1 LIMIT 25",
      [cnr],
    );
    console.log(
      "EXPLAIN_EQ",
      ex.rows.map((r) => r["QUERY PLAN"]).join(" | "),
    );
    const r = await p.query(
      "SELECT id, court FROM judgments WHERE cnr = $1 LIMIT 5",
      [cnr],
    );
    console.log("EQ_OK", Date.now() - t0, "rows", r.rowCount, "court", r.rows[0]?.court);
  } catch (e) {
    console.log("EQ_FAIL", Date.now() - t0, String(e).slice(0, 240));
  }
  t0 = Date.now();
  try {
    const r = await p.query(
      "SELECT id FROM judgments WHERE cnr = $1 OR upper(btrim(cnr)) = $1 LIMIT 25",
      [cnr],
    );
    console.log("OR_OK", Date.now() - t0, "rows", r.rowCount);
  } catch (e) {
    console.log("OR_FAIL", Date.now() - t0, String(e).slice(0, 240));
  }
  await p.end();

  const key = (process.env.NYS_SDK_API_KEYS || "").split(",")[0]?.trim();
  console.log("KEY_LEN", key?.length || 0);
  const res = await fetch("http://127.0.0.1:8080/api/cnr/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key || "",
    },
    body: JSON.stringify({ cnr, options: { includeDocuments: false } }),
  });
  const body = await res.json().catch(() => ({}));
  const data = body.data || {};
  console.log(
    "API",
    res.status,
    body.success,
    data.status,
    data.source,
    data.meta?.latencyMs,
    body.error || null,
  );
}

main().catch((e) => {
  console.error("PROBE_FAIL", e);
  process.exit(1);
});
