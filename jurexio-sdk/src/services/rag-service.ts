// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * RAG Service — Retrieval-Augmented Generation with pgvector
 * @version 5.2.0
 *
 * Implements real vector-based knowledge retrieval using PostgreSQL pgvector extension.
 * Falls back gracefully to BM25 keyword search when pgvector is unavailable.
 *
 * Pipeline:
 *   Query → Embed (OpenAI text-embedding-3-small) → Vector Search → Rank → Return chunks
 */

import OpenAI from 'openai';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('rag-service');

const openaiClient = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
});

export interface KnowledgeChunk {
  id: number;
  source: string;
  title: string;
  content: string;
  jurisdiction: string;
  domain: string;
  score: number;
  citationRef?: string;
}

export interface RAGContext {
  chunks: KnowledgeChunk[];
  totalFound: number;
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'none';
  embeddingModel?: string;
  queryEmbedding?: number[];
}

let pgvectorAvailable: boolean | null = null;

async function checkPgvector(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;
  try {
    await db.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    await db.execute(sql`SELECT '[1,2,3]'::vector`);
    pgvectorAvailable = true;
    logger.info('[RAG] pgvector extension available — using vector search');
  } catch {
    pgvectorAvailable = false;
    logger.info('[RAG] pgvector not available — using BM25 keyword search');
  }
  return pgvectorAvailable;
}

