#!/usr/bin/env node
/**
 * NV-TREATMENT-GRAPH-001 Phase 3 — warm archive_extracts for all SC judgments (newest first).
 *
 * Side effect of /api/athena/extract: text lands in archive_extracts on the app DB.
 * Run on worker (background):
 *   nohup node /opt/nyv/api/nys-treatment-graph-extract.mjs >> /opt/nyv/logs/treatment-graph-extract.log 2>&1 &
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";
import {
  REVERSE_CURSOR_INIT,
  REVERSE_ORDER_SQL,
  REVERSE_WHERE_AFTER_CURSOR,
  advanceReverseCursor,
} from "./_reverse-cursor.mjs";
import { extractAuthHeaders } from "./_extract-auth.mjs";

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";
const API_BASE = process.env.NYS_LOCAL_API ?? "http://127.0.0.1:8080";
const CHECKPOINT =
  process.env.TREATMENT_GRAPH_EXTRACT_CHECKPOINT ??
  "/opt/nyv/api/.treatment-graph-extract-checkpoint.json";
const BATCH = Number(process.env.TREATMENT_GRAPH_EXTRACT_BATCH ?? "40");
const CONCURRENCY = Number(process.env.TREATMENT_GRAPH_EXTRACT_CONCURRENCY ?? "2");

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
  if (!inst?.Endpoint?.Address) throw new Error(`RDS ${DB_INSTANCE_ID} not available`);
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) throw new Error("no MasterUserSecret");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(secret.SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl: sslConfig(),
    max: CONCURRENCY + 1,
    connectionTimeoutMillis: 15_000,
  });
}

function readCheckpoint() {
  if (!existsSync(CHECKPOINT)) {
    return { ...REVERSE_CURSOR_INIT, startedAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(CHECKPOINT, "utf8"));
}

function writeCheckpoint(state) {
  mkdirSync(dirname(CHECKPOINT), { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

async function extractOne(row) {
  const res = await fetch(`${API_BASE}/api/athena/extract`, {
    method: "POST",
    headers: extractAuthHeaders(),
    body: JSON.stringify({ s3Path: row.pdf_link, title: row.title ?? undefined }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 503) {
    const err = new Error("extract gate saturated");
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function runPool(rows, state) {
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= rows.length) break;
      const row = rows[i];
      try {
        await extractOne(row);
        state.done += 1;
      } catch (err) {
        state.errors += 1;
        console.error("EXTRACT_FAIL", row.id, String(err));
        if (err.retryable) await new Promise((r) => setTimeout(r, 30_000));
      }
      advanceReverseCursor(state, row);
      if (state.done % 10 === 0) writeCheckpoint(state);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

async function main() {
  loadEnv();
  const pool = await buildPool();
  const state = readCheckpoint();
  console.log("TREATMENT_GRAPH_EXTRACT_START", {
    order: "newest-first",
    checkpoint: state,
    batch: BATCH,
    concurrency: CONCURRENCY,
  });

  for (;;) {
    const batch = await pool.query(
      `SELECT id, title, pdf_link, year, decision_date FROM judgments
       WHERE court_type = 'sc'
         AND pdf_link LIKE 's3://%'
         AND ${REVERSE_WHERE_AFTER_CURSOR}
       ORDER BY ${REVERSE_ORDER_SQL}
       LIMIT $3`,
      [state.cursorDate, state.cursorId, BATCH],
    );
    if (batch.rowCount === 0) {
      console.log("TREATMENT_GRAPH_EXTRACT_COMPLETE", state);
      break;
    }
    await runPool(batch.rows, state);
    writeCheckpoint(state);
    console.log("TREATMENT_GRAPH_EXTRACT_PROGRESS", state);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("TREATMENT_GRAPH_EXTRACT_FAIL", e);
  process.exit(1);
});
