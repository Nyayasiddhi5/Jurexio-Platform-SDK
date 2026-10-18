import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-qdrant-adapter');

export interface VectorRecord {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchOptions {
  collection: string;
  topK: number;
  filter?: Record<string, unknown>;
  scoreThreshold?: number;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface UpsertResult {
  upsertedCount: number;
}

export interface CollectionStats {
  vectorCount: number;
  indexedVectorCount: number;
  segmentCount: number;
  status: string;
}

type BackendType = 'pgvector' | 'qdrant';

export class NvQdrantAdapterService {
  private static instance: NvQdrantAdapterService;
  private backend: BackendType;
  private qdrantUrl: string | null;
  private qdrantApiKey: string | null;
  private inMemoryStore: Map<string, Map<string, VectorRecord>> = new Map();

  // JRX-RAG-HEAP-CAP-002 (2026-04-30): when running without Qdrant configured,
  // the in-memory backing store grows forever per upsert. Cap each collection at a
  // configurable max so we don't blow the heap on EC2 dev (the 96% pressure regression).
  // When QDRANT_URL is set this code path is never taken — vectors go to Qdrant.
  // Post-architect-review hardening: validate parsed env (NaN/0/negative falls back to default).
  private static readonly MAX_VECTORS_PER_COLLECTION: number = (() => {
    const raw = process.env.JRX_QDRANT_INMEM_MAX_VECTORS;
    if (raw === undefined || raw === '') return 50_000;
    const n = Number(raw);
    return (Number.isFinite(n) && n > 0 && Number.isInteger(n)) ? n : 50_000;
  })();

  private readonly quantizationConfig = { scalar: { type: 'int8', quantile: 0.99, always_ram: true } };
  private readonly hnswConfig = { m: 16, ef_construct: 100, full_scan_threshold: 10000 };

  private constructor() {
    this.qdrantUrl = process.env.QDRANT_URL || null;
    this.qdrantApiKey = process.env.QDRANT_API_KEY || null;
    this.backend = (this.qdrantUrl ? 'qdrant' : 'pgvector') as BackendType;

    logger.info({
      service: 'NvQdrantAdapterService',
      backend: this.backend,
      qdrantConfigured: !!this.qdrantUrl,
    });
  }

  static getInstance(): NvQdrantAdapterService {
    if (!NvQdrantAdapterService.instance) {
      NvQdrantAdapterService.instance = new NvQdrantAdapterService();
    }
    return NvQdrantAdapterService.instance;
  }

  async upsert(collection: string, vectors: VectorRecord[]): Promise<UpsertResult> {
    const startTime = Date.now();
    try {
      if (this.backend === 'qdrant' && this.qdrantUrl) {
        await this.qdrantRequest('PUT', `/collections/${collection}/points`, {
          points: vectors.map(v => ({ id: v.id, vector: v.vector, payload: v.payload })),
        });
      } else {
        if (!this.inMemoryStore.has(collection)) {
          this.inMemoryStore.set(collection, new Map());
        }
        const store = this.inMemoryStore.get(collection)!;
        const cap = NvQdrantAdapterService.MAX_VECTORS_PER_COLLECTION;
        for (const v of vectors) {
          // JRX-RAG-HEAP-CAP-002: insertion-order LRU eviction. If at cap and the
          // incoming id is new, drop the oldest entry first. Updates to existing ids
          // never trigger eviction because Map.set() of an existing key is in-place.
          if (store.size >= cap && !store.has(v.id)) {
            const oldestKey = store.keys().next().value as string | undefined;
            if (oldestKey !== undefined) store.delete(oldestKey);
          }
          store.set(v.id, v);
        }
      }

      logger.info({
        service: 'NvQdrantAdapterService',
        method: 'upsert',
        collection,
        count: vectors.length,
        backend: this.backend,
        durationMs: Date.now() - startTime,
      });

      return { upsertedCount: vectors.length };
    } catch (error: any) {
      logger.error({
        service: 'NvQdrantAdapterService',
        method: 'upsert',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async search(query: number[], options: SearchOptions): Promise<SearchResult[]> {
    const startTime = Date.now();
    try {
      let results: SearchResult[];

      if (this.backend === 'qdrant' && this.qdrantUrl) {
        const response = await this.qdrantRequest('POST', `/collections/${options.collection}/points/search`, {
          vector: query,
          limit: options.topK,
          with_payload: true,
          score_threshold: options.scoreThreshold || 0.5,
          filter: options.filter || undefined,
        });
        results = (response as any).result?.map((r: any) => ({
          id: r.id,
          score: r.score,
          payload: r.payload,
        })) || [];
      } else {
        const store = this.inMemoryStore.get(options.collection);
        if (!store) return [];

        results = Array.from(store.values())
          .map(record => ({
            id: record.id,
            score: this.cosineSimilarity(query, record.vector),
            payload: record.payload,
          }))
          .filter(r => r.score >= (options.scoreThreshold || 0.5))
          .sort((a, b) => b.score - a.score)
          .slice(0, options.topK);
      }

      logger.info({
        service: 'NvQdrantAdapterService',
        method: 'search',
        collection: options.collection,
        resultCount: results.length,
        backend: this.backend,
        durationMs: Date.now() - startTime,
      });

      return results;
    } catch (error: any) {
      logger.error({
        service: 'NvQdrantAdapterService',
        method: 'search',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return [];
    }
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    if (this.backend === 'qdrant' && this.qdrantUrl) {
      await this.qdrantRequest('POST', `/collections/${collection}/points/delete`, { points: ids });
    } else {
      const store = this.inMemoryStore.get(collection);
      if (store) ids.forEach(id => store.delete(id));
    }
  }

  async createCollection(name: string, dimensions: number): Promise<void> {
    if (this.backend === 'qdrant' && this.qdrantUrl) {
      const exists = await this.collectionExists(name);
      if (!exists) {
        await this.qdrantRequest('PUT', `/collections/${name}`, {
          vectors: { size: dimensions, distance: 'Cosine' },
          hnsw_config: this.hnswConfig,
          quantization_config: this.quantizationConfig,
        });
      }
    } else {
      if (!this.inMemoryStore.has(name)) {
        this.inMemoryStore.set(name, new Map());
      }
    }
  }

  async collectionExists(name: string): Promise<boolean> {
    if (this.backend === 'qdrant' && this.qdrantUrl) {
      try {
        await this.qdrantRequest('GET', `/collections/${name}`);
        return true;
      } catch {
        return false;
      }
    }
    return this.inMemoryStore.has(name);
  }

  async getCollectionStats(name: string): Promise<CollectionStats> {
    if (this.backend === 'qdrant' && this.qdrantUrl) {
      const response = await this.qdrantRequest('GET', `/collections/${name}`) as any;
      return {
        vectorCount: response.result?.vectors_count || 0,
        indexedVectorCount: response.result?.indexed_vectors_count || 0,
        segmentCount: response.result?.segments_count || 0,
        status: response.result?.status || 'unknown',
      };
    }
    const store = this.inMemoryStore.get(name);
    return {
      vectorCount: store?.size || 0,
      indexedVectorCount: store?.size || 0,
      segmentCount: 1,
      status: 'in_memory',
    };
  }

  private async qdrantRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.qdrantUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.qdrantApiKey) headers['api-key'] = this.qdrantApiKey;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok === false) {
      throw new Error(`Qdrant API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

export const nvVectorStore = NvQdrantAdapterService.getInstance();
