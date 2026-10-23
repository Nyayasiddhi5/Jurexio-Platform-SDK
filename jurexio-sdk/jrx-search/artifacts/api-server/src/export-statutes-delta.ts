/**
 * Export statutes rows changed since a cutoff timestamp as JSONL, for
 * syncing a refresh-run delta to the production nyvapp DB.
 *
 * Always use this Node exporter — never `psql \copy`, which mangles escapes
 * in statute text.
 *
 * Usage (dev DB via DATABASE_URL):
 *   pnpm --filter @workspace/api-server run export:statutes-delta -- \
 *     --since 2026-07-09T00:00:00.000Z [--out /tmp/statutes-delta.jsonl]
 *
 * The output feeds the prod loader (load-statutes-appdb.mjs) via
 * scripts/sync-statutes-delta.mjs (S3 upload + SSM run on the EC2 worker).
 */
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { STATUTES_DDL } from "./lib/statutesDdl";

// Keyset-paginated so a large delta (e.g. the first export after the
// updated_at column backfill) never loads the whole corpus into memory.
const EXPORT_SQL = `
SELECT id, code, jurisdiction, section, usc_title, heading, chapter, text,
       mapped_code, mapped_sections, change_notes, act_name, act_year,
       act_no, ministry, department, practice_area, provision_type,
       enactment_date, source_act_id
FROM statutes
WHERE updated_at >= $1 AND id > $2
ORDER BY id
LIMIT 500`;

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const since = getArg("--since");
  const out = getArg("--out") ?? "/tmp/statutes-delta.jsonl";
  if (!since || Number.isNaN(Date.parse(since))) {
    logger.error(
      "usage: export-statutes-delta --since <ISO timestamp> [--out <file>]",
    );
    process.exit(1);
  }

  // Idempotent — guarantees the updated_at column/index exist even if the
  // export runs before any refresh ingest touched this database.
  await pool.query(STATUTES_DDL);

  const ws = createWriteStream(out, "utf8");
  let total = 0;
  let lastId = 0;
  const codes = new Set<string>();
  for (;;) {
    const { rows } = await pool.query(EXPORT_SQL, [since, lastId]);
    if (rows.length === 0) break;
    for (const { id, ...row } of rows) {
      lastId = id as number;
      codes.add(row.code as string);
      if (!ws.write(JSON.stringify(row) + "\n")) await once(ws, "drain");
      total++;
    }
  }
  ws.end();
  await once(ws, "finish");

  if (total === 0) {
    logger.warn({ since }, "export-statutes-delta: no rows changed since cutoff — nothing to export");
  } else {
    logger.info(
      { since, out, rows: total, codes: codes.size },
      "export-statutes-delta: complete — next: cd scripts && node sync-statutes-delta.mjs " + out,
    );
  }
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "export-statutes-delta failed");
  process.exit(1);
});
