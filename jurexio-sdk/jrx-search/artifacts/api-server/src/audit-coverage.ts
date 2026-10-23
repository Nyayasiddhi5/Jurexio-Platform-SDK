/**
 * Coverage audit: compares RDS judgments counts per court/year against the
 * AWS Open Data source parquet manifests (footer row counts), and diffs the
 * source partition list against ingest_progress checkpoints.
 *
 * Usage: tsx src/audit-coverage.ts <sc|hc|all> [startYear] [endYear]
 * Writes a JSON gap report to AUDIT_REPORT_PATH (default ./coverage-report.json).
 */
import { writeFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { asyncBufferFromUrl, parquetMetadataAsync } from "hyparquet";
import type { Pool } from "pg";
import { getRdsPool } from "./lib/rdsPool";
import { logger } from "./lib/logger";

const REGION = "ap-south-1";
const SC_BUCKET = "indian-supreme-court-judgments";
const HC_BUCKET = "indian-high-court-judgments";
const s3 = new S3Client({ region: REGION });

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

async function parquetNumRows(bucket: string, key: string): Promise<number> {
  const url = `https://${bucket}.s3.${REGION}.amazonaws.com/${encodeURI(key)}`;
  const file = await asyncBufferFromUrl({ url });
  const meta = await parquetMetadataAsync(file);
  return Number(meta.num_rows);
}

type Gap = {
  partition: string;
  sourceRows: number;
  dbRows: number;
  checkpointed: boolean;
};

type Report = {
  generatedAt: string;
  mode: string;
  startYear: number;
  endYear: number;
  sc?: { totalSourceRows: number; totalDbRows: number; gaps: Gap[] };
  hc?: { totalSourceRows: number; totalDbRows: number; gaps: Gap[] };
};

/** A partition is a gap when db < source beyond the expected dedupe margin. */
const DEDUPE_MARGIN = 0.02;

async function progressKeys(pool: Pool): Promise<Set<string>> {
  const r = await pool.query<{ partition_key: string }>(
    "SELECT partition_key FROM ingest_progress",
  );
  return new Set(r.rows.map((x) => x.partition_key));
}

async function auditSc(
  pool: Pool,
  startYear: number,
  endYear: number,
  done: Set<string>,
): Promise<NonNullable<Report["sc"]>> {
  const dbCounts = await pool.query<{ year: number; n: string }>(
    "SELECT year, count(*) AS n FROM judgments WHERE court_type = 'sc' GROUP BY year",
  );
  const dbByYear = new Map(dbCounts.rows.map((r) => [Number(r.year), Number(r.n)]));
  const gaps: Gap[] = [];
  let totalSource = 0;
  let totalDb = 0;
  for (let year = startYear; year <= endYear; year++) {
    const keys = await listKeys(SC_BUCKET, `metadata/parquet/year=${year}/`);
    if (keys.length === 0) continue;
    let sourceRows = 0;
    for (const key of keys) sourceRows += await parquetNumRows(SC_BUCKET, key);
    const dbRows = dbByYear.get(year) ?? 0;
    totalSource += sourceRows;
    totalDb += dbRows;
    const checkpointed = done.has(`sc/${year}`);
    if (dbRows < sourceRows * (1 - DEDUPE_MARGIN) || !checkpointed) {
      gaps.push({ partition: `sc/${year}`, sourceRows, dbRows, checkpointed });
    }
    logger.info({ year, sourceRows, dbRows }, "SC year audited");
  }
  return { totalSourceRows: totalSource, totalDbRows: totalDb, gaps };
}

async function auditHc(
  pool: Pool,
  startYear: number,
  endYear: number,
  done: Set<string>,
): Promise<NonNullable<Report["hc"]>> {
  logger.info("Counting HC rows per year/bench in RDS (single scan)...");
  const dbCounts = await pool.query<{ year: number; bench: string | null; n: string }>(
    "SELECT year, bench, count(*) AS n FROM judgments WHERE court_type = 'hc' GROUP BY year, bench",
  );
  const dbByPart = new Map(
    dbCounts.rows.map((r) => [`${Number(r.year)}/${r.bench ?? "unknown"}`, Number(r.n)]),
  );
  const gaps: Gap[] = [];
  let totalSource = 0;
  let totalDb = 0;
  const countedDbParts = new Set<string>();
  for (let year = startYear; year <= endYear; year++) {
    const keys = await listKeys(HC_BUCKET, `metadata/parquet/year=${year}/`);
    if (keys.length === 0) continue;
    // Group parquet files by court/bench partition (same keying as ingest).
    const byPartition = new Map<string, string[]>();
    for (const key of keys) {
      const m = key.match(/year=\d+\/(court=[^/]+)\/(bench=[^/]+)\//);
      const part = m ? `hc/${year}/${m[1]}/${m[2]}` : `hc/${year}/root`;
      const list = byPartition.get(part) ?? [];
      list.push(key);
      byPartition.set(part, list);
    }
    let yearSource = 0;
    let yearDb = 0;
    for (const [part, partKeys] of byPartition) {
      let sourceRows = 0;
      for (const key of partKeys) {
        try {
          sourceRows += await parquetNumRows(HC_BUCKET, key);
        } catch (err) {
          logger.error({ key, err: String(err) }, "footer read failed");
        }
      }
      const benchMatch = part.match(/bench=([^/]+)$/);
      const bench = benchMatch ? benchMatch[1] : "unknown";
      const dbKey = `${year}/${bench}`;
      const dbRows = dbByPart.get(dbKey) ?? 0;
      countedDbParts.add(dbKey);
      yearSource += sourceRows;
      yearDb += dbRows;
      const checkpointed = done.has(part);
      if (dbRows < sourceRows * (1 - DEDUPE_MARGIN) || !checkpointed) {
        gaps.push({ partition: part, sourceRows, dbRows, checkpointed });
      }
    }
    totalSource += yearSource;
    totalDb += yearDb;
    logger.info(
      { year, partitions: byPartition.size, sourceRows: yearSource, dbRows: yearDb },
      "HC year audited",
    );
  }
  return { totalSourceRows: totalSource, totalDbRows: totalDb, gaps };
}

async function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode !== "sc" && mode !== "hc" && mode !== "all") {
    logger.error("Usage: audit-coverage <sc|hc|all> [startYear] [endYear]");
    process.exit(1);
  }
  const startYear = a ? parseInt(a, 10) : 1950;
  const endYear = b ? parseInt(b, 10) : 2026;
  const pool = await getRdsPool();
  const client = await pool.connect();
  await client.query("SET statement_timeout = '900s'");
  const done = await progressKeys(client as unknown as Pool);
  const report: Report = {
    generatedAt: new Date().toISOString(),
    mode,
    startYear,
    endYear,
  };
  const poolLike = client as unknown as Pool;
  if (mode === "sc" || mode === "all") {
    report.sc = await auditSc(poolLike, startYear, endYear, done);
  }
  if (mode === "hc" || mode === "all") {
    report.hc = await auditHc(poolLike, startYear, endYear, done);
  }
  client.release();
  const out = process.env.AUDIT_REPORT_PATH ?? "./coverage-report.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  logger.info(
    {
      out,
      sc: report.sc
        ? { source: report.sc.totalSourceRows, db: report.sc.totalDbRows, gaps: report.sc.gaps.length }
        : undefined,
      hc: report.hc
        ? { source: report.hc.totalSourceRows, db: report.hc.totalDbRows, gaps: report.hc.gaps.length }
        : undefined,
    },
    "coverage audit complete",
  );
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "coverage audit failed");
  process.exit(1);
});
