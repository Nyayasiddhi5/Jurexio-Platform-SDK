import { createHash } from "node:crypto";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import type { Pool } from "pg";
import { getRdsPool } from "./lib/rdsPool";
import { logger } from "./lib/logger";

const REGION = "ap-south-1";
const SC_BUCKET = "indian-supreme-court-judgments";
const HC_BUCKET = "indian-high-court-judgments";
/** vanga Open Data — district courts (CC-BY-4.0). */
const DC_BUCKET = "indian-district-court-judgments";
/**
 * NV-NYS-DC-NATIONAL-001 — District-court ingest scope.
 *
 * Historically scope-locked to Andhra Pradesh + Telangana (the two states whose
 * district-level corpus had been validated). CNR resolve therefore returned
 * `not_found` for every other state's DC case. The vanga District Open Data
 * bucket actually carries ~32 state prefixes per year, so the lock — not the
 * data — was the coverage ceiling.
 *
 * Scope is now selectable without another rebuild:
 *   - unset            → default AP + TG (unchanged; preserves the product lock)
 *   - `NYS_DC_STATE_CODES=all`      → every state code observed on S3 (national)
 *   - `NYS_DC_STATE_CODES=2,29,3,…` → explicit subset
 *
 * `name` is used only for logging; unknown codes fall back to `state-<code>`
 * (no fabricated data). State codes/names are the eCourts/vanga standard.
 */
const DC_STATE_NAMES: Readonly<Record<string, string>> = {
  "1": "Jammu and Kashmir",
  "2": "Andhra Pradesh",
  "3": "Bihar",
  "4": "Chhattisgarh",
  "5": "Sikkim",
  "6": "Haryana",
  "7": "Himachal Pradesh",
  "8": "Rajasthan",
  "9": "Uttar Pradesh",
  "10": "Meghalaya",
  "11": "Tamil Nadu",
  "12": "Delhi",
  "13": "Karnataka",
  "14": "Kerala",
  "15": "Madhya Pradesh",
  "16": "Maharashtra",
  "17": "Manipur",
  "18": "Odisha",
  "20": "Punjab",
  "21": "Tripura",
  "22": "Uttarakhand",
  "23": "West Bengal",
  "24": "Gujarat",
  "25": "Jharkhand",
  "26": "Goa",
  "27": "Assam",
  "28": "Arunachal Pradesh",
  "29": "Telangana",
  "30": "Mizoram",
  "33": "Nagaland",
  "36": "Chandigarh",
  "37": "Andaman and Nicobar Islands",
};

/** State codes observed on `s3://indian-district-court-judgments` (2024/2025). */
const ALL_DC_STATE_CODES: readonly string[] = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
  "15", "16", "17", "18", "20", "21", "22", "23", "24", "25", "26", "27", "28",
  "29", "30", "33", "36", "37",
];

const DEFAULT_DC_STATE_CODES: readonly string[] = ["2", "29"];

function resolveDcStateCodes(): string[] {
  const raw = (process.env.NYS_DC_STATE_CODES ?? "").trim();
  if (!raw) return [...DEFAULT_DC_STATE_CODES];
  if (raw.toLowerCase() === "all" || raw.toLowerCase() === "national") {
    return [...ALL_DC_STATE_CODES];
  }
  const codes = raw
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  return codes.length > 0 ? codes : [...DEFAULT_DC_STATE_CODES];
}

const DC_STATES: ReadonlyArray<{ code: string; name: string }> = resolveDcStateCodes().map(
  (code) => ({ code, name: DC_STATE_NAMES[code] ?? `state-${code}` }),
);
const DC_STATE_CODES = new Set<string>(DC_STATES.map((s) => s.code));
const s3 = new S3Client({ region: REGION });

