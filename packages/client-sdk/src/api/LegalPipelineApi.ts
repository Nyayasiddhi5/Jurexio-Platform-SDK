/**
 * LegalPipelineApi — Typed wrappers for the Batch E `/api/nv5/legal-pipeline/*`
 * RAG primitives admin surface (Session-11, 2026-05-10). Read-only / pure
 * deterministic compute. SDK key + `admin` scope; default OFF
 * (`JRX_F_LEGAL_PIPELINE_*`).
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 15
 */

import type { NyvHttpClient } from '../NyvClient.js';

export interface ChunkerCapabilities {
  chunkTypes: string[];
  defaults: Record<string, unknown>;
}

export interface ChunkerPreviewRequest {
  text: string;
  mimeType?: string;
  chunkType?: string;
  options?: Record<string, unknown>;
}

/**
 * Server contract (`POST /api/nv5/legal-pipeline/chunker/preview`):
 * `{ success, mimeType, docType, chunkCount, chunks: <first 20>, truncated }`.
 * `truncated=true` indicates only the first 20 chunks are returned in `chunks`.
 */
export interface ChunkerPreviewResult {
  success: boolean;
  mimeType?: string;
  docType?: string;
  chunkCount: number;
  chunks: Array<{ index?: number; text: string; tokens?: number; metadata?: Record<string, unknown> }>;
  truncated: boolean;
}

export interface EmbeddingCapabilities {
  indicLanguagesSupported: string[];
  features: Record<string, unknown>;
}

export interface EmbeddingModelCatalog {
  models: Array<{ modelId: string; provider: string; dimensions: number; languages: string[] }>;
}

export interface RerankerCapabilities {
  algorithms: string[];
  defaults: Record<string, unknown>;
}

export interface RrfFuseRequest {
  k?: number;
  lists: Array<{
    items: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
    weight?: number;
  }>;
}

export interface RrfFuseResult {
  fused: Array<{ id: string; score: number; rank: number; metadata?: Record<string, unknown> }>;
  totalItems: number;
}

export interface SummarizerCapabilities {
  levels: string[];
  audiences: string[];
}

export interface ReadabilityCapabilities {
  metrics: string[];
  targetRanges: Record<string, { min: number; max: number }>;
}

export interface ReadabilityScoreRequest {
  text: string;
  targetAudience?: string;
}

export interface ReadabilityScoreResult {
  fleschKincaid: number;
  gradeLevel: number;
  metrics: Record<string, number>;
}

class ChunkerSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<ChunkerCapabilities> {
    return this.http.get('/api/nv5/legal-pipeline/chunker/capabilities');
  }
  preview(req: ChunkerPreviewRequest): Promise<ChunkerPreviewResult> {
    return this.http.post('/api/nv5/legal-pipeline/chunker/preview', req);
  }
}

class EmbeddingSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<EmbeddingCapabilities> {
    return this.http.get('/api/nv5/legal-pipeline/embedding/capabilities');
  }
  models(): Promise<EmbeddingModelCatalog> {
    return this.http.get('/api/nv5/legal-pipeline/embedding/models');
  }
}

class RerankerSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<RerankerCapabilities> {
    return this.http.get('/api/nv5/legal-pipeline/reranker/capabilities');
  }
  rrfFuse(req: RrfFuseRequest): Promise<RrfFuseResult> {
    return this.http.post('/api/nv5/legal-pipeline/reranker/rrf-fuse', req);
  }
}

class SummarizerSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<SummarizerCapabilities> {
    return this.http.get('/api/nv5/legal-pipeline/summarizer/capabilities');
  }
}

class ReadabilitySubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<ReadabilityCapabilities> {
    return this.http.get('/api/nv5/legal-pipeline/readability/capabilities');
  }
  score(req: ReadabilityScoreRequest): Promise<ReadabilityScoreResult> {
    return this.http.post('/api/nv5/legal-pipeline/readability/score', req);
  }
}

export class LegalPipelineApi {
  public readonly chunker: ChunkerSubApi;
  public readonly embedding: EmbeddingSubApi;
  public readonly reranker: RerankerSubApi;
  public readonly summarizer: SummarizerSubApi;
  public readonly readability: ReadabilitySubApi;

  constructor(http: NyvHttpClient) {
    this.chunker = new ChunkerSubApi(http);
    this.embedding = new EmbeddingSubApi(http);
    this.reranker = new RerankerSubApi(http);
    this.summarizer = new SummarizerSubApi(http);
    this.readability = new ReadabilitySubApi(http);
  }
}
