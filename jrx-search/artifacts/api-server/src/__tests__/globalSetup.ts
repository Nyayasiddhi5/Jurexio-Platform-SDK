/**
 * Vitest global setup: pre-flight the dev DB data state before any suite runs.
 *
 * Several suites assume the dev DB matches the seed files:
 *  - legal_tasks vs data/seed-tasks.json (incl. jurisdiction tagging —
 *    all-GLOBAL drift broke the jurisdiction-segregation suite three times)
 *  - templates (seeded library rows, is_custom=false) vs data/seed-templates.json
 *  - statutes core codes (BNS/BNSS/BSA/IPC/CrPC/IEA/USC) vs expected counts
 *  - statutes embedding coverage 100% (NULL embeddings silently degrade
 *    hybrid retrieval to keyword-only)
 *
 * Checks live in ../lib/devDataIntegrity.ts, shared with the standalone
 * `pnpm --filter @workspace/api-server run check:devdata` command. On drift,
 * this pre-flight self-heals by running the check's remediation script
 * (loudly), so a full test run recovers from dev-DB drift instead of failing
 * downstream in confusing ways. The templates reseed only replaces
 * is_custom=false rows; the statutes reseed only replaces core-seed codes;
 * embed:statutes is resumable and only fills NULL embeddings.
 *
 * Exception: when AI_PROVIDER=bedrock (production-style embedder), embedding
 * backfill is NOT run automatically (it costs real API calls) — the
 * remediation command is printed and setup fails instead.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import {
  checkTaskJurisdictionDistribution,
  checkTemplateDistribution,
  checkCoreStatuteCounts,
  checkStatuteEmbeddingCoverage,
  type DevDataCheckResult,
} from "../lib/devDataIntegrity";

export default async function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "..", "..", "data");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    heal(await checkTaskJurisdictionDistribution(pool, dataDir), "seed");
    heal(await checkTemplateDistribution(pool, dataDir), "seed:templates");
    heal(await checkCoreStatuteCounts(pool), "seed:statutes");

    // Embedding coverage last: the reseeds above may have inserted fresh
    // (unembedded) rows, so re-check after they've run.
    const emb = await checkStatuteEmbeddingCoverage(pool);
    if (!emb.ok) {
      if (process.env.AI_PROVIDER === "bedrock") {
        throw new Error(
          `[test pre-flight] ${emb.name} drifted — ${emb.detail}. ` +
            `Not auto-healing with a paid embedder; run: ${emb.remediation}`,
        );
      }
      heal(emb, "embed:statutes");
    }
  } finally {
    await pool.end();
  }
}

function heal(result: DevDataCheckResult, script: string) {
  if (result.ok) return;
  // eslint-disable-next-line no-console
  console.warn(
    `\n[test pre-flight] dev DB drift detected in ${result.name} — ${result.detail}.\n` +
      `[test pre-flight] running "${script}" before running suites (manual fix: ${result.remediation})...\n`,
  );
  execFileSync("pnpm", ["--filter", "@workspace/api-server", "run", script], {
    stdio: "inherit",
  });
  // eslint-disable-next-line no-console
  console.warn(`[test pre-flight] ${result.name} remediation complete.\n`);
}
