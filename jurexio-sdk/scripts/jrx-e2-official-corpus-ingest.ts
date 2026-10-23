/**
 * JRX-E2-OFFICIAL-CORPUS-001 — SG (SOLID) + GC (Saudi BOE) scaffold.
 *
 *   DRY_RUN=1 JURISDICTION=GC LIMIT=5 npx tsx scripts/jrx-e2-official-corpus-ingest.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  runE2OfficialIngest,
  type E2Jurisdiction,
} from '../src/services/jrx-official-corpus-e2-service.js';
import { backfillStatutesToRag } from '../src/services/jrx-statute-rag-backfill-service.js';

const E2_SET: E2Jurisdiction[] = ['SG', 'GC'];

function parseJurisdictions(): E2Jurisdiction[] {
  const raw = process.env.JURISDICTION?.trim() || process.env.JURISDICTIONS?.trim();
  if (!raw) return E2_SET;
  return raw
    .split(/[,;\s]+/)
    .map((j) => j.toUpperCase())
    .filter((j): j is E2Jurisdiction => (E2_SET as string[]).includes(j));
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
  console.log(`==> jrx-e2-official-corpus-ingest jx=${jurisdictions.join(',')} dryRun=${dryRun}`);

  for (const jx of jurisdictions) {
    const before = await countStatutes(jx);
    const result = await runE2OfficialIngest({ jurisdiction: jx, limit, dryRun });
    const after = dryRun || !process.env.DATABASE_URL ? before : await countStatutes(jx);
    console.log(
      `e2 jurisdiction=${jx} source=${result.source} fetched=${result.fetched} upserted=${result.upserted} statutes_before=${before} statutes_after=${after}${result.licenseNote ? ` license_note=${result.licenseNote}` : ''}`,
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
