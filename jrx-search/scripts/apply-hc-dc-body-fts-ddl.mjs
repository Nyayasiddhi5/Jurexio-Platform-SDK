#!/usr/bin/env node
/**
 * NYS-HC-DC-BODY-FTS-001 — partial GIN indexes for HC/DC body_search_tsv.
 * Column already exists from NYS-SC-BODY-FTS-001; this adds court-specific indexes.
 *
 * Run on caselaw worker: node /opt/nyv/api/apply-hc-dc-body-fts-ddl.mjs
 */
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

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";

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

function sslConfig() {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (caPath && existsSync(caPath)) {
    return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  }
  return { rejectUnauthorized: false };
}

async function buildPool() {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }),
  );
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) {
    throw new Error(`RDS ${DB_INSTANCE_ID} not available`);
  }
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) throw new Error("no MasterUserSecret");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const creds = JSON.parse(secret.SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl: sslConfig(),
    max: 2,
    connectionTimeoutMillis: 15_000,
  });
}

const HC_DC_DDL = `
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS body_search_tsv tsvector;
CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_hc_body_search_tsv_idx
  ON judgments USING GIN (body_search_tsv)
  WHERE court_type = 'hc';
CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_dc_body_search_tsv_idx
  ON judgments USING GIN (body_search_tsv)
  WHERE court_type = 'dc';
`;

async function main() {
  loadEnv();
  const pool = await buildPool();
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    // CONCURRENTLY cannot run inside transaction block
    for (const stmt of HC_DC_DDL.split(";").filter((s) => s.trim())) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }
  const r = await pool.query(`
    SELECT court_type, count(*)::bigint AS body_indexed
    FROM judgments
    WHERE court_type IN ('hc','dc') AND body_search_tsv IS NOT NULL
    GROUP BY court_type
  `);
  console.log("HC_DC_BODY_FTS_DDL_OK", JSON.stringify(r.rows));
  await pool.end();
}

main().catch((e) => {
  console.error("HC_DC_BODY_FTS_DDL_FAIL", e);
  process.exit(1);
});
