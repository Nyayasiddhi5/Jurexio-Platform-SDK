/**
 * Statute → RAG backfill — embeds nv_statutes rows into knowledge_chunks
 * (Queen retrieveKnowledge) + rag_documents (live vector search) and
 * refreshes rag_namespaces document_count per jurisdiction.
 */
import { sql } from 'drizzle-orm';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';
import { ingestKnowledgeChunk } from './rag-service.js';
import { embedAndStore, type JurisdictionCode } from './jrx-rag-live-service.js';

const db = lazyRequire(() => _raw_db, 'db');
const logger = createLogger('./jrx-statute-rag-backfill');

const NAMESPACE_BY_JURIS: Record<string, string> = {
  IN: 'in-bare-acts',
  UK: 'uk-statutes',
  US: 'us-federal',
  EU: 'eu-regulations',
  SG: 'sg-statutes',
  GC: 'gc-legislation',
};

const LIVE_JURIS: Record<string, JurisdictionCode> = {
  IN: 'IN', UK: 'UK', US: 'US', EU: 'EU', SG: 'SG', GC: 'GCC',
};

export interface StatuteBackfillResult {
  statutesProcessed: number;
  knowledgeChunksInserted: number;
  ragDocumentsInserted: number;
  skipped: number;
  errors: number;
  byJurisdiction: Record<string, number>;
}

function buildCitationRef(actShort: string, sectionNumber: string): string {
  const act = String(actShort || '').trim();
  const sec = String(sectionNumber || '').trim();
  if (/^art\.?\s*\d/i.test(sec) || act.toLowerCase().includes('constitution')) {
    const num = sec.replace(/^art\.?\s*/i, '');
    return `Constitution Art. ${num}`;
  }
  return `${act} S.${sec}`;
}

function buildChunkContent(row: Record<string, unknown>): string {
  const act = String(row.act_title || row.act_short_title || '');
  const sec = String(row.section_number || '');
  const title = String(row.section_title || '');
  const text = String(row.section_text || '');
  const practice = String(row.practice_area || 'general');
  return [
    `${act} — Section ${sec}${title ? `: ${title}` : ''}`,
    '',
    text,
    '',
    `Practice area: ${practice}`,
    `Jurisdiction: ${String(row.jurisdiction || 'IN')}`,
  ].join('\n').trim();
}

async function chunkExists(citationRef: string, jurisdiction: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT id FROM knowledge_chunks
      WHERE citation_ref = ${citationRef} AND jurisdiction = ${jurisdiction}
      LIMIT 1
    `);
    const rows = (r as { rows?: unknown[] }).rows ?? (Array.isArray(r) ? r : []);
    return (rows as unknown[]).length > 0;
  } catch {
    return false;
  }
}

async function ragDocExists(citationRef: string, jurisdiction: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT 1 FROM rag_documents
      WHERE metadata->>'citationRef' = ${citationRef}
        AND jurisdiction = ${jurisdiction}
      LIMIT 1
    `);
    const rows = (r as { rows?: unknown[] }).rows ?? (Array.isArray(r) ? r : []);
    return (rows as unknown[]).length > 0;
  } catch {
    return false;
  }
}

async function refreshNamespaceCounts(): Promise<void> {
  try {
    for (const [jur, ns] of Object.entries(NAMESPACE_BY_JURIS)) {
      const countRes = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM rag_documents
        WHERE namespace = ${ns} OR jurisdiction = ${jur}
      `).catch(() => ({ rows: [{ c: 0 }] }));
      const rows = (countRes as { rows?: { c?: number }[] }).rows ?? [];
      const docCount = Number(rows[0]?.c ?? 0);
      await db.execute(sql`
        UPDATE rag_namespaces
        SET document_count = ${docCount},
            vector_count = ${docCount},
            updated_at = NOW()
        WHERE name ILIKE ${`%${jur}%`}
           OR metadata->>'jurisdiction' = ${jur}
      `).catch(() => {});
    }
    const kc = await db.execute(sql`SELECT COUNT(*)::int AS c FROM knowledge_chunks`);
    const kcRows = (kc as { rows?: { c?: number }[] }).rows ?? [];
    const total = Number(kcRows[0]?.c ?? 0);
    await db.execute(sql`
      UPDATE rag_namespaces
      SET document_count = GREATEST(document_count, ${total}),
          vector_count = GREATEST(vector_count, ${total}),
          updated_at = NOW()
      WHERE is_default = true OR name ILIKE '%Foundation%'
    `).catch(() => {});
  } catch (e) {
    logger.warn('namespace count refresh failed', { error: (e as Error).message });
  }
}

async function ensureRagDocumentsTable(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content     TEXT NOT NULL,
        embedding   vector(1536),
        metadata    JSONB DEFAULT '{}'::jsonb,
        namespace   VARCHAR(100) NOT NULL DEFAULT 'default',
        jurisdiction VARCHAR(10) NOT NULL DEFAULT 'IN',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_docs_ns ON rag_documents(namespace)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_docs_jur ON rag_documents(jurisdiction)`);
  } catch (e) {
    logger.warn('rag_documents schema ensure failed', { error: (e as Error).message });
  }
}

