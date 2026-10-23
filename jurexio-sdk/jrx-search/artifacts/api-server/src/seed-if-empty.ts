/**
 * Ensure the dev database has its seed corpora loaded.
 * Checks each seedable table and runs the corresponding seeder ONLY if the
 * table is empty (or missing). Safe to run on every post-merge setup:
 * already-seeded tables are left untouched, so it stays fast and never
 * clobbers data.
 */
import { execFileSync } from "node:child_process";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

interface Target {
  table: string;
  script: string;
  label: string;
}

const TARGETS: Target[] = [
  { table: "legal_tasks", script: "seed", label: "benchmark tasks" },
  { table: "templates", script: "seed:templates", label: "template library" },
  { table: "statutes", script: "seed:statutes", label: "statutes corpus" },
];

async function countRows(table: string): Promise<number | null> {
  try {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    return (res.rows[0] as { n: number }).n;
  } catch {
    // Table doesn't exist yet — treat as empty.
    return null;
  }
}

async function main() {
  const toSeed: Target[] = [];
  for (const t of TARGETS) {
    const n = await countRows(t.table);
    if (n === null || n === 0) {
      logger.warn({ table: t.table }, `${t.label} is empty — seeding`);
      toSeed.push(t);
    } else {
      logger.info({ table: t.table, rows: n }, `${t.label} already seeded — skipping`);
    }
  }
  await pool.end();

  for (const t of toSeed) {
    logger.info({ script: t.script }, `running seeder for ${t.label}`);
    execFileSync("pnpm", ["--filter", "@workspace/api-server", "run", t.script], {
      stdio: "inherit",
    });
  }

  if (toSeed.length > 0) {
    logger.info({ seeded: toSeed.map((t) => t.table) }, "seed-if-empty completed");
  }
}

main().catch((err) => {
  logger.error({ err }, "seed-if-empty failed");
  process.exit(1);
});
