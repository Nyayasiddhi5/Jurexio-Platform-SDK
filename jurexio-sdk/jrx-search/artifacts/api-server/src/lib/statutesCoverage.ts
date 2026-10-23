/**
 * Embedding-coverage guard for statute data loaders (seeders/ingesters).
 * Newly written rows have NULL embeddings, so the vector leg of hybrid
 * search silently skips them until `embed:statutes` is re-run. Every loader
 * calls this at the end of a run so the drift is loud and actionable.
 */
import type { Pool } from "pg";
import { logger } from "./logger";

export const EMBED_STATUTES_CMD =
  "pnpm --filter @workspace/api-server run embed:statutes";

export async function warnIfUnembeddedStatutes(pool: Pool): Promise<{
  total: number;
  embedded: number;
  unembedded: number;
}> {
  // The embedding column may not exist yet on a fresh DB (embed:statutes
  // self-provisions it); treat that as fully unembedded.
  const colCheck = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'statutes' AND column_name = 'embedding'`,
  );
  let total = 0;
  let embedded = 0;
  if (colCheck.rowCount === 0) {
    const r = await pool.query<{ total: string }>(
      "SELECT count(*)::int AS total FROM statutes",
    );
    total = Number(r.rows[0]?.total ?? 0);
  } else {
    const r = await pool.query<{ total: string; embedded: string }>(
      "SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM statutes",
    );
    total = Number(r.rows[0]?.total ?? 0);
    embedded = Number(r.rows[0]?.embedded ?? 0);
  }
  const unembedded = total - embedded;
  if (unembedded > 0) {
    logger.warn(
      { total, embedded, unembedded },
      `ACTION REQUIRED: ${unembedded} statute rows have no embedding — meaning-based (vector) search is skipping them. Run \`${EMBED_STATUTES_CMD}\` to restore full hybrid-search coverage.`,
    );
  } else {
    logger.info(
      { total, embedded },
      "statutes embedding coverage: 100% — hybrid search covers the full corpus",
    );
  }
  return { total, embedded, unembedded };
}
