import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db, legalTasksTable } from "@workspace/db";
import type { Criterion } from "@workspace/db";
import { categoryName } from "./lib/categories";
import { validateTasksSeed, type TaskSeedRow } from "./lib/seedIntegrity";

type SeedTask = {
  category: string;
  slug: string;
  title: string;
  work_type: string;
  tags: string[];
  instructions: string;
  deliverables: Record<string, unknown> | string[];
  documents: string[];
  jurisdiction: string;
  criteria: { id: string; title: string; match_criteria: string }[];
};

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "data", "seed-tasks.json");
  const tasks = JSON.parse(readFileSync(path, "utf-8")) as SeedTask[];

  // Pre-flight: same integrity checks as the vitest suite (check:tasks).
  // Refuse to touch the DB if the seed file is corrupted.
  const failures = validateTasksSeed(tasks as unknown as TaskSeedRow[]);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`tasks seed integrity check failed [${f.name}]:`);
      for (const e of f.errors) console.error(`  - ${e}`);
    }
    console.error("seed aborted: seed-tasks.json failed integrity checks; database untouched");
    process.exit(1);
  }

  await db.delete(legalTasksTable);

  const rows = tasks.map((t) => {
    const deliverables = Array.isArray(t.deliverables)
      ? t.deliverables
      : Object.keys(t.deliverables ?? {});
    const criteria: Criterion[] = (t.criteria ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      matchCriteria: c.match_criteria,
    }));
    return {
      category: t.category,
      categoryName: categoryName(t.category),
      slug: t.slug,
      title: t.title,
      workType: t.work_type,
      jurisdiction: t.jurisdiction,
      tags: t.tags ?? [],
      instructions: t.instructions,
      deliverables,
      documents: t.documents ?? [],
      criteria,
    };
  });

  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(legalTasksTable).values(rows.slice(i, i + 50));
  }

  console.log(`Seeded ${rows.length} legal tasks.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
