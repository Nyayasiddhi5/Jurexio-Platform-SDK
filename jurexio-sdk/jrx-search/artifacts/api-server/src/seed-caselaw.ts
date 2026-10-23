import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import { db, pool, caselawDocumentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";

const BUCKET =
  "https://indian-supreme-court-judgments.s3.amazonaws.com";
const SOURCE = "in-sc";

const COLUMNS = [
  "title",
  "petitioner",
  "respondent",
  "description",
  "judge",
  "author_judge",
  "citation",
  "case_id",
  "cnr",
  "decision_date",
  "disposal_nature",
  "court",
  "available_languages",
  "year",
];

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function parseLanguages(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function seedYear(year: number): Promise<number> {
  const url = `${BUCKET}/metadata/parquet/year=${year}/metadata.parquet`;
  const file = await asyncBufferFromUrl({ url });
  const rows = await parquetReadObjects({ file, columns: COLUMNS });

  const inserts = rows
    .map((r) => {
      const title = str(r.title);
      if (!title) return null;
      return {
        jurisdiction: "IN",
        source: SOURCE,
        nativeId: str(r.case_id),
        cnr: str(r.cnr),
        title,
        petitioner: str(r.petitioner),
        respondent: str(r.respondent),
        judges: str(r.judge),
        authorJudge: str(r.author_judge),
        citation: str(r.citation),
        decisionDate: str(r.decision_date),
        disposalNature: str(r.disposal_nature),
        court: str(r.court) ?? "Supreme Court of India",
        languages: parseLanguages(r.available_languages),
        year,
        description: str(r.description),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const BATCH = 500;
  for (let i = 0; i < inserts.length; i += BATCH) {
    await db
      .insert(caselawDocumentsTable)
      .values(inserts.slice(i, i + BATCH));
  }
  return inserts.length;
}

async function main() {
  const args = process.argv.slice(2);
  const startYear = args[0] ? parseInt(args[0], 10) : 2015;
  const endYear = args[1] ? parseInt(args[1], 10) : 2025;

  logger.info(
    { startYear, endYear },
    "Seeding Indian Supreme Court caselaw metadata from AWS Open Data",
  );

  await db.execute(
    sql`DELETE FROM caselaw_documents WHERE source = ${SOURCE} AND year >= ${startYear} AND year <= ${endYear}`,
  );

  let total = 0;
  for (let year = startYear; year <= endYear; year++) {
    try {
      const n = await seedYear(year);
      total += n;
      logger.info({ year, count: n }, "Seeded year");
    } catch (err) {
      logger.error({ year, err: String(err) }, "Failed to seed year");
      throw err;
    }
  }

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS caselaw_fts_idx ON caselaw_documents
    USING GIN (to_tsvector('english',
      coalesce(title,'') || ' ' || coalesce(petitioner,'') || ' ' ||
      coalesce(respondent,'') || ' ' || coalesce(description,'') || ' ' ||
      coalesce(citation,'')))
  `);

  logger.info({ total }, "Caselaw seed complete");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Caselaw seed failed");
  process.exit(1);
});
