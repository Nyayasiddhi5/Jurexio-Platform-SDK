/**
 * JRX-GLOBAL-CORPUS-INGEST-001 — seed all six jurisdictions on Jurexio RDS.
 * Statute upsert via seeder; optional per-jurisdiction RAG backfill.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/jrx-global-corpus-ingest.ts
 *   JURISDICTIONS=IN,US RAG_BACKFILL=1 LIMIT=300 npx tsx scripts/jrx-global-corpus-ingest.ts
 * EC2: npm run global:corpus:ingest:ec2
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedStatutesForJurisdictions } from '../src/services/jrx-statute-seeding-service.js';
import { backfillStatutesToRag } from '../src/services/jrx-statute-rag-backfill-service.js';
import { JRX_SIX_JURISDICTIONS } from '../src/services/jrx-auto-rag-router.js';

const DEFAULT_JX = [...JRX_SIX_JURISDICTIONS];

function parseJurisdictions(): string[] {
  const raw = process.env.JURISDICTIONS?.trim();
  if (!raw) return DEFAULT_JX;
  return raw
    .split(/[,;\s]+/)
    .map((j) => j.toUpperCase())
    .filter(Boolean)
    .map((j) => (j === 'GCC' ? 'GC' : j));
}

async function countStatutes(jurisdiction: string): Promise<number> {
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM nv_statutes WHERE UPPER(jurisdiction) = ${jurisdiction}`,
  );
  return Number((r.rows[0] as { n?: number })?.n ?? 0);
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const jurisdictions = parseJurisdictions();
  console.log('==> jrx-global-corpus-ingest jurisdictions=' + jurisdictions.join(','));
  if (dryRun) {
    console.log('DRY_RUN=1 — would seed statutes + optional RAG for: ' + jurisdictions.join(','));
    process.exit(0);
  }

  const before: Record<string, number> = {};
  for (const jx of jurisdictions) {
    before[jx] = await countStatutes(jx);
    console.log(`statutes_before jurisdiction=${jx} count=${before[jx]}`);
  }

  const seed = await seedStatutesForJurisdictions(jurisdictions);
  console.log(`statute_upsert status=${seed.status} seeded=${seed.seeded}`);

  const after: Record<string, number> = {};
  for (const jx of jurisdictions) {
    after[jx] = await countStatutes(jx);
    console.log(`statutes_after jurisdiction=${jx} count=${after[jx]}`);
  }

  if (process.env.RAG_BACKFILL === '1') {
    const limit = Number(process.env.LIMIT || '300');
    for (const jx of jurisdictions) {
      const rag = await backfillStatutesToRag({
        jurisdiction: jx,
        limit,
        skipExisting: true,
        dryRun: false,
      });
      console.log(`rag_backfill jurisdiction=${jx} chunks=${rag.chunksCreated} errors=${rag.errors}`);
    }
  }

  console.log(
    'oss_next_steps=GovInfo,CourtListener,OpenIndiaLaw,legislation.gov.uk,EUR-Lex,SOLID,SaudiBOE',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
