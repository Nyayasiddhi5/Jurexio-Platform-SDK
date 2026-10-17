import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, templatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import { validateTemplatesSeed, type TemplateSeedRow } from "./lib/seedIntegrity";

interface SeedTemplate {
  kind: string;
  slug: string;
  title: string;
  category: string;
  jurisdiction: string;
  description: string;
  tags: string[];
  body: string;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../data/seed-templates.json");
  const items = JSON.parse(readFileSync(file, "utf8")) as SeedTemplate[];

  // Pre-flight: same integrity checks as the vitest suite (check:templates).
  // Refuse to touch the DB if the seed file is corrupted.
  const failures = validateTemplatesSeed(items as unknown as TemplateSeedRow[]);
  if (failures.length > 0) {
    for (const f of failures) {
      logger.error({ check: f.name, offenders: f.errors }, "templates seed integrity check failed");
    }
    logger.error(
      { failedChecks: failures.map((f) => f.name) },
      "seed-templates aborted: seed file failed integrity checks; database untouched",
    );
    process.exit(1);
  }

  // Reseed replaces ONLY the seeded library rows. User-created (custom)
  // templates must survive every reseed.
  await db.delete(templatesTable).where(eq(templatesTable.isCustom, false));
  for (const t of items) {
    await db.insert(templatesTable).values({
      kind: t.kind,
      slug: t.slug,
      title: t.title,
      category: t.category,
      jurisdiction: t.jurisdiction,
      description: t.description,
      tags: t.tags,
      body: t.body,
    });
  }
  logger.info({ count: items.length }, "templates seeded");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: String(err) }, "template seeding failed");
  process.exit(1);
});