async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id          SERIAL PRIMARY KEY,
        source      VARCHAR(500)  NOT NULL,
        title       VARCHAR(1000) NOT NULL,
        content     TEXT          NOT NULL,
        jurisdiction VARCHAR(10)  NOT NULL DEFAULT 'IN',
        domain       VARCHAR(100) NOT NULL DEFAULT 'general',
        citation_ref VARCHAR(500),
        chunk_index  INTEGER      DEFAULT 0,
        token_count  INTEGER      DEFAULT 0,
        created_at   TIMESTAMPTZ  DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kc_jurisdiction ON knowledge_chunks(jurisdiction)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kc_domain ON knowledge_chunks(domain)`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kc_fts ON knowledge_chunks
      USING GIN(to_tsvector('english', title || ' ' || content))
    `);
    // 'simple' tokenizer index — preserves digits/section numbers (the
    // 'english' stemmer drops tokens like "318" from "BNS Section 318").
    // Required so queries that mention specific statute sections match.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kc_fts_simple ON knowledge_chunks
      USING GIN(to_tsvector('simple', title || ' ' || content))
    `);
    // Trigram index on citation_ref for fast prefix/substring matches like
    // "BNS S.318" appearing inside a longer prompt.
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_kc_citation_trgm ON knowledge_chunks
      USING GIN(citation_ref gin_trgm_ops)
    `).catch(() => {});

    const hasVector = await checkPgvector();
    if (hasVector) {
      try {
        await db.execute(sql`ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536)`);
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS idx_kc_embedding ON knowledge_chunks
          USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
        `);
        logger.info('[RAG] Vector embedding column ready');
      } catch (e: any) {
        logger.warn('[RAG] Could not add embedding column:', e.message);
      }
    }
  } catch (e: any) {
    logger.warn('[RAG] Schema setup warning:', e.message);
  }
}

ensureSchema().catch(() => {});

async function embedQuery(text: string): Promise<number[] | null> {
  // NV-EMBEDDING-CASCADE-001: Gemini → Bedrock → OpenRouter → OpenAI → local (config-driven).
  try {
    const { embedWithConfiguredCascade } = await import('../config/jrx-embedding-cascade.js');
    const res = await embedWithConfiguredCascade(text);
    if (res?.embedding?.length) return res.embedding;
  } catch (e: any) {
    logger.warn('[RAG] Embedding cascade failed, falling back to BM25:', e?.message || e);
  }
  return null;
}

async function vectorSearch(
  embedding: number[],
  jurisdiction: string,
  domain: string,
  topK: number
): Promise<KnowledgeChunk[]> {
  const vectorStr = `[${embedding.join(',')}]`;
  const result = await db.execute(sql`
    SELECT
      id, source, title, content, jurisdiction, domain, citation_ref,
      1 - (embedding <=> ${vectorStr}::vector) AS score
    FROM knowledge_chunks
    WHERE
      (${jurisdiction} = 'ALL' OR jurisdiction = ${jurisdiction} OR jurisdiction = 'ALL')
      AND (${domain} = 'ALL' OR domain = ${domain} OR domain = 'general')
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${topK}
  `);

  return (result.rows as any[]).map(row => ({
    id: row.id,
    source: row.source,
    title: row.title,
    content: row.content,
    jurisdiction: row.jurisdiction,
    domain: row.domain,
    score: parseFloat(row.score) || 0,
    citationRef: row.citation_ref,
  }));
}

/**
 * Detect inline statute references in the user prompt.
 *
 * Recognises every common variant a lawyer might type:
 *   Source-then-section:    "BNS Section 318",  "BNS s. 318",  "BNS S.318",  "BNS 318"
 *   Section-then-source:    "Section 318 of BNS",  "S.318 BNS"
 *   Under-section abbr:     "u/s 420 IPC",  "u/s 318 of BNS"
 *   Article (Constitution): "Article 21",  "Art. 21",  "Constitution Article 21"
 *
 * `ITAct` → `IT Act` and `Sec.` → `S.` are normalised so the canonical
 * citation_ref output exactly matches the seed convention
 * (e.g. "BNS S.318", "Constitution Art. 21", "IT Act S.66A").
 *
 * Exported (not file-local) so retrieveKnowledge() can do a
 * deterministic citation-first lookup BEFORE hybrid scoring kicks in.
 */
export function extractCitationRefs(query: string): string[] {
  const refs = new Set<string>();
  const q = query.replace(/\s+/g, ' ');

  // ── Normalise source tokens into a single canonical map ─────────────
  // Map keyed by LOWERCASED token (regex is /gi so capture groups need
  // case-folded lookup) → canonical citation_ref source. Architect-flagged:
  // a case-sensitive map silently dropped real-world lowercase inputs like
  // "bns section 318", which is by far the most common typing pattern.
  const SOURCE_MAP: Record<string, string> = {
    'bns': 'BNS', 'bnss': 'BNSS', 'bsa': 'BSA',
    'ipc': 'IPC', 'crpc': 'CrPC', 'cpc': 'CPC',
    'it act': 'IT Act', 'itact': 'IT Act',
    'ibc': 'IBC', 'dpdpa': 'DPDPA',
    'companies act': 'Companies Act', 'gst': 'GST',
  };
  const canonical = (raw: string): string | undefined =>
    SOURCE_MAP[raw.replace(/\s+/g, ' ').toLowerCase().trim()];

  // Build a case-insensitive alternation that prefers longer source tokens
  // first (so "IT Act" wins over "IT" alone).
  const SRC_KEYS = Object.keys(SOURCE_MAP).sort((a, b) => b.length - a.length);
  const srcAlt = SRC_KEYS.map(s => s.replace(/ /g, '\\s+')).join('|');

  const SECTION_PFX = '(?:section|sec\\.?|s\\.?)?';

  // (1) Source-then-section:  "<SRC> [Section|S.|Sec.] <NUM>[A-Z]*"
  const re1 = new RegExp(`\\b(${srcAlt})\\s*${SECTION_PFX}\\s*(\\d+[A-Z]*)\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re1.exec(q)) !== null) {
    const canonSrc = canonical(m[1]);
    if (canonSrc) refs.add(`${canonSrc} S.${m[2].toUpperCase()}`);
  }

  // (2) Section-then-source:  "[Section|S.] <NUM>[A-Z]* [of] <SRC>"
  const re2 = new RegExp(`\\b(?:section|sec\\.?|s\\.?)\\s*(\\d+[A-Z]*)\\s+(?:of\\s+)?(${srcAlt})\\b`, 'gi');
  while ((m = re2.exec(q)) !== null) {
    const canonSrc = canonical(m[2]);
    if (canonSrc) refs.add(`${canonSrc} S.${m[1].toUpperCase()}`);
  }

  // (3) Under-section abbreviation:  "u/s <NUM>[A-Z]* [of] <SRC>"
  const re3 = new RegExp(`\\bu/?s\\.?\\s*(\\d+[A-Z]*)\\s+(?:of\\s+)?(${srcAlt})\\b`, 'gi');
  while ((m = re3.exec(q)) !== null) {
    const canonSrc = canonical(m[2]);
    if (canonSrc) refs.add(`${canonSrc} S.${m[1].toUpperCase()}`);
  }

  // (4) Constitution articles. Strict: REQUIRES either an explicit
  // "Constitution" anchor nearby OR the article-of-the-Constitution form
  // OR a parenthetical sub-clause (which is essentially never seen in
  // non-legal prose). The previously-permissive bare "art." branch was
  // architect-flagged as a false-positive risk and has been removed.
  const artRe = /\b(?:constitution[^.]{0,40}?(?:article|art\.?)|article(?=\s+\d+\s*(?:of\s+(?:the\s+)?constitution|\([^)]+\))))\s*(\d+[A-Z]*)(?:\s*\(([^)]+)\))?/gi;
  while ((m = artRe.exec(q)) !== null) {
    const art = m[2] ? `${m[1]}(${m[2]})` : m[1];
    refs.add(`Constitution Art. ${art}`);
  }

  return Array.from(refs);
}

