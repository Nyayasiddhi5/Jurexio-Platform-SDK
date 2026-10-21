/**
 * JRX-US-CORPUS-INGEST-001 — US legal corpus on Jurexio RDS (existing infra).
 * User GO 2026-10-21. Uses statute seeder + US courts + optional RAG backfill.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/jrx-us-corpus-ingest.ts
 *   JURISDICTION=US RAG_BACKFILL=1 LIMIT=500 npx tsx scripts/jrx-us-corpus-ingest.ts
 * EC2 (via SSM wrapper): npm run us:corpus:ingest:ec2
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { seedStatutesForJurisdictions } from '../src/services/jrx-statute-seeding-service.js';
import { backfillStatutesToRag } from '../src/services/jrx-statute-rag-backfill-service.js';

const US_COURTS: Array<{ id: string; name: string; jurisdiction: string; courtType: string }> = [
  { id: 'US-SCOTUS', name: 'Supreme Court of the United States', jurisdiction: 'US', courtType: 'apex' },
  { id: 'US-CA-FED-9', name: 'United States Court of Appeals for the Ninth Circuit', jurisdiction: 'US', courtType: 'appellate' },
  { id: 'US-DC-SDNY', name: 'United States District Court for the Southern District of New York', jurisdiction: 'US', courtType: 'trial' },
  { id: 'US-DC-NDCA', name: 'United States District Court for the Northern District of California', jurisdiction: 'US', courtType: 'trial' },
];

async function countUsStatutes(): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM nv_statutes WHERE UPPER(jurisdiction) = 'US'`);
  return Number((r.rows[0] as { n?: number })?.n ?? 0);
}

async function seedUsCourts(): Promise<number> {
  let n = 0;
  for (const c of US_COURTS) {
    try {
      await db.execute(sql`
        INSERT INTO nv_courts (id, name, jurisdiction, court_type, created_at, updated_at)
        VALUES (${c.id}, ${c.name}, ${c.jurisdiction}, ${c.courtType}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      `);
      n++;
    } catch {
      /* table shape may differ on older RDS — best effort */
    }
  }
  return n;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  console.log('==> jrx-us-corpus-ingest (JRX RDS, existing infra)');
  if (dryRun) {
    console.log('DRY_RUN=1 — would upsert US statutes, courts, optional RAG backfill');
    process.exit(0);
  }

  const before = await countUsStatutes();
  console.log(`us_statutes_before=${before}`);

  const seed = await seedStatutesForJurisdictions(['US']);
  console.log(`statute_upsert status=${seed.status} seeded=${seed.seeded}`);

  const courts = await seedUsCourts();
  console.log(`us_courts_upserted=${courts}`);

  const after = await countUsStatutes();
  console.log(`us_statutes_after=${after}`);

  if (process.env.RAG_BACKFILL === '1') {
    const limit = Number(process.env.LIMIT || '500');
    const rag = await backfillStatutesToRag({ jurisdiction: 'US', limit, skipExisting: true, dryRun: false });
    console.log(`rag_backfill_us chunks=${rag.chunksCreated} errors=${rag.errors}`);
  }

  if (after < before && seed.seeded === 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
