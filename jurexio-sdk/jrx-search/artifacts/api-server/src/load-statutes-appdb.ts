/**
 * Production loader: bulk-load exported statutes rows (JSONL) into the app DB.
 *
 * Used to ship the Constitution (COI) + India Code central-Acts corpus from
 * the dev database to the production nyvapp DB on RDS. Runs on the EC2 worker
 * (bundled via esbuild; DATABASE_URL from worker .env):
 *
 *   node dist/load-statutes-appdb.mjs /opt/nyv/data/statutes-export.jsonl
 *
 * Each JSONL line is one row with snake_case keys matching the export query.
 * Idempotent: upserts ON CONFLICT (code, section); applies the shared DDL
 * (including ALTER TABLE ADD COLUMN IF NOT EXISTS) first, and rebuilds the
 * FTS index afterwards. Never deletes rows belonging to other seeders.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { STATUTES_DDL, STATUTES_FTS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";

interface ExportRow {
  code: string;
  jurisdiction: string;
  section: string;
  usc_title: string | null;
  heading: string;
  chapter: string | null;
  text: string;
  mapped_code: string | null;
  mapped_sections: unknown;
  change_notes: string | null;
  act_name: string | null;
  act_year: string | null;
  act_no: string | null;
  ministry: string | null;
  department: string | null;
  practice_area: string | null;
  provision_type: string | null;
  enactment_date: string | null;
  source_act_id: string | null;
}

async function upsertBatch(rows: ExportRow[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = 19;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const base = i * cols;
    values.push(
      r.code, r.jurisdiction, r.section, r.usc_title, r.heading, r.chapter,
      r.text, r.mapped_code, JSON.stringify(r.mapped_sections ?? []),
      r.change_notes, r.act_name, r.act_year, r.act_no, r.ministry,
      r.department, r.practice_area, r.provision_type ?? "section",
      r.enactment_date, r.source_act_id,
    );
    return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(",")})`;
  });
  await pool.query(
    `INSERT INTO statutes (code, jurisdiction, section, usc_title, heading,
       chapter, text, mapped_code, mapped_sections, change_notes, act_name,
       act_year, act_no, ministry, department, practice_area, provision_type,
       enactment_date, source_act_id)
     VALUES ${tuples.join(",")}
     ON CONFLICT (code, section) DO UPDATE SET
       usc_title = EXCLUDED.usc_title, heading = EXCLUDED.heading,
       chapter = EXCLUDED.chapter, text = EXCLUDED.text,
       mapped_code = EXCLUDED.mapped_code,
       mapped_sections = EXCLUDED.mapped_sections,
       change_notes = EXCLUDED.change_notes, act_name = EXCLUDED.act_name,
       act_year = EXCLUDED.act_year, act_no = EXCLUDED.act_no,
       ministry = EXCLUDED.ministry, department = EXCLUDED.department,
       practice_area = EXCLUDED.practice_area,
       provision_type = EXCLUDED.provision_type,
       enactment_date = EXCLUDED.enactment_date,
       source_act_id = EXCLUDED.source_act_id`,
    values,
  );
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    logger.error("usage: load-statutes-appdb <export.jsonl>");
    process.exit(1);
  }

  await pool.query(STATUTES_DDL);

  const rl = createInterface({
    input: createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  let batch: ExportRow[] = [];
  let total = 0;
  let badLines = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: ExportRow;
    try {
      row = JSON.parse(trimmed) as ExportRow;
    } catch {
      badLines++;
      continue;
    }
    if (!row.code || !row.section || !row.heading || row.text == null) {
      badLines++;
      continue;
    }
    batch.push(row);
    if (batch.length >= 200) {
      await upsertBatch(batch);
      total += batch.length;
      batch = [];
      if (total % 5000 === 0) logger.info({ total }, "load-statutes: progress");
    }
  }
  await upsertBatch(batch);
  total += batch.length;

  if (badLines > 0) logger.warn({ badLines }, "load-statutes: skipped malformed lines");
  logger.info("load-statutes: rebuilding FTS index…");
  await pool.query(STATUTES_FTS_DDL);

  const { rows: counts } = await pool.query(
    `SELECT count(*)::int AS rows, count(DISTINCT code)::int AS codes FROM statutes`,
  );
  logger.info({ loaded: total, table: counts[0] }, "load-statutes: complete");
  await warnIfUnembeddedStatutes(pool);
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "load-statutes-appdb failed");
  process.exit(1);
});