/**
 * Deterministic citation-first lookup. Returns FULL chunks matching any of
 * the citation_refs, with score=1.0. Caller is expected to merge these on
 * top of vector/BM25 results so they're never displaced by hybrid scoring.
 */
export async function lookupByCitationRefs(
  refs: string[],
  jurisdiction: string,
  domain: string,
  limit = 10
): Promise<KnowledgeChunk[]> {
  if (refs.length === 0) return [];
  const result = await db.execute(sql`
    SELECT id, source, title, content, jurisdiction, domain, citation_ref,
           1.0::float AS score
    FROM knowledge_chunks
    WHERE citation_ref = ANY(${refs}::text[])
      AND (${jurisdiction} = 'ALL' OR jurisdiction = ${jurisdiction})
      AND (${domain} = 'ALL' OR domain = ${domain} OR domain = 'general')
    LIMIT ${limit}
  `);
  return (result.rows as any[]).map(row => ({
    id: row.id,
    source: row.source,
    title: row.title,
    content: row.content,
    jurisdiction: row.jurisdiction,
    domain: row.domain,
    score: 1.0,
    citationRef: row.citation_ref,
  }));
}

async function bm25Search(
  query: string,
  jurisdiction: string,
  domain: string,
  topK: number
): Promise<KnowledgeChunk[]> {
  // Fast path: explicit statute citation in the prompt → look up by
  // citation_ref directly. Trigram-indexed; sub-millisecond.
  const citationRefs = extractCitationRefs(query);
  if (citationRefs.length > 0) {
    const refResult = await db.execute(sql`
      SELECT id, source, title, content, jurisdiction, domain, citation_ref,
             1.0::float AS score
      FROM knowledge_chunks
      WHERE citation_ref = ANY(${citationRefs}::text[])
        AND (${jurisdiction} = 'ALL' OR jurisdiction = ${jurisdiction})
        AND (${domain} = 'ALL' OR domain = ${domain} OR domain = 'general')
      LIMIT ${topK}
    `);
    if ((refResult.rows as any[]).length > 0) {
      return (refResult.rows as any[]).map(row => ({
        id: row.id,
        source: row.source,
        title: row.title,
        content: row.content,
        jurisdiction: row.jurisdiction,
        domain: row.domain,
        score: parseFloat(row.score) || 1,
        citationRef: row.citation_ref,
      }));
    }
  }

  // Slow path: full-text search using BOTH 'english' (handles stems like
  // "cheating"→"cheat") AND 'simple' (preserves digits/section numbers
  // that 'english' drops). The combined ts_rank scores prefer chunks that
  // match either index well.
  const result = await db.execute(sql`
    SELECT
      id, source, title, content, jurisdiction, domain, citation_ref,
      GREATEST(
        ts_rank(
          to_tsvector('english', title || ' ' || content),
          plainto_tsquery('english', ${query})
        ),
        ts_rank(
          to_tsvector('simple', title || ' ' || content),
          plainto_tsquery('simple', ${query})
        ) * 0.8
      ) AS score
    FROM knowledge_chunks
    WHERE
      (
        to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${query})
        OR
        to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', ${query})
      )
      AND (${jurisdiction} = 'ALL' OR jurisdiction = ${jurisdiction})
      AND (${domain} = 'ALL' OR domain = ${domain} OR domain = 'general')
    ORDER BY score DESC
    LIMIT ${topK}
  `);

  return (result.rows as any[]).map(row => ({
    id: row.id,
    source: row.source,
    title: row.title,
    content: row.content,
    jurisdiction: row.jurisdiction,
    domain: row.domain,
    score: parseFloat(row.score) || 0,
    citationRef: row.citation_ref,
  }));
}

