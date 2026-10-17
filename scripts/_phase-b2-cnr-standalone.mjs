#!/usr/bin/env node
/**
 * Phase B-2 standalone CNR case_details ingest — no pino bundle dependency.
 * Usage: node _phase-b2-cnr-standalone.mjs [limitPartitions]
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
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
const HC_BUCKET = "indian-high-court-judgments";
const PREFIX = "metadata/parquet_case_details/";
const s3 = new S3Client({ region: REGION });

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 && s !== "null" ? s : null;
}

function dateStr(v) {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1800 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

async function buildPool() {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }),
  );
  const inst = desc.DBInstances?.[0];
  const secretArn = inst?.MasterUserSecret?.SecretArn;
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
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
}

async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const o = await s3.send(
      new ListObjectsV2Command({
        Bucket: HC_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const k of o.Contents ?? []) {
      if (k.Key?.endsWith(".parquet")) keys.push(k.Key);
    }
    token = o.IsTruncated ? o.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function readParquet(key) {
  const url = `https://${HC_BUCKET}.s3.${REGION}.amazonaws.com/${encodeURI(key)}`;
  const file = await asyncBufferFromUrl({ url });
  return parquetReadObjects({ file });
}

async function isDone(pool, key) {
  const r = await pool.query(
    "SELECT 1 FROM ingest_progress WHERE partition_key = $1",
    [key],
  );
  return (r.rowCount ?? 0) > 0;
}

async function markDone(pool, key, count) {
  await pool.query(
    `INSERT INTO ingest_progress (partition_key, row_count) VALUES ($1, $2)
     ON CONFLICT (partition_key) DO UPDATE SET row_count = $2, completed_at = now()`,
    [key, count],
  );
}

async function upsertRows(pool, rows) {
  let n = 0;
  for (const r of rows) {
    const cnr = str(r.cnr)?.toUpperCase().replace(/[\s\-_.]/g, "");
    if (!cnr || cnr.length < 10) continue;
    const acts = r.acts_sections ?? r.acts ?? r.sections ?? [];
    const hearings = r.hearings ?? r.hearing_details ?? [];
    const linked = r.linked_cases ?? r.linked ?? [];
    await pool.query(
      `INSERT INTO cnr_case_details (
         cnr, court_code, bench, case_type, case_no, petitioner, respondent,
         pet_advocate, res_advocate, judges, filing_date, decision_date,
         disposal_nature, case_status, acts_sections, hearings, linked_cases,
         raw, source, synced_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13,$14,
         $15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,'opendata_hc_case_details',now(),now()
       )
       ON CONFLICT (cnr) DO UPDATE SET
         court_code = COALESCE(EXCLUDED.court_code, cnr_case_details.court_code),
         bench = COALESCE(EXCLUDED.bench, cnr_case_details.bench),
         case_type = COALESCE(EXCLUDED.case_type, cnr_case_details.case_type),
         case_no = COALESCE(EXCLUDED.case_no, cnr_case_details.case_no),
         petitioner = COALESCE(EXCLUDED.petitioner, cnr_case_details.petitioner),
         respondent = COALESCE(EXCLUDED.respondent, cnr_case_details.respondent),
         updated_at = now()`,
      [
        cnr,
        str(r.court_code),
        str(r.bench),
        str(r.case_type),
        str(r.case_no),
        str(r.petitioner),
        str(r.respondent),
        str(r.pet_advocate),
        str(r.res_advocate),
        str(r.judge) ?? str(r.judges),
        dateStr(r.date_of_registration) ?? dateStr(r.filing_date),
        dateStr(r.decision_date),
        str(r.disposal_nature),
        str(r.case_status) ?? str(r.status),
        JSON.stringify(acts),
        JSON.stringify(hearings),
        JSON.stringify(linked),
        JSON.stringify(r),
      ],
    );
    n += 1;
  }
  return n;
}

async function main() {
  const limitPartitions = Number(process.argv[2] ?? "0") || 0;
  const pool = await buildPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingest_progress (
      partition_key TEXT PRIMARY KEY,
      row_count INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const keys = await listKeys(PREFIX);
  console.log("CNR_STANDALONE keys", keys.length, "limit", limitPartitions);
  let processed = 0;
  let upserted = 0;
  for (const key of keys) {
    const progressKey = `hc-case-details/${key}`;
    if (await isDone(pool, progressKey)) continue;
    try {
      const rows = await readParquet(key);
      const n = await upsertRows(pool, rows);
      await markDone(pool, progressKey, n);
      upserted += n;
      processed += 1;
      console.log("CNR_PARTITION", { key, n, processed, upserted });
      if (limitPartitions > 0 && processed >= limitPartitions) break;
    } catch (err) {
      console.error("CNR_PARTITION_FAIL", key, String(err));
    }
  }
  const count = await pool.query("SELECT count(*)::text c FROM cnr_case_details");
  console.log("CNR_STANDALONE_DONE", { processed, upserted, total: count.rows[0].c });
  await pool.end();
}

main().catch((err) => {
  console.error("CNR_STANDALONE_FAIL", err);
  process.exit(1);
});
