/**
 * Seed the statutes corpus (BNS/BNSS/BSA/IPC/CrPC/IEA + selected US Code).
 * Idempotent: clears and reloads data/seed-statutes.json, then (re)creates
 * the FTS GIN index used by /statutes/search.
 */
import { inArray } from "drizzle-orm";
import { db, statutesTable, pool, insertStatuteSchema } from "@workspace/db";
import { logger } from "./lib/logger";
import {
  validateStatutesSeed,
  EXPECTED_COUNTS,
  type StatuteSeedRow,
} from "./lib/statutesIntegrity";
import { STATUTES_DDL, STATUTES_FTS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";
import seedStatutes from "../data/seed-statutes.json";

async function main() {
  // Pre-flight: same integrity checks as the vitest suite (check:statutes).
  // Refuse to touch the DB if the seed file is corrupted.
  const failures = validateStatutesSeed(seedStatutes as unknown as StatuteSeedRow[]);
  if (failures.length > 0) {
    for (const f of failures) {
      logger.error({ check: f.name, offenders: f.errors }, "statutes seed integrity check failed");
    }
    logger.error(
      { failedChecks: failures.map((f) => f.name) },
      "seed-statutes aborted: seed file failed integrity checks; database untouched",
    );
    await pool.end();
    process.exit(1);
  }

  const rows = (seedStatutes as unknown[]).map((r) => insertStatuteSchema.parse(r));

  await pool.query(STATUTES_DDL);
  // Delete only the codes this seed file owns — the statutes table now also
  // holds the Constitution (COI) and the India Code central-Acts corpus,
  // which are loaded by their own seeders and must survive a re-seed.
  const ownedCodes = Object.keys(EXPECTED_COUNTS);
  await db
    .delete(statutesTable)
    .where(inArray(statutesTable.code, ownedCodes));
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(statutesTable).values(rows.slice(i, i + 100));
  }

  await pool.query(STATUTES_FTS_DDL);

  logger.info({ count: rows.length }, "seeded statutes corpus");
  await warnIfUnembeddedStatutes(pool);
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "seed-statutes failed");
  process.exit(1);
});