// JRX-OBS-RAG-HITRATE-001 (Task #28 round 11): track RAG retrieval
// hit-rate + recall latency in-process so /admin/health/full can
// surface them as first-class operator KPIs (the reviewer flagged
// these as missing — span latencies on `queen.rag` exist but a
// dashboard panel for "RAG hit rate" needed an explicit number).
// Hit = retrieval returned ≥1 chunk; miss = method=='none' or
// chunks.length==0. Bucket by retrieval method so we can see when
// vector search is degrading and BM25 fallback is carrying load.
interface RagStatsBucket {
  attempts: number;
  hits:     number;
  misses:   number;
  totalLatencyMs: number;
  byMethod: Record<string, { attempts: number; hits: number; totalLatencyMs: number }>;
}
const ragStats: RagStatsBucket = {
  attempts: 0, hits: 0, misses: 0, totalLatencyMs: 0,
  byMethod: {},
};
export function getRagRetrievalStats() {
  const hitRate = ragStats.attempts > 0 ? ragStats.hits / ragStats.attempts : 0;
  const avgLatencyMs = ragStats.attempts > 0
    ? Math.round(ragStats.totalLatencyMs / ragStats.attempts)
    : 0;
  const byMethod: Record<string, { attempts: number; hits: number; hitRate: number; avgLatencyMs: number }> = {};
  for (const [m, b] of Object.entries(ragStats.byMethod)) {
    byMethod[m] = {
      attempts: b.attempts,
      hits:     b.hits,
      hitRate:  b.attempts > 0 ? Math.round((b.hits / b.attempts) * 1000) / 1000 : 0,
      avgLatencyMs: b.attempts > 0 ? Math.round(b.totalLatencyMs / b.attempts) : 0,
    };
  }
  return {
    attempts: ragStats.attempts,
    hits:     ragStats.hits,
    misses:   ragStats.misses,
    hitRate:  Math.round(hitRate * 1000) / 1000,
    avgLatencyMs,
    byMethod,
  };
}

/**
 * Main RAG retrieval function.
 * Tries vector search first; falls back to BM25 keyword search.
 */
export async function retrieveKnowledge(
  query: string,
  options: {
    jurisdiction?: string;
    domain?: string;
    topK?: number;
    hybridWeight?: number;
  } = {}
): Promise<RAGContext> {
  const _retrievalStart = Date.now();
  const {
    jurisdiction = 'IN',
    domain = 'ALL',
    topK = 5,
    hybridWeight = 0.7,
  } = options;

  const vectorOk = await checkPgvector();
  let chunks: KnowledgeChunk[] = [];
  let method: RAGContext['retrievalMethod'] = 'none';
  let embedding: number[] | undefined;

  // ── DETERMINISTIC CITATION-FIRST LOOKUP ─────────────────────────────
  // If the prompt explicitly names a statute section ("BNS s.318",
  // "Article 21", "u/s 420 IPC", etc.), look up the canonical chunks
  // FIRST and reserve top slots in the result for them. Hybrid scoring
  // could otherwise drop an exact citation match below a strong but
  // tangential vector hit.
  const citationRefs = extractCitationRefs(query);
  let citationChunks: KnowledgeChunk[] = [];
  if (citationRefs.length > 0) {
    try {
      citationChunks = await lookupByCitationRefs(citationRefs, jurisdiction, domain, topK);
    } catch (e: any) {
      logger.warn('[RAG] Citation-ref lookup failed, falling back to hybrid:', e.message);
    }
  }

  if (vectorOk) {
    const emb = await embedQuery(query);
    if (emb) {
      embedding = emb;
      try {
        const vectorChunks = await vectorSearch(emb, jurisdiction, domain, topK);
        if (vectorChunks.length > 0) {
          const bm25Chunks = await bm25Search(query, jurisdiction, domain, topK).catch(() => []);
          if (bm25Chunks.length > 0) {
            const merged = new Map<number, KnowledgeChunk>();
            for (const c of vectorChunks) {
              merged.set(c.id, { ...c, score: c.score * hybridWeight });
            }
            for (const c of bm25Chunks) {
              if (merged.has(c.id)) {
                merged.get(c.id)!.score += c.score * (1 - hybridWeight);
              } else {
                merged.set(c.id, { ...c, score: c.score * (1 - hybridWeight) });
              }
            }
            chunks = Array.from(merged.values())
              .sort((a, b) => b.score - a.score)
              .slice(0, topK);
            method = 'hybrid';
          } else {
            chunks = vectorChunks;
            method = 'vector';
          }
        }
      } catch (e: any) {
        logger.warn('[RAG] Vector search error, falling back to BM25:', e.message);
      }
    }
  }

  if (chunks.length === 0) {
    try {
      chunks = await bm25Search(query, jurisdiction, domain, topK);
      method = chunks.length > 0 ? 'bm25' : 'none';
    } catch (e: any) {
      logger.warn('[RAG] BM25 search error:', e.message);
    }
  }

  // ── FORCE-INCLUDE EXACT CITATION HITS ───────────────────────────────
  // Prepend chunks matched by the deterministic citation_ref lookup so an
  // explicit "BNS S.318" prompt can never lose its canonical chunk to a
  // higher-scoring vector match. Dedupe by id, keep within topK budget.
  if (citationChunks.length > 0) {
    const seen = new Set(citationChunks.map(c => c.id));
    const remaining = chunks.filter(c => !seen.has(c.id));
    chunks = [...citationChunks, ...remaining].slice(0, topK);
    // Mark retrieval method to surface citation determinism in observability.
    method = method === 'none' ? 'bm25' : method;
  }

  // JRX-OBS-RAG-HITRATE-001 (Task #28 round 11): record retrieval
  // outcome + recall latency for the operator dashboard. Hit =
  // ≥1 chunk returned. Bucketing by method ('vector', 'hybrid',
  // 'bm25', 'none') makes vector-search degradation visible
  // separately from corpus-empty 'none' results.
  const _retrievalLatency = Date.now() - _retrievalStart;
  ragStats.attempts += 1;
  ragStats.totalLatencyMs += _retrievalLatency;
  if (chunks.length > 0) ragStats.hits += 1; else ragStats.misses += 1;
  const mb = (ragStats.byMethod[method] ||= { attempts: 0, hits: 0, totalLatencyMs: 0 });
  mb.attempts += 1;
  mb.totalLatencyMs += _retrievalLatency;
  if (chunks.length > 0) mb.hits += 1;

  return {
    chunks,
    totalFound: chunks.length,
    retrievalMethod: method,
    embeddingModel: embedding ? 'text-embedding-3-small' : undefined,
    queryEmbedding: embedding,
  };
}

