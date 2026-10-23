/**
 * Seed the Constitution of India (code COI) into the statutes corpus.
 * Sources: official text — articles transcribed from the Constitution
 * (civictech-India dataset of the official text) and the 12 Schedules
 * extracted from the official DoLA 2020 edition PDF.
 * Idempotent: deletes only COI rows, then reloads data/seed-constitution.json.
 */
import { eq } from "drizzle-orm";
import { db, statutesTable, pool, insertStatuteSchema } from "@workspace/db";
import { logger } from "./lib/logger";
import { validateConstitutionSeed, type CoiSeedRow } from "./lib/statutesIntegrity";
import { STATUTES_DDL, STATUTES_FTS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";
import seedCoi from "../data/seed-constitution.json";

async function main() {
  const failures = validateConstitutionSeed(seedCoi as unknown as CoiSeedRow[]);
  if (failures.length > 0) {
    for (const f of failures) {
      logger.error({ check: f.name, offenders: f.errors }, "COI seed integrity check failed");
    }
    logger.error(
      { failedChecks: failures.map((f) => f.name) },
      "seed-constitution aborted: seed file failed integrity checks; database untouched",
    );
    await pool.end();
    process.exit(1);
  }

  const rows = (seedCoi as unknown[]).map((r) =>
    insertStatuteSchema.parse({
      ...(r as Record<string, unknown>),
      actName: "The Constitution of India",
      actYear: "1950",
      ministry: "Law and Justice",
      practiceArea: "Constitutional",
      enactmentDate: "1950-01-26",
    }),
  );

  await pool.query(STATUTES_DDL);
  await db.delete(statutesTable).where(eq(statutesTable.code, "COI"));
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(statutesTable).values(rows.slice(i, i + 100));
  }
  await pool.query(STATUTES_FTS_DDL);

  logger.info({ count: rows.length }, "seeded Constitution of India (COI)");
  await warnIfUnembeddedStatutes(pool);
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "seed-constitution failed");
  process.exit(1);
});