export async function backfillStatutesToRag(opts: {
  jurisdiction?: string;
  limit?: number;
  skipExisting?: boolean;
  dryRun?: boolean;
} = {}): Promise<StatuteBackfillResult> {
  const jurisdiction = opts.jurisdiction?.toUpperCase();
  const limit = opts.limit ?? 5000;
  const skipExisting = opts.skipExisting !== false;
  const dryRun = opts.dryRun === true;

  await ensureRagDocumentsTable();

  const result: StatuteBackfillResult = {
    statutesProcessed: 0,
    knowledgeChunksInserted: 0,
    ragDocumentsInserted: 0,
    skipped: 0,
    errors: 0,
    byJurisdiction: {},
  };

  let rows: Record<string, unknown>[] = [];
  try {
    const q = jurisdiction
      ? sql`
          SELECT act_title, act_short_title, jurisdiction, section_number, section_title,
                 section_text, practice_area, is_repealed
          FROM nv_statutes
          WHERE is_repealed = false AND jurisdiction = ${jurisdiction}
          ORDER BY jurisdiction, act_short_title, section_number
          LIMIT ${limit}
        `
      : sql`
          SELECT act_title, act_short_title, jurisdiction, section_number, section_title,
                 section_text, practice_area, is_repealed
          FROM nv_statutes
          WHERE is_repealed = false
          ORDER BY jurisdiction, act_short_title, section_number
          LIMIT ${limit}
        `;
    const res = await db.execute(q);
    rows = ((res as { rows?: Record<string, unknown>[] }).rows ?? (Array.isArray(res) ? res : [])) as Record<string, unknown>[];
  } catch (e) {
    logger.error('statute fetch failed', { error: (e as Error).message });
    throw e;
  }

  for (const row of rows) {
    result.statutesProcessed += 1;
    const jur = String(row.jurisdiction || 'IN').toUpperCase();
    const actShort = String(row.act_short_title || row.act_title || 'Statute');
    const sectionNumber = String(row.section_number || '');
    const citationRef = buildCitationRef(actShort, sectionNumber);
    const title = `${actShort} S.${sectionNumber}${row.section_title ? ` — ${row.section_title}` : ''}`;
    const content = buildChunkContent(row);
    const domain = String(row.practice_area || 'general');
    const namespace = NAMESPACE_BY_JURIS[jur] || 'in-bare-acts';
    const liveJur = LIVE_JURIS[jur] || 'IN';

    result.byJurisdiction[jur] = (result.byJurisdiction[jur] || 0) + 1;

    // Each store is filled independently so re-runs are idempotent across BOTH:
    // knowledge_chunks (primary Queen RAG) and rag_documents (secondary vector store).
    const kcExists = skipExisting ? await chunkExists(citationRef, jur) : false;
    const rdExists = skipExisting ? await ragDocExists(citationRef, liveJur) : false;

    if (kcExists && rdExists) {
      result.skipped += 1;
      continue;
    }

    if (dryRun) {
      if (!kcExists) result.knowledgeChunksInserted += 1;
      continue;
    }

    try {
      if (!kcExists) {
        await ingestKnowledgeChunk({
          source: actShort,
          title,
          content,
          jurisdiction: jur,
          domain,
          citationRef,
        });
        result.knowledgeChunksInserted += 1;
      }

      if (!rdExists) {
        const embed = await embedAndStore(
          content,
          {
            contentType: 'statute',
            statute: actShort,
            section: sectionNumber,
            practiceArea: domain,
            citationRef,
            source: 'nv_statutes',
          },
          namespace,
          liveJur,
        );
        if (embed.success) result.ragDocumentsInserted += 1;
      }
    } catch (e) {
      result.errors += 1;
      logger.warn('statute embed failed', { citationRef, error: (e as Error).message });
    }
  }

  if (!dryRun) await refreshNamespaceCounts();
  logger.info('statute RAG backfill complete', result);
  return result;
}
