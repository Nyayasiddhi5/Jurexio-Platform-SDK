// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NV RAG Live Service v3.1.2 — pgvector + OpenRouter Embeddings
 * ─────────────────────────────────────────────────────────────────────────────
 * Production RAG pipeline: embed queries via OpenRouter → vector search in pg
 *
 * Features:
 *   - OpenRouter text-embedding-3-small for low-cost embeddings
 *   - PostgreSQL pgvector cosine similarity search
 *   - Jurisdiction-filtered retrieval (IN/UK/US/EU/GCC/SG)
 *   - Namespace-based isolation (P11 RAG Fusion / P12 HyDE)
 *   - Graceful fallback to keyword search when pgvector unavailable
 */

import { pool as _raw_pool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const pool = lazyRequire(() => _raw_pool, 'pool');
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-rag-live');

export type JurisdictionCode = 'IN' | 'UK' | 'US' | 'EU' | 'GCC' | 'SG';

export interface RagDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  namespace: string;
  jurisdiction: JurisdictionCode;
  similarity: number;
}

export interface RagQueryOptions {
  query: string;
  namespace?: string;
  jurisdiction?: JurisdictionCode;
  topK?: number;
  minSimilarity?: number;
}

// ─── Embeddings API (OpenAI → Bedrock Titan → OpenRouter) ────────────────────
// NV-RAG-SECONDARY-001: OpenRouter does not reliably serve /embeddings.
// Prefer OpenAI text-embedding-3-small (1536 dims = rag_documents vector).
// When OpenAI quota/keys fail, fall back to Amazon Titan Embed Text v1
// (also 1536 dims) via Bedrock — same IAM path already used for caselaw embed.
// Set JRX_EMBEDDING_PROVIDER=bedrock to prefer Titan first (no OpenAI needed).

async function generateBedrockTitanEmbedding(text: string): Promise<number[] | null> {
  const preferOff =
    (process.env.JRX_EMBEDDING_PROVIDER || '').trim().toLowerCase() === 'none' ||
    process.env.JRX_BEDROCK_EMBEDDINGS === '0';
  if (preferOff) return null;
  try {
    const mod: any = await import('@aws-sdk/client-bedrock-runtime');
    const region =
      process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-1';
    // v2 → 1024/512/256 dims; prefer v2 with 1024 when v1 unavailable in-region.
    // Override with JRX_BEDROCK_EMBED_MODEL. Gemini is preferred when Titan fails.
    const modelId =
      process.env.JRX_BEDROCK_EMBED_MODEL || 'amazon.titan-embed-text-v2:0';
    const client = new mod.BedrockRuntimeClient({ region });
    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const body: Record<string, unknown> = { inputText: truncated };
    if (String(modelId).includes('titan-embed-text-v2')) {
      body.dimensions = Number(process.env.JRX_BEDROCK_EMBED_DIMS) || 1024;
      body.normalize = true;
    }
    const out = await client.send(
      new mod.InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      }),
    );
    const decoded = new TextDecoder().decode(out.body as Uint8Array);
    const parsed = JSON.parse(decoded) as { embedding?: number[] };
    const emb = parsed?.embedding;
    if (Array.isArray(emb) && emb.length > 0) {
      logger.info('[RAG] Bedrock Titan embedding ok', { modelId, dims: emb.length });
      return emb;
    }
    logger.warn('[RAG] Bedrock Titan returned empty embedding', { modelId });
    return null;
  } catch (err: any) {
    logger.warn('[RAG] Bedrock Titan embedding failed', { error: err?.message || String(err) });
    return null;
  }
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  // NV-EMBEDDING-CASCADE-001 — shared SSoT (Gemini → Bedrock → OpenRouter → OpenAI → local).
  const { embedWithConfiguredCascade } = await import('../config/jrx-embedding-cascade.js');
  const res = await embedWithConfiguredCascade(text, { skipLocal: true });
  return res?.embedding ?? null;
}

// ─── Check pgvector availability ──────────────────────────────────────────────
async function isPgvectorAvailable(): Promise<boolean> {
  try {
    await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    return true;
  } catch {
    return false;
  }
}

