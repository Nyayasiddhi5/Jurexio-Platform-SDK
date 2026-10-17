/**
 * Nyayavigya Platform 3.1.2 — RAG Embedding Backfill
 * NYV-SCRIPT-RAG-EMBED-BACKFILL-001
 *
 * Idempotently fills the `embedding` column on every knowledge_chunks row
 * that is missing one. Uses OpenAI text-embedding-3-small (1536 dims) which
 * is what the rag-service.ts ensureSchema() provisions the column as.
 *
 * Why this exists
 *   The Phase 1 Legal Chat smoke surfaced citations:[] on every answer
 *   despite the corpus already containing 18 BNS/BNSS/BSA/Constitution
 *   chunks. Root cause: every chunk had embedding=NULL, so the vectorSearch
 *   path in rag-service.ts always returned 0 results, and the BM25 fallback
 *   missed because the postgres 'english' stemmer drops digits like "318"
 *   from "BNS Section 318".
 *
 *   This script fixes the first half of that gap (embeddings present); the
 *   companion fix in rag-service.ts (citation_ref fast path + 'simple'
 *   tokenizer) fixes the second half.
 *
 * Idempotency
 *   - WHERE embedding IS NULL — already-embedded rows are skipped.
 *   - Re-runnable safely; cost = OpenAI embedding API ($0.02 / 1M tokens),
 *     ~$0.0001 for the 18 starter chunks.
 *
 * Usage
 *   tsx scripts/jrx-rag-backfill-embeddings.ts
 *   # Or against prod:
 *   sudo docker exec nyv-gateway tsx scripts/jrx-rag-backfill-embeddings.ts
 */

import 'dotenv/config';
import pg from 'pg';
import OpenAI from 'openai';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 64; // OpenAI accepts up to 2048 inputs per call; 64 keeps payload small + retryable.

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!dbUrl) {
    console.error('FATAL: DATABASE_URL is not set');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('FATAL: OPENAI_API_KEY is not set (required for text-embedding-3-small)');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: normalizePgConnectionString(dbUrl) });
  await client.connect();

  // 1. Sanity check — does pgvector exist + does knowledge_chunks have embedding column?
  const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname='vector'`);
  if (ext.rows.length === 0) {
    console.error('FATAL: pgvector extension not installed. Run: CREATE EXTENSION vector;');
    process.exit(1);
  }
  const col = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='knowledge_chunks' AND column_name='embedding'`
  );
  if (col.rows.length === 0) {
    console.log('embedding column missing → adding vector(1536) column');
    await client.query(`ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`);
  }

  // 2. Find rows that need an embedding.
  const pending = await client.query(
    `SELECT id, source, title, content, citation_ref
     FROM knowledge_chunks
     WHERE embedding IS NULL
     ORDER BY id`
  );
  console.log(`Found ${pending.rows.length} chunks without embeddings.`);

  if (pending.rows.length === 0) {
    console.log('Nothing to do. Exiting.');
    await client.end();
    return;
  }

  const openai = new OpenAI({ apiKey });
  let done = 0;

  for (let i = 0; i < pending.rows.length; i += BATCH_SIZE) {
    const batch = pending.rows.slice(i, i + BATCH_SIZE);

    // Embed input = title + citation_ref + content (so retrieval matches
    // BOTH a section reference and the substantive text).
    const inputs = batch.map((r: any) =>
      `${r.title}\n${r.citation_ref || r.source}\n${r.content}`.slice(0, 8000)
    );

    // One automatic retry with exponential backoff per batch — covers the
    // vast majority of transient OpenAI 429/5xx hiccups without turning a
    // backfill into a babysit job. Persistent failures escalate to the
    // hard-fail check at the end.
    let resp;
    let lastErr: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        resp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs });
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        const wait = attempt * 1500;
        console.warn(`  ⏳ Batch ${i}-${i + batch.length} attempt ${attempt} failed (${err?.message}). Retrying in ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    if (!resp) {
      console.error(`  ✗ Batch ${i}-${i + batch.length} failed after retries: ${lastErr?.message || lastErr}`);
      continue; // Final NULL-row check below will fail the script if needed.
    }

    // 3. UPDATE each row with its embedding (one transaction per batch).
    await client.query('BEGIN');
    try {
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const vec = resp.data[j]?.embedding;
        if (!vec || vec.length !== EMBEDDING_DIM) {
          console.warn(`  ⚠ row ${row.id}: embedding shape mismatch, skipping`);
          continue;
        }
        const vecLit = `[${vec.join(',')}]`;
        await client.query(
          `UPDATE knowledge_chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`,
          [vecLit, row.id]
        );
        done++;
      }
      await client.query('COMMIT');
      console.log(`  ✓ embedded rows ${i + 1}–${i + batch.length} (cumulative: ${done})`);
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`  ✗ Batch ${i}-${i + batch.length} commit failed: ${err?.message || err}`);
    }
  }

  // 4. Final sanity report — HARD-FAIL if any rows are still NULL so the
  // script can be wired into CI/cron without silently masking partial runs.
  const after = await client.query(
    `SELECT COUNT(*)::int total,
            COUNT(embedding)::int with_emb,
            COUNT(*) FILTER (WHERE embedding IS NULL)::int still_null
     FROM knowledge_chunks`
  );
  const { total, with_emb, still_null } = after.rows[0];
  console.log(`\nDone. ${done} chunks embedded this run.`);
  console.log(`Corpus state: total=${total}, with_embeddings=${with_emb}, still_null=${still_null}`);

  await client.end();

  if (still_null > 0) {
    console.error(
      `FATAL: ${still_null} row(s) remain NULL after backfill. Re-run the script ` +
      `or inspect the logs above for batch-level failures.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
