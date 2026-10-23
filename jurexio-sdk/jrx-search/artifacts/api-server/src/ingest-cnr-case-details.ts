/**
 * Sync HC Open Data `metadata/parquet_case_details` → RDS `cnr_case_details`.
 *
 * Usage:
 *   tsx src/ingest-cnr-case-details.ts [limitPartitions]
 *
 * Public bucket: s3://indian-high-court-judgments/ (no-sign-request via HTTPS).
 * License: CC-BY-4.0 (vanga).
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import type { Pool } from "pg";
import { getRdsPool } from "./lib/rdsPool";
import { logger } from "./lib/logger";

const REGION = "ap-south-1";
const HC_BUCKET = "indian-high-court-judgments";
const PREFIX = "metadata/parquet_case_details/";
const s3 = new S3Client({ region: REGION });

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 && s !== "null" ? s : null;
}

function dateStr(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1800 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
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
      if (k.Key && k.Key.endsWith(".parquet")) keys.push(k.Key);
    }
    token = o.IsTruncated ? o.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function readParquet(key: string): Promise<Record<string, unknown>[]> {
  const url = `https://${HC_BUCKET}.s3.${REGION}.amazonaws.com/${encodeURI(key)}`;
  const file = await asyncBufferFromUrl({ url });
  return parquetReadObjects({ file });
}

async function isDone(pool: Pool, key: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM ingest_progress WHERE partition_key = $1",
    [key],
  );
  return (r.rowCount ?? 0) > 0;
}

async function markDone(pool: Pool, key: string, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO ingest_progress (partition_key, row_count) VALUES ($1, $2)
     ON CONFLICT (partition_key) DO UPDATE SET row_count = $2, completed_at = now()`,
    [key, count],
  );
}

async function upsertRows(
  pool: Pool,
  rows: Record<string, unknown>[],
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const cnr = str(r.cnr)?.toUpperCase().replace(/[\s\-_.]/g, "");
    if (!cnr || cnr.length < 10) continue;
    const acts =
      r.acts_sections ?? r.acts ?? r.sections ?? [];
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
         pet_advocate = COALESCE(EXCLUDED.pet_advocate, cnr_case_details.pet_advocate),
         res_advocate = COALESCE(EXCLUDED.res_advocate, cnr_case_details.res_advocate),
         judges = COALESCE(EXCLUDED.judges, cnr_case_details.judges),
         filing_date = COALESCE(EXCLUDED.filing_date, cnr_case_details.filing_date),
         decision_date = COALESCE(EXCLUDED.decision_date, cnr_case_details.decision_date),
         disposal_nature = COALESCE(EXCLUDED.disposal_nature, cnr_case_details.disposal_nature),
         case_status = COALESCE(EXCLUDED.case_status, cnr_case_details.case_status),
         acts_sections = EXCLUDED.acts_sections,
         hearings = EXCLUDED.hearings,
         linked_cases = EXCLUDED.linked_cases,
         raw = EXCLUDED.raw,
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
  const pool = await getRdsPool();
  // Ensure DDL tables exist
  await pool.query(`
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
  `);

  const keys = await listKeys(PREFIX);
  logger.info({ count: keys.length }, "cnr case_details parquet keys listed");
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
      logger.info({ key, n, processed }, "cnr case_details partition synced");
      if (limitPartitions > 0 && processed >= limitPartitions) break;
    } catch (err) {
      logger.warn({ key, err: String(err) }, "cnr case_details partition failed");
    }
  }
  logger.info({ processed, upserted }, "cnr case_details sync complete");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "cnr case_details ingest failed");
  process.exit(1);
});