// ─── pgvector cosine similarity search ────────────────────────────────────────
async function vectorSearch(
  embedding: number[],
  options: RagQueryOptions
): Promise<RagDocument[]> {
  const { namespace = 'default', jurisdiction, topK = 5, minSimilarity = 0.6 } = options;

  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    const params: (string | number)[] = [embeddingStr, topK, minSimilarity];
    let jurisdictionFilter = '';
    if (jurisdiction) {
      jurisdictionFilter = ` AND jurisdiction = $${params.length + 1}`;
      params.push(jurisdiction);
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const result = await pool.query<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      namespace: string;
      jurisdiction: string;
      similarity: number;
    }>(
      `SELECT
         id::text,
         content,
         metadata,
         namespace,
         jurisdiction,
         1 - (embedding <=> $1::vector) AS similarity
       FROM rag_documents
       WHERE namespace = '${namespace}'${jurisdictionFilter}
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    );

    // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
    return result.rows.map(r => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata || {},
      namespace: r.namespace,
      jurisdiction: r.jurisdiction as JurisdictionCode,
      similarity: parseFloat(String(r.similarity)),
    }));
  } catch (err: any) {
    logger.warn('[RAG] Vector search failed', { error: err.message });
    return [];
  }
}

// ─── Keyword fallback search ──────────────────────────────────────────────────
async function keywordSearch(options: RagQueryOptions): Promise<RagDocument[]> {
  const { query, namespace = 'default', jurisdiction, topK = 5 } = options;
  try {
    const params: (string | number)[] = [`%${query}%`, topK];
    let jurisdictionFilter = '';
    if (jurisdiction) {
      jurisdictionFilter = ` AND jurisdiction = $${params.length + 1}`;
      params.push(jurisdiction);
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const result = await pool.query<{
      id: string; content: string; metadata: Record<string, unknown>;
      namespace: string; jurisdiction: string;
    }>(
      `SELECT id::text, content, metadata, namespace, jurisdiction
       FROM rag_documents
       WHERE namespace = '${namespace}'
         AND content ILIKE $1${jurisdictionFilter}
       LIMIT $2`,
      params
    );

    // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
    return result.rows.map(r => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata || {},
      namespace: r.namespace,
      jurisdiction: r.jurisdiction as JurisdictionCode,
      similarity: 0.5,
    }));
  } catch {
    return [];
  }
}

// ─── Main retrieval function ──────────────────────────────────────────────────
export async function retrieveDocuments(options: RagQueryOptions): Promise<RagDocument[]> {
  const vectorAvailable = await isPgvectorAvailable();

  if (vectorAvailable) {
    const embedding = await generateEmbedding(options.query);
    if (embedding) {
      logger.info('[RAG] Live vector search', { query: options.query.slice(0, 50), namespace: options.namespace });
      const results = await vectorSearch(embedding, options);
      if (results.length > 0) return results;
      // EXPLICIT degrade: vector store reachable but returned nothing above the
      // similarity floor — fall through to lexical search rather than guess.
      logger.warn('[RAG] Vector search returned no matches — explicitly degrading to lexical/FTS retrieval', {
        query: options.query.slice(0, 50),
        namespace: options.namespace,
      });
    } else {
      // EXPLICIT degrade: embedding provider unavailable. We never embed with a
      // random/synthetic vector — that would silently randomise ranking. Instead
      // we degrade, loudly and intentionally, to lexical/FTS retrieval.
      logger.warn('[RAG] Embedding provider unavailable — explicitly degrading to lexical/FTS retrieval', {
        query: options.query.slice(0, 50),
        namespace: options.namespace,
      });
    }
  } else {
    logger.warn('[RAG] pgvector unavailable — explicitly degrading to lexical/FTS retrieval', {
      query: options.query.slice(0, 50),
    });
  }

  return keywordSearch(options);
}

// ─── Embed and store a document ───────────────────────────────────────────────
export async function embedAndStore(
  content: string,
  metadata: Record<string, unknown>,
  namespace: string,
  jurisdiction: JurisdictionCode
): Promise<{ success: boolean; id?: string; message?: string }> {
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    return { success: false, message: 'Embedding generation failed — OPENROUTER_API_KEY required' };
  }

  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const result = await pool.query<{ id: string }>(
      `INSERT INTO rag_documents (content, embedding, metadata, namespace, jurisdiction)
       VALUES ($1, $2::vector, $3, $4, $5)
       RETURNING id::text`,
      [content, embeddingStr, JSON.stringify(metadata), namespace, jurisdiction]
    );
    const id = result.rows[0]?.id;
    logger.info('[RAG] Document embedded and stored', { id, namespace, jurisdiction });
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    return { success: true, id };
  } catch (err: any) {
    logger.warn('[RAG] Store failed', { error: err.message });
    return { success: false, message: err.message };
  }
}

// ─── RAG health check ─────────────────────────────────────────────────────────
export async function getRagHealth(): Promise<{
  pgvector: boolean;
  embeddings: boolean;
  documentCount: number;
}> {
  const pgvector = await isPgvectorAvailable();
  const embeddings = !!process.env.OPENROUTER_API_KEY;

  let documentCount = 0;
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const res = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM rag_documents');
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
    documentCount = parseInt(res.rows[0]?.count || '0', 10);
  } catch { /* table may not exist */ }

  return { pgvector, embeddings, documentCount };
}
