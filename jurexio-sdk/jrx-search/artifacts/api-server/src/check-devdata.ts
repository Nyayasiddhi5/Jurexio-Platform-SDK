/**
 * Verify the dev database's DATA STATE hasn't drifted from what the test
 * suites and features expect. Verification only — never mutates the DB.
 *
 * Checks (shared with the vitest pre-flight via lib/devDataIntegrity.ts):
 *  - legal_tasks jurisdiction distribution matches data/seed-tasks.json
 *  - seeded template distribution matches data/seed-templates.json
 *  - core statutes row counts (BNS/BNSS/BSA/IPC/CrPC/IEA/USC) match
 *  - statutes embedding coverage is 100%
 *
 * On failure, prints a one-line remediation command per drifted check and
 * exits 1.
 *
 * Usage: pnpm --filter @workspace/api-server run check:devdata
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { runDevDataChecks } from "./lib/devDataIntegrity";

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "..", "data");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let results;
  try {
    results = await runDevDataChecks(pool, dataDir);
  } finally {
    await pool.end();
  }

  const failures = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.name}: ${r.detail}`);
    } else {
      console.error(`✗ ${r.name}: ${r.detail}`);
      console.error(`  → fix: ${r.remediation}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\ncheck:devdata FAILED — dev DB data state has drifted (${failures.length} check(s)).` +
        `\nRun the fix command(s) above, then re-run this check.`,
    );
    process.exit(1);
  }
  console.log("\ncheck:devdata OK — dev DB data state matches expectations.");
}

main().catch((err) => {
  console.error("check:devdata errored:", err);
  process.exit(1);
});
