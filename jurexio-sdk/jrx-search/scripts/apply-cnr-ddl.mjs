#!/usr/bin/env node
/**
 * Apply CNR corpus DDL on nyv-caselaw-pg.
 * Extends judgments.court_type CHECK for district (`dc`) while preserving
 * US corpus values (`us-fed`, `us-ny`). Uses NOT VALID + optional VALIDATE
 * so large tables do not block on a full rewrite under short timeouts.
 *
 * Run on worker: node /opt/nyv/api/apply-cnr-ddl.mjs
 * Optional: NYS_VALIDATE_COURT_TYPE=1 to VALIDATE CONSTRAINT (slow on 20M+ rows)
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
const ALLOWED = ["sc", "hc", "dc", "us-fed", "us-ny"];

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

const CNR_DDL = `
CREATE INDEX IF NOT EXISTS judgments_cnr_upper_idx
  ON judgments (upper(btrim(cnr)))
  WHERE cnr IS NOT NULL AND btrim(cnr) <> '';

CREATE TABLE IF NOT EXISTS cnr_case_details (
  cnr TEXT PRIMARY KEY,
  court_code TEXT,
  bench TEXT,
  case_type TEXT,
  case_no TEXT,
  petitioner TEXT,
  respondent TEXT,
  pet_advocate TEXT,
  res_advocate TEXT,
  judges TEXT,
  filing_date DATE,
  decision_date DATE,
  disposal_nature TEXT,
  case_status TEXT,
  acts_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  hearings JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB,
  source TEXT NOT NULL DEFAULT 'opendata_hc_case_details',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cnr_case_details_court_idx ON cnr_case_details (court_code);
CREATE INDEX IF NOT EXISTS cnr_case_details_case_no_idx ON cnr_case_details (case_no);

CREATE TABLE IF NOT EXISTS cnr_resolve_metrics (
  day DATE NOT NULL DEFAULT (CURRENT_DATE),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, status, source)
);
`;

async function ensureCourtTypeCheck(pool) {
  const list = ALLOWED.map((v) => `'${v}'`).join(", ");
  const checkSql = `CHECK (court_type IN (${list}))`;

  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("BEGIN");
    await client.query(
      `ALTER TABLE judgments DROP CONSTRAINT IF EXISTS judgments_court_type_check`,
    );
    // NOT VALID: new inserts/updates are still enforced; existing rows skipped (fast).
    await client.query(
      `ALTER TABLE judgments
         ADD CONSTRAINT judgments_court_type_check ${checkSql} NOT VALID`,
    );
    await client.query("COMMIT");
    console.log("COURT_TYPE_CHECK_ADDED_NOT_VALID", checkSql);

    if (process.env.NYS_VALIDATE_COURT_TYPE === "1") {
      console.log("VALIDATING_COURT_TYPE_CHECK…");
      await client.query(
        `ALTER TABLE judgments VALIDATE CONSTRAINT judgments_court_type_check`,
      );
      console.log("COURT_TYPE_CHECK_VALIDATED");
    } else {
      console.log(
        "COURT_TYPE_CHECK_SKIP_VALIDATE set NYS_VALIDATE_COURT_TYPE=1 to validate later",
      );
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  const chk = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def, convalidated
     FROM pg_constraint
     WHERE conname = 'judgments_court_type_check'`,
  );
  console.log("COURT_TYPE_CHECK", JSON.stringify(chk.rows[0] ?? null));
}

async function main() {
  loadEnv();
  const pool = await buildPool();
  await ensureCourtTypeCheck(pool);
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query(CNR_DDL);
  } finally {
    client.release();
  }
  const r = await pool.query(`
    SELECT to_regclass('public.cnr_case_details') AS cnr_case_details,
           to_regclass('public.cnr_resolve_metrics') AS cnr_resolve_metrics,
           (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'judgments_cnr_upper_idx') AS cnr_idx,
           (SELECT pg_get_constraintdef(oid) FROM pg_constraint
             WHERE conname = 'judgments_court_type_check' LIMIT 1) AS court_type_check,
           (SELECT convalidated FROM pg_constraint
             WHERE conname = 'judgments_court_type_check' LIMIT 1) AS court_type_validated,
           (SELECT count(*)::bigint FROM judgments WHERE court_type = 'dc') AS dc_rows
  `);
  console.log("DDL_OK", JSON.stringify(r.rows[0]));
  await pool.end();
}

main().catch((e) => {
  console.error("DDL_FAIL", e);
  process.exit(1);
});
