/**
 * RagApi — Unified Auto-RAG retrieval for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/rag/query, /api/jrx/rag/collections/auto/retrieve
 *
 * NV-AUTO-RAG-001 / NV-RAG-BYPASS-001: `query()` routes through the tier-aware
 * Auto-RAG router (adaptive / corrective / LightRAG / GraphRAG / RRF / rerank) —
 * the same retrieval brain used by the Queen hot path. `raw: true` keeps the
 * legacy single-layer pgvector escape hatch for diagnostics.
 */

import type { JrxJurisdiction } from '../types/index.js';
import type { JrxHttpClient } from '../JrxClient.js';

export interface RagQueryOptions {
  namespace?: string;
  jurisdiction?: JrxJurisdiction;
  topK?: number;
  minSimilarity?: number;
  /** Bypass Auto-RAG and hit the raw pgvector retriever (diagnostics only). */
  raw?: boolean;
}

export interface RagChunk {
  id?: string;
  text?: string;
  score?: number;
  source?: string;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RagQueryResult {
  success: boolean;
  query: string;
  /** 'raw_vector' when raw=true; otherwise the Auto-RAG resolved mode. */
  mode?: string;
  documents?: RagChunk[];
  chunks?: RagChunk[];
  count?: number;
  latencyMs?: number;
  [k: string]: unknown;
}

export interface AutoRetrieveRequest {
  query: string;
  jurisdiction?: JrxJurisdiction;
  /** Capability tier (default 'pro'). */
  tier?: string;
  taskType?: string;
  /** Clamped to ≤15 server-side. */
  topK?: number;
}

export interface AutoRetrieveResult {
  intent: string;
  capabilityTier: string;
  layersUsed: string[];
  retrievalMethods: string[];
  chunkCount: number;
  confidence: number;
  latencyMs: number;
  chunks: RagChunk[];
}

export class RagApi {
  constructor(private readonly http: JrxHttpClient) {}

  /**
   * Retrieve via the unified tier-aware Auto-RAG router (default) or the raw
   * pgvector retriever (`options.raw = true`). `POST /api/jrx/rag/query`.
   */
  query(query: string, options: RagQueryOptions = {}): Promise<RagQueryResult> {
    return this.http.post('/api/jrx/rag/query', { query, ...options });
  }

  /**
   * Diagnostic Auto-RAG retrieve — returns the resolved intent, capability tier,
   * layers/methods used, confidence, and a sample of chunks.
   * `POST /api/jrx/rag/collections/auto/retrieve`.
   */
  autoRetrieve(req: AutoRetrieveRequest): Promise<AutoRetrieveResult> {
    return this.http.post('/api/jrx/rag/collections/auto/retrieve', req);
  }
}
