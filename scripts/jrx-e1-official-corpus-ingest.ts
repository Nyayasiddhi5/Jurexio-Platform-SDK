/**
 * JRX-E1-OFFICIAL-CORPUS-001 — official API corpus scaffold (IN/US/UK/EU).
 *
 *   DRY_RUN=1 JURISDICTION=UK npx tsx scripts/jrx-e1-official-corpus-ingest.ts
 *   JURISDICTION=US,UK LIMIT=15 RAG_BACKFILL=1 npx tsx scripts/jrx-e1-official-corpus-ingest.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  runE1OfficialIngest,
  type E1Jurisdiction,
} from '../src/services/jrx-official-corpus-e1-service.js';
import { backfillStatutesToRag } from '../src/services/jrx-statute-rag-backfill-service.js';

const E1_SET: E1Jurisdiction[] = ['IN', 'US', 'UK', 'EU'];

function parseJurisdictions(): E1Jurisdiction[] {
  const raw = process.env.JURISDICTION?.trim() || process.env.JURISDICTIONS?.trim();
  if (!raw) return E1_SET;
  return raw
    .split(/[,;\s]+/)
    .map((j) => j.toUpperCase())
    .filter((j): j is E1Jurisdiction => (E1_SET as string[]).includes(j));
}

async function countStatutes(jurisdiction: string): Promise<number> {
  if (!process.env.DATABASE_URL) return -1;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM nv_statutes WHERE UPPER(jurisdiction) = ${jurisdiction}`,
  );
  return Number((r.rows[0] as { n?: number })?.n ?? 0);
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const limit = Number(process.env.LIMIT || '20');
  const jurisdictions = parseJurisdictions();
  console.log(`==> jrx-e1-official-corpus-ingest jx=${jurisdictions.join(',')} dryRun=${dryRun}`);

  for (const jx of jurisdictions) {
    const before = await countStatutes(jx);
    const result = await runE1OfficialIngest({ jurisdiction: jx, limit, dryRun });
    const after = dryRun || !process.env.DATABASE_URL ? before : await countStatutes(jx);
    console.log(
      `e1 jurisdiction=${jx} source=${result.source} fetched=${result.fetched} upserted=${result.upserted} statutes_before=${before} statutes_after=${after}`,
    );

    if (!dryRun && process.env.RAG_BACKFILL === '1' && result.upserted > 0) {
      const rag = await backfillStatutesToRag({
        jurisdiction: jx,
        limit: Math.min(500, result.upserted + 50),
        skipExisting: true,
        dryRun: false,
      });
      console.log(`rag_backfill jurisdiction=${jx} chunks=${rag.chunksCreated} errors=${rag.errors}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