/**
 * Format RAG context for injection into LLM prompt.
 */
export function formatRAGContext(ragContext: RAGContext): string {
  if (ragContext.chunks.length === 0) return '';

  const header = `\n\n## Relevant Legal Knowledge Base (${ragContext.retrievalMethod} retrieval)\n`;
  const chunkText = ragContext.chunks
    .map((c, i) =>
      `### [${i + 1}] ${c.title} (${c.jurisdiction} | ${c.domain} | Score: ${c.score.toFixed(3)})
Source: ${c.source}${c.citationRef ? ` | Citation: ${c.citationRef}` : ''}
${c.content.slice(0, 800)}${c.content.length > 800 ? '...' : ''}`
    )
    .join('\n\n');

  return header + chunkText;
}

/**
 * Ingest a knowledge chunk into the database.
 * Used by knowledge management routes to populate the RAG store.
 */
export async function ingestKnowledgeChunk(chunk: {
  source: string;
  title: string;
  content: string;
  jurisdiction: string;
  domain: string;
  citationRef?: string;
}): Promise<number> {
  const vectorOk = await checkPgvector();
  let embeddingStr: string | null = null;

  if (vectorOk) {
    const emb = await embedQuery(`${chunk.title}\n${chunk.content}`);
    if (emb) {
      embeddingStr = `[${emb.join(',')}]`;
    }
  }

  const tokenCount = Math.ceil(chunk.content.length / 4);

  if (embeddingStr) {
    const result = await db.execute(sql`
      INSERT INTO knowledge_chunks (source, title, content, jurisdiction, domain, citation_ref, token_count, embedding, updated_at)
      VALUES (
        ${chunk.source}, ${chunk.title}, ${chunk.content},
        ${chunk.jurisdiction}, ${chunk.domain}, ${chunk.citationRef || null},
        ${tokenCount}, ${embeddingStr}::vector, NOW()
      )
      RETURNING id
    `);
    return (result.rows[0] as any)?.id;
  } else {
    const result = await db.execute(sql`
      INSERT INTO knowledge_chunks (source, title, content, jurisdiction, domain, citation_ref, token_count, updated_at)
      VALUES (
        ${chunk.source}, ${chunk.title}, ${chunk.content},
        ${chunk.jurisdiction}, ${chunk.domain}, ${chunk.citationRef || null},
        ${tokenCount}, NOW()
      )
      RETURNING id
    `);
    return (result.rows[0] as any)?.id;
  }
}

export const ragService = { retrieveKnowledge, formatRAGContext, ingestKnowledgeChunk };