/** NV-CORPUS-REVERSE-2026-001 — smaller batches + longer timeout for DC parquet upserts. */
const INGEST_BATCH_SIZE = Math.max(
  25,
  parseInt(process.env.INGEST_BATCH_SIZE ?? "500", 10) || 500,
);
const INGEST_REVERSE_YEARS = process.env.INGEST_REVERSE_YEARS === "1";

function yearRange(startYear: number, endYear: number): number[] {
  const years: number[] = [];
  if (INGEST_REVERSE_YEARS) {
    for (let y = endYear; y >= startYear; y--) years.push(y);
  } else {
    for (let y = startYear; y <= endYear; y++) years.push(y);
  }
  return years;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s.length) return null;
  const lower = s.toLowerCase();
  if (lower === "null" || lower === "none" || lower === "nan") return null;
  return s;
}

function dateStr(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // Source parquet sometimes uses DD-MM-YYYY (e.g. SC decision_date "13-05-2020").
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1800 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

type JudgmentRow = {
  courtType: "sc" | "hc" | "dc";
  courtCode: string | null;
  court: string;
  bench: string | null;
  benchName: string | null;
  year: number;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  judges: string | null;
  authorJudge: string | null;
  citation: string | null;
  cnr: string | null;
  caseType: string | null;
  caseNo: string | null;
  judicialSection: string | null;
  decisionDate: string | null;
  dateOfRegistration: string | null;
  disposalNature: string | null;
  petAdvocate: string | null;
  resAdvocate: string | null;
  firNo: string | null;
  lowerCourt: string | null;
  purposeName: string | null;
  orderNumber: string | null;
  isFinal: boolean | null;
  languages: string | null;
  description: string | null;
  pdfLink: string | null;
  source: string;
};

const COLS = [
  "court_type", "court_code", "court", "bench", "bench_name", "year", "title",
  "petitioner", "respondent", "judges", "author_judge", "citation", "cnr",
  "case_type", "case_no", "judicial_section", "decision_date",
  "date_of_registration", "disposal_nature", "pet_advocate", "res_advocate",
  "fir_no", "lower_court", "purpose_name", "order_number", "is_final",
  "languages", "description", "pdf_link", "source", "dedupe_hash",
] as const;

function rowValues(r: JudgmentRow): unknown[] {
  const hash = createHash("md5")
    .update(
      [
        r.courtType, r.courtCode, r.cnr, r.caseNo, r.title, r.decisionDate,
        r.orderNumber, r.pdfLink, r.source,
      ].join("|"),
    )
    .digest("hex");
  return [
    r.courtType, r.courtCode, r.court, r.bench, r.benchName, r.year, r.title,
    r.petitioner, r.respondent, r.judges, r.authorJudge, r.citation, r.cnr,
    r.caseType, r.caseNo, r.judicialSection, r.decisionDate,
    r.dateOfRegistration, r.disposalNature, r.petAdvocate, r.resAdvocate,
    r.firNo, r.lowerCourt, r.purposeName, r.orderNumber, r.isFinal,
    r.languages, r.description, r.pdfLink, r.source, hash,
  ];
}

async function insertBatch(pool: Pool, rows: JudgmentRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INGEST_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INGEST_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((r, ri) => {
        const vals = rowValues(r);
        values.push(...vals);
        const base = ri * COLS.length;
        return `(${vals.map((_, ci) => `$${base + ci + 1}`).join(",")})`;
      })
      .join(",");
    const res = await pool.query(
      `INSERT INTO judgments (${COLS.join(",")}) VALUES ${placeholders}
       ON CONFLICT (dedupe_hash) DO NOTHING`,
      values,
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
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

async function listKeys(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const o = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
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

async function readParquet(
  bucket: string,
  key: string,
): Promise<Record<string, unknown>[]> {
  const url = `https://${bucket}.s3.${REGION}.amazonaws.com/${encodeURI(key)}`;
  const file = await asyncBufferFromUrl({ url });
  return parquetReadObjects({ file });
}

/** Owned SC PDF bucket: extracted English judgment PDFs keyed by parquet `path`. */
export const SC_PDF_BUCKET = "your-supreme-court-data-bucket"; // owned SC PDF estate (live; name is legacy — not a placeholder)

export function scPdfS3Path(path: string | null, year: number): string | null {
  if (!path || !/^[A-Za-z0-9_-]+$/.test(path)) return null;
  return `s3://${SC_PDF_BUCKET}/data/tar/year=${year}/english/${path}_EN.pdf`;
}

function mapScRow(r: Record<string, unknown>, year: number): JudgmentRow | null {
  const title = str(r.title);
  if (!title) return null;
  return {
    courtType: "sc",
    courtCode: null,
    court: str(r.court) ?? "Supreme Court of India",
    bench: null,
    benchName: null,
    year,
    title,
    petitioner: str(r.petitioner),
    respondent: str(r.respondent),
    judges: str(r.judge),
    authorJudge: str(r.author_judge),
    citation: str(r.citation),
    cnr: str(r.cnr),
    caseType: null,
    caseNo: str(r.case_id),
    judicialSection: null,
    decisionDate: dateStr(r.decision_date),
    dateOfRegistration: null,
    disposalNature: str(r.disposal_nature),
    petAdvocate: null,
    resAdvocate: null,
    firNo: null,
    lowerCourt: null,
    purposeName: null,
    orderNumber: null,
    isFinal: null,
    languages: str(r.available_languages),
    description: str(r.description),
    pdfLink: scPdfS3Path(str(r.path), year),
    source: "in-sc",
  };
}

function mapHcRow(
  r: Record<string, unknown>,
  year: number,
  bench: string,
): JudgmentRow | null {
  const title = str(r.title);
  if (!title) return null;
  const firNo = str(r.fir_no);
  const firYear = str(r.fir_year);
  return {
    courtType: "hc",
    courtCode: str(r.court_code),
    court: str(r.court) ?? "High Court",
    bench,
    benchName: str(r.bench_name),
    year,
    title,
    petitioner: str(r.petitioner),
    respondent: str(r.respondent),
    judges: str(r.judge),
    authorJudge: null,
    citation: null,
    cnr: str(r.cnr),
    caseType: str(r.case_type),
    caseNo: str(r.case_no),
    judicialSection: str(r.judicial_section),
    decisionDate: dateStr(r.decision_date),
    dateOfRegistration: dateStr(r.date_of_registration),
    disposalNature: str(r.disposal_nature),
    petAdvocate: str(r.pet_advocate),
    resAdvocate: str(r.res_advocate),
    firNo: firNo && firNo !== "0" ? `${firNo}${firYear && firYear !== "0" ? "/" + firYear : ""}` : null,
    lowerCourt: str(r.lower_court),
    purposeName: str(r.purpose_name),
    orderNumber: str(r.order_number),
    isFinal: typeof r.is_final === "boolean" ? r.is_final : null,
    languages: null,
    description: str(r.description),
    pdfLink: str(r.pdf_link),
    source: `in-hc-${str(r.source) ?? "web"}`,
  };
}

/**
 * District Open Data parquet (`cases.parquet`) uses `cino` as the CNR-equivalent.
 * Parties are not in this aggregate file — title is synthesised for search/resolve.
 */
function mapDcRow(
  r: Record<string, unknown>,
  year: number,
): JudgmentRow | null {
  const stateCode = str(r.state_code);
  if (!stateCode || !DC_STATE_CODES.has(stateCode)) return null;
  const cnr = str(r.cino)?.toUpperCase() ?? null;
  if (!cnr) return null;
  const caseType = str(r.case_type);
  const caseNo = str(r.case_no);
  const district = str(r.district_name) ?? "District";
  const complexName = str(r.complex_name);
  const stateName = str(r.state_name) ?? stateCode;
  const title =
    [caseType, caseNo ? `No. ${caseNo}` : null, "·", district, "District Court"]
      .filter(Boolean)
      .join(" ") || `District case ${cnr}`;
  const districtCode = str(r.district_code);
  const complexCode = str(r.complex_code);
  const hasPdf = r.has_pdf === true || r.has_pdf === "true" || r.has_pdf === 1;
  const finalOrders = Number(str(r.final_orders) ?? "0");
  const interimOrders = Number(str(r.interim_orders) ?? "0");
  const pdfLink =
    hasPdf && districtCode && complexCode
      ? `s3://${DC_BUCKET}/data/tar/year=${year}/state=${stateCode}/district=${districtCode}/complex=${complexCode}/`
      : null;
  const regYear = parseInt(str(r.reg_year) ?? String(year), 10);
  return {
    courtType: "dc",
    courtCode: complexCode ?? `${stateCode}-${districtCode ?? "x"}`,
    court: complexName ?? `${district} District Court`,
    bench: districtCode,
    benchName: district,
    year: Number.isFinite(regYear) ? regYear : year,
    title,
    petitioner: null,
    respondent: null,
    judges: null,
    authorJudge: null,
    citation: null,
    cnr,
    caseType,
    caseNo,
    judicialSection: null,
    decisionDate: dateStr(r.date_of_decision),
    dateOfRegistration: dateStr(r.date_of_filing),
    disposalNature: null,
    petAdvocate: null,
    resAdvocate: null,
    firNo: null,
    lowerCourt: null,
    purposeName: null,
    orderNumber: null,
    isFinal: Number.isFinite(finalOrders) ? finalOrders > 0 : hasPdf ? true : null,
    languages: null,
    description: [
      stateName,
      district,
      complexName,
      hasPdf ? "has_pdf" : null,
      Number.isFinite(finalOrders) ? `final_orders=${finalOrders}` : null,
      Number.isFinite(interimOrders) ? `interim_orders=${interimOrders}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    pdfLink,
    source: `in-dc-${stateCode}`,
  };
}

async function ingestSc(pool: Pool, startYear: number, endYear: number) {
  for (const year of yearRange(startYear, endYear)) {
    const partKey = `sc/${year}`;
    if (await isDone(pool, partKey)) {
      logger.info({ partKey }, "Skipping (already ingested)");
      continue;
    }
    const keys = await listKeys(SC_BUCKET, `metadata/parquet/year=${year}/`);
    let total = 0;
    for (const key of keys) {
      const raw = await readParquet(SC_BUCKET, key);
      const rows = raw
        .map((r) => mapScRow(r, year))
        .filter((r): r is JudgmentRow => r !== null);
      total += await insertBatch(pool, rows);
    }
    await markDone(pool, partKey, total);
    logger.info({ partKey, total }, "SC year ingested");
  }
}

async function ingestHc(pool: Pool, startYear: number, endYear: number) {
  for (const year of yearRange(startYear, endYear)) {
    const yearPrefix = `metadata/parquet/year=${year}/`;
    const keys = await listKeys(HC_BUCKET, yearPrefix);
    const byPartition = new Map<string, string[]>();
    for (const key of keys) {
      const m = key.match(/year=\d+\/(court=[^/]+)\/(bench=[^/]+)\//);
      const part = m ? `hc/${year}/${m[1]}/${m[2]}` : `hc/${year}/root`;
      const list = byPartition.get(part) ?? [];
      list.push(key);
      byPartition.set(part, list);
    }
    let yearTotal = 0;
    let skipped = 0;
    for (const [partKey, partKeys] of byPartition) {
      if (await isDone(pool, partKey)) {
        skipped++;
        continue;
      }
      const benchMatch = partKey.match(/bench=([^/]+)$/);
      const bench = benchMatch ? benchMatch[1] : "unknown";
      let partTotal = 0;
      let partFailed = 0;
      for (const key of partKeys) {
        try {
          const raw = await readParquet(HC_BUCKET, key);
          const rows = raw
            .map((r) => mapHcRow(r, year, bench))
            .filter((r): r is JudgmentRow => r !== null);
          partTotal += await insertBatch(pool, rows);
        } catch (err) {
          partFailed++;
          logger.error({ key, err: String(err) }, "Failed to read parquet file");
        }
      }
      if (partFailed === 0) {
        await markDone(pool, partKey, partTotal);
      } else {
        logger.warn(
          { partKey, failedFiles: partFailed },
          "Partition NOT checkpointed due to file failures; will retry on next run",
        );
      }
      yearTotal += partTotal;
    }
    logger.info(
      { year, partitions: byPartition.size, skipped, inserted: yearTotal },
      "HC year ingested",
    );
  }
}

async function ingestDc(pool: Pool, startYear: number, endYear: number) {
  // Public Open Data: prefer HTTPS object GET. Instance role may lack s3:ListBucket
  // on indian-district-court-judgments — do not rely on ListObjectsV2.
  const CANDIDATE_FILES = ["cases.parquet", "metadata.parquet"] as const;
  for (const year of yearRange(startYear, endYear)) {
    for (const state of DC_STATES) {
      const partKey = `dc/${year}/state=${state.code}`;
      if (await isDone(pool, partKey)) {
        logger.info({ partKey, state: state.name }, "Skipping (already ingested)");
        continue;
      }
      const prefix = `metadata/parquet/year=${year}/state=${state.code}/`;
      let partTotal = 0;
      let partFailed = 0;
      let filesRead = 0;
      for (const file of CANDIDATE_FILES) {
        const key = `${prefix}${file}`;
        try {
          const raw = await readParquet(DC_BUCKET, key);
          filesRead++;
          const rows = raw
            .map((r) => mapDcRow(r, year))
            .filter((r): r is JudgmentRow => r !== null);
          partTotal += await insertBatch(pool, rows);
          // Prefer cases.parquet; stop after first successful file for the partition.
          break;
        } catch (err) {
          const msg = String(err);
          // Missing object for sparse historical years — try next candidate / skip.
          if (/404|Not Found|status.?code.?404|HTTP.?404/i.test(msg)) {
            logger.info({ key }, "DC parquet not present — try next / skip year");
            continue;
          }
          partFailed++;
          logger.error({ key, err: msg }, "Failed to read DC parquet file");
        }
      }
      if (filesRead === 0 && partFailed === 0) {
        logger.info({ partKey }, "No DC parquet for partition — skip checkpoint");
        continue;
      }
      if (partFailed === 0 && filesRead > 0) {
        await markDone(pool, partKey, partTotal);
      } else if (partFailed > 0) {
        logger.warn(
          { partKey, failedFiles: partFailed },
          "DC partition NOT checkpointed due to file failures; will retry on next run",
        );
      }
      logger.info(
        { partKey, state: state.name, inserted: partTotal, filesRead },
        "DC state-year ingested",
      );
    }
  }
}

async function clearPartition(pool: Pool, key: string): Promise<void> {
  await pool.query("DELETE FROM ingest_progress WHERE partition_key = $1", [key]);
}

type IngestMode = "sc" | "hc" | "dc" | "all";

/**
 * Weekly delta: re-open current + previous calendar year partitions so new
 * Open Data parquet drops are picked up (ON CONFLICT DO NOTHING inserts only new rows).
 */
async function clearRecentYearCheckpoints(
  pool: Pool,
  mode: IngestMode,
  years: number[],
): Promise<string[]> {
  const cleared: string[] = [];
  for (const year of years) {
    if (mode === "sc" || mode === "all") {
      const key = `sc/${year}`;
      await clearPartition(pool, key);
      cleared.push(key);
    }
    if (mode === "hc" || mode === "all") {
      const r = await pool.query<{ partition_key: string }>(
        `SELECT partition_key FROM ingest_progress WHERE partition_key LIKE $1`,
        [`hc/${year}/%`],
      );
      for (const row of r.rows) {
        await clearPartition(pool, row.partition_key);
        cleared.push(row.partition_key);
      }
      // Also clear bare year root if present
      const root = `hc/${year}/root`;
      await clearPartition(pool, root);
      cleared.push(root);
    }
    if (mode === "dc" || mode === "all") {
      const r = await pool.query<{ partition_key: string }>(
        `SELECT partition_key FROM ingest_progress WHERE partition_key LIKE $1`,
        [`dc/${year}/%`],
      );
      for (const row of r.rows) {
        await clearPartition(pool, row.partition_key);
        cleared.push(row.partition_key);
      }
      // Also clear known AP/TG keys even if not yet checkpointed
      for (const state of DC_STATES) {
        const key = `dc/${year}/state=${state.code}`;
        await clearPartition(pool, key);
        if (!cleared.includes(key)) cleared.push(key);
      }
    }
  }
  return cleared;
}

async function main() {
  // Batch ingest needs a longer ceiling than the API default (25s).
  if (!process.env.RDS_STATEMENT_TIMEOUT_MS) {
    process.env.RDS_STATEMENT_TIMEOUT_MS = "600000";
  }
  const [mode, a, b] = process.argv.slice(2);
  const nowYear = new Date().getUTCFullYear();
  const isDelta =
    mode === "delta" ||
    mode === "delta-sc" ||
    mode === "delta-hc" ||
    mode === "delta-dc";
  const ingestMode: IngestMode | string = isDelta
    ? mode === "delta-sc"
      ? "sc"
      : mode === "delta-hc"
        ? "hc"
        : mode === "delta-dc"
          ? "dc"
          : "all"
    : mode;
  const startYear = isDelta
    ? nowYear - 1
    : a
      ? parseInt(a, 10)
      : 1950;
  const endYear = isDelta ? nowYear : b ? parseInt(b, 10) : 2026;
  if (
    ingestMode !== "sc" &&
    ingestMode !== "hc" &&
    ingestMode !== "dc" &&
    ingestMode !== "all"
  ) {
    logger.error(
      "Usage: ingest-rds <sc|hc|dc|all|delta|delta-sc|delta-hc|delta-dc> [startYear] [endYear]",
    );
    process.exit(1);
  }
  const pool = await getRdsPool();
  if (isDelta) {
    const years = yearRange(startYear, endYear);
    const cleared = await clearRecentYearCheckpoints(
      pool,
      ingestMode as IngestMode,
      years,
    );
    logger.info(
      { years, cleared: cleared.length, sample: cleared.slice(0, 5) },
      "Delta: cleared recent-year ingest_progress checkpoints",
    );
  }
  logger.info(
    {
      mode: ingestMode,
      startYear,
      endYear,
      isDelta,
      reverseYears: INGEST_REVERSE_YEARS,
      batchSize: INGEST_BATCH_SIZE,
      statementTimeoutMs: process.env.RDS_STATEMENT_TIMEOUT_MS,
      dcStates: DC_STATES.map((s) => `${s.code}:${s.name}`),
    },
    "RDS ingest starting",
  );
  if (ingestMode === "sc" || ingestMode === "all") await ingestSc(pool, startYear, endYear);
  if (ingestMode === "hc" || ingestMode === "all") await ingestHc(pool, startYear, endYear);
  if (ingestMode === "dc" || ingestMode === "all") await ingestDc(pool, startYear, endYear);
  const counts = await pool.query(
    `SELECT court_type, count(*)::bigint AS n
     FROM judgments
     WHERE court_type IN ('sc', 'hc', 'dc')
     GROUP BY court_type`,
  );
  logger.info({ counts: counts.rows }, "RDS ingest complete");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "RDS ingest failed");
  process.exit(1);
});
