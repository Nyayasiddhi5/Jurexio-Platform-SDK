#!/usr/bin/env tsx
/**
 * Backfill nv_statutes → knowledge_chunks + rag_documents (RAG grounding).
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... npx tsx scripts/jrx-backfill-statutes-to-rag.ts
 *   JURISDICTION=IN LIMIT=100 DRY_RUN=1 npx tsx scripts/jrx-backfill-statutes-to-rag.ts
 *
 * Live via API (super-admin JWT):
 *   POST /api/jrx/rag/collections/backfill-statutes
 *   { "jurisdiction": "IN", "limit": 500, "dryRun": false }
 */
import { backfillStatutesToRag } from '../src/services/jrx-statute-rag-backfill-service.js';

async function main(): Promise<void> {
  const jurisdiction = process.env.JURISDICTION?.toUpperCase();
  const limit = Number(process.env.LIMIT || '5000');
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  console.log(`[nv-backfill-statutes-to-rag] jurisdiction=${jurisdiction || 'ALL'} limit=${limit} dryRun=${dryRun}`);
  const result = await backfillStatutesToRag({ jurisdiction, limit, skipExisting: true, dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
