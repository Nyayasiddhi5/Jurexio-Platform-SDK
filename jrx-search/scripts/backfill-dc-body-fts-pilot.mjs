#!/usr/bin/env node
/**
 * NYS-DC-BODY-FTS-PILOT-001 — pilot backfill for DC body_search_tsv (newest first).
 *
 * Default pilot cap: 25,000 rows. Override: DC_BODY_FTS_MAX_ROWS.
 *
 * Worker background:
 *   nohup node /opt/nyv/api/backfill-dc-body-fts-pilot.mjs >> /opt/nyv/logs/dc-body-fts-pilot.log 2>&1 &
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
  process.env.DC_BODY_FTS_CHECKPOINT ??
  "/opt/nyv/api/.dc-body-fts-pilot-checkpoint.json";
const BATCH = Number(process.env.DC_BODY_FTS_BATCH ?? "25");
const CONCURRENCY = Number(process.env.DC_BODY_FTS_CONCURRENCY ?? "1");
const MAX_ROWS = Number(process.env.DC_BODY_FTS_MAX_ROWS ?? "25000");
const MAX_TEXT = 500_000;
const COURT_TYPE = "dc";

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
    return { ...REVERSE_CURSOR_INIT, maxRows: MAX_ROWS, startedAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(CHECKPOINT, "utf8"));
}

function writeCheckpoint(state) {
  mkdirSync(dirname(CHECKPOINT), { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

async function extractText(s3Path, title) {
  const res = await fetch(`${API_BASE}/api/athena/extract`, {
    method: "POST",
    headers: extractAuthHeaders(),
    body: JSON.stringify({ s3Path, title: title ?? undefined }),
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
  const body = await res.json();
  return String(body.text ?? "");
}

async function processRow(pool, row) {
  const text = await extractText(row.pdf_link, row.title);
  const snippet = text.slice(0, MAX_TEXT);
  await pool.query(
    `UPDATE judgments SET body_search_tsv = to_tsvector('english', $2) WHERE id = $1`,
    [row.id, snippet],
  );
}

async function runPool(pool, rows, state) {
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= rows.length) break;
      const row = rows[i];
      try {
        await processRow(pool, row);
        state.done += 1;
      } catch (err) {
        state.errors += 1;
        console.error("ROW_FAIL", row.id, String(err));
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
  const maxRows = state.maxRows ?? MAX_ROWS;
  console.log("DC_BODY_FTS_PILOT_START", {
    courtType: COURT_TYPE,
    order: "newest-first",
    maxRows,
    checkpoint: state,
    batch: BATCH,
    concurrency: CONCURRENCY,
  });

  for (;;) {
    if (state.done >= maxRows) {
      console.log("DC_BODY_FTS_PILOT_COMPLETE", state);
      break;
    }
    const limit = Math.min(BATCH, maxRows - state.done);
    const batch = await pool.query(
      `SELECT id, title, pdf_link, year, decision_date FROM judgments
       WHERE court_type = $4
         AND body_search_tsv IS NULL
         AND pdf_link LIKE 's3://%'
         AND ${REVERSE_WHERE_AFTER_CURSOR}
       ORDER BY ${REVERSE_ORDER_SQL}
       LIMIT $3`,
      [state.cursorDate, state.cursorId, limit, COURT_TYPE],
    );
    if (batch.rowCount === 0) {
      console.log("DC_BODY_FTS_PILOT_EXHAUSTED", state);
      break;
    }
    await runPool(pool, batch.rows, state);
    writeCheckpoint(state);
    console.log("DC_BODY_FTS_PILOT_PROGRESS", state);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("DC_BODY_FTS_PILOT_FAIL", e);
  process.exit(1);
});
