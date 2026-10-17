#!/usr/bin/env node
/**
 * NYS-SC-BODY-FTS-001 — add body_search_tsv + partial GIN index on SC rows.
 *
 * Run on caselaw worker: node /opt/nyv/api/apply-sc-body-fts-ddl.mjs
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

const BODY_FTS_DDL = `
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS body_search_tsv tsvector;
CREATE INDEX IF NOT EXISTS judgments_sc_body_search_tsv_idx
  ON judgments USING GIN (body_search_tsv)
  WHERE court_type = 'sc';
`;

async function main() {
  loadEnv();
  const pool = await buildPool();
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query(BODY_FTS_DDL);
  } finally {
    client.release();
  }
  const r = await pool.query(`
    SELECT
      (SELECT count(*)::bigint FROM information_schema.columns
         WHERE table_name = 'judgments' AND column_name = 'body_search_tsv') AS col,
      (SELECT count(*)::int FROM pg_indexes
         WHERE indexname = 'judgments_sc_body_search_tsv_idx') AS idx,
      (SELECT count(*)::bigint FROM judgments
         WHERE court_type = 'sc' AND body_search_tsv IS NOT NULL) AS sc_body_indexed
  `);
  console.log("SC_BODY_FTS_DDL_OK", JSON.stringify(r.rows[0]));
  await pool.end();
}

main().catch((e) => {
  console.error("SC_BODY_FTS_DDL_FAIL", e);
  process.exit(1);
});
