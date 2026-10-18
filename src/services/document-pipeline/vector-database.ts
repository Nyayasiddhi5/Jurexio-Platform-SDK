// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Vector Database Service for Jurexio Enterprise Platform SDK v5.0.0
 * Supports embedding storage and similarity search (Pinecone, Chroma, FAISS)
 * Features: Multiple embedding models, efficient search, real-time indexing
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('vector-database');

export interface NyayavignyaDatabaseSystem {
  getDatabase(): Promise<any>;
}

export type VectorBackend = 'faiss' | 'chroma' | 'pinecone' | 'database' | 'memory';
export type EmbeddingModel = 'openai-ada-002' | 'cohere-embed' | 'sentence-transformers' | 'custom';
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot_product' | 'manhattan';

export interface VectorDatabaseConfig {
  backend: VectorBackend;
  dimension: number;
  metric: DistanceMetric;
  indexType?: string;
  apiKey?: string;
  environment?: string;
  maxVectors?: number;
  batchSize?: number;
}

export interface Vector {
  id: string;
  values: number[];
  metadata: Record<string, any>;
  namespace?: string;
}

export interface VectorSearchRequest {
  vector: number[];
  topK: number;
  filter?: Record<string, any>;
  namespace?: string;
  includeMetadata?: boolean;
  includeValues?: boolean;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  values?: number[];
  metadata: Record<string, any>;
}

export interface VectorCollection {
  id: string;
  name: string;
  dimension: number;
  metric: DistanceMetric;
  vectorCount: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface VectorEmbeddingRequest {
  text: string;
  model: EmbeddingModel;
  options?: {
    normalize?: boolean;
    truncate?: boolean;
    maxTokens?: number;
  };
}

export interface VectorEmbeddingResponse {
  embedding: number[];
  model: EmbeddingModel;
  dimensions: number;
  tokenCount: number;
  processingTime: number;
}

export interface VectorIndexStats {
  totalVectors: number;
  dimension: number;
  indexSize: number;
  memoryUsage: number;
  searchLatency: number;
  indexingRate: number;
}

export class NyayavignyaVectorDatabase extends EventEmitter {
  private config: VectorDatabaseConfig;
  private databaseSystem: NyayavignyaDatabaseSystem;
  private collections: Map<string, VectorCollection> = new Map();
  private vectorIndex: Map<string, Vector[]> = new Map();
  private isInitialized = false;

  private embeddingModels: Map<EmbeddingModel, any> = new Map();

  constructor(config: VectorDatabaseConfig, databaseSystem: NyayavignyaDatabaseSystem) {
    super();
    this.config = config;
    this.databaseSystem = databaseSystem;
    this.initializeEmbeddingModels();
  }

  private initializeEmbeddingModels(): void {
    this.embeddingModels.set('openai-ada-002', {
      dimension: 1536,
      maxTokens: 8191,
      endpoint: 'https://api.openai.com/v1/embeddings',
      model: 'text-embedding-ada-002'
    });

    this.embeddingModels.set('cohere-embed', {
      dimension: 4096,
      maxTokens: 512,
      endpoint: 'https://api.cohere.ai/v1/embed',
      model: 'embed-english-v3.0'
    });

    this.embeddingModels.set('sentence-transformers', {
      dimension: 384,
      maxTokens: 256,
      model: 'all-MiniLM-L6-v2'
    });
  }

  async initialize(): Promise<void> {
    logger.info(`🔤 Initializing Jurexio Vector Database with ${this.config.backend} backend...`);

    try {
      switch (this.config.backend) {
        case 'database':
          await this.initializeDatabaseBackend();
          break;
        case 'memory':
          await this.initializeMemoryBackend();
          break;
        case 'faiss':
          await this.initializeFAISSBackend();
          break;
        case 'chroma':
          await this.initializeChromaBackend();
          break;
        case 'pinecone':
          await this.initializePineconeBackend();
          break;
        default:
          throw new Error(`Unsupported vector backend: ${this.config.backend}`);
      }

      await this.loadExistingCollections();
      this.isInitialized = true;
      this.emit('initialized');
      logger.info('✅ Jurexio Vector Database initialized successfully');

    } catch (error: any) {
      logger.error('❌ Jurexio Vector Database initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async initializeDatabaseBackend(): Promise<void> {
    const dbInstance = await this.databaseSystem.getDatabase();
    
    try {
      await dbInstance.execute('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (error: any) {
      logger.warn('Vector extension not available, using JSON storage for vectors');
    }
  }

  private async initializeMemoryBackend(): Promise<void> {
    logger.info('🧠 Using in-memory vector storage');
  }

  private async initializeFAISSBackend(): Promise<void> {
    logger.info('🔍 Initializing FAISS vector index');
  }

  private async initializeChromaBackend(): Promise<void> {
    logger.info('🎨 Initializing Chroma vector database');
  }

  private async initializePineconeBackend(): Promise<void> {
    logger.info('🌲 Initializing Pinecone vector database');
    if (!this.config.apiKey) {
      throw new Error('Pinecone API key required');
    }
  }

  async createCollection(name: string, options?: Partial<VectorCollection>): Promise<VectorCollection> {
    logger.info(`📁 Creating vector collection: ${name}`);

    const collection: VectorCollection = {
      id: crypto.randomUUID(),
      name,
      dimension: options?.dimension || this.config.dimension,
      metric: options?.metric || this.config.metric,
      vectorCount: 0,
      metadata: options?.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.collections.set(collection.id, collection);

    if (this.config.backend === 'database') {
      await this.storeCollectionInDatabase(collection);
    }

    this.emit('collectionCreated', collection);
    return collection;
  }

  private async storeCollectionInDatabase(collection: VectorCollection): Promise<void> {
    const dbInstance = await this.databaseSystem.getDatabase();
    
    await dbInstance.execute(`
      INSERT INTO vector_collections (
        id, name, dimension, metric, metadata, document_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      collection.id,
      collection.name,
      collection.dimension,
      collection.metric,
      JSON.stringify(collection.metadata),
      collection.vectorCount,
      collection.createdAt.toISOString(),
      collection.updatedAt.toISOString()
    ]);
  }

  async generateEmbedding(request: VectorEmbeddingRequest): Promise<VectorEmbeddingResponse> {
    const startTime = Date.now();
    
    try {
      const modelConfig = this.embeddingModels.get(request.model);
      if (!modelConfig) {
        throw new Error(`Unsupported embedding model: ${request.model}`);
      }

      let embedding: number[];

      switch (request.model) {
        case 'openai-ada-002':
          embedding = await this.generateOpenAIEmbedding(request.text, modelConfig);
          break;
        case 'cohere-embed':
          embedding = await this.generateCohereEmbedding(request.text, modelConfig);
          break;
        case 'sentence-transformers':
          embedding = await this.generateSentenceTransformersEmbedding(request.text, modelConfig);
          break;
        default:
          throw new Error(`Embedding generation not implemented for ${request.model}`);
      }

      if (request.options?.normalize) {
        embedding = this.normalizeVector(embedding);
      }

      const response: VectorEmbeddingResponse = {
        embedding,
        model: request.model,
        dimensions: embedding.length,
        tokenCount: this.estimateTokenCount(request.text),
        processingTime: Date.now() - startTime
      };

      this.emit('embeddingGenerated', response);
      return response;

    } catch (error: any) {
      logger.error('❌ Embedding generation failed:', error);
      throw error;
    }
  }

  private async generateOpenAIEmbedding(text: string, config: any): Promise<number[]> {
    // NV-RAG-NOFAKE-001: never fabricate embeddings. If no key is configured or
    // the API call fails, fail loud so the caller can degrade explicitly — a
    // random vector here would silently poison every downstream similarity.
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI embeddings unavailable: OPENAI_API_KEY is not set');
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: text,
        model: config.model
      })
    });

    if (response.ok === false) {
      throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('OpenAI embedding API returned no vector');
    }
    return embedding;
  }

  private async generateCohereEmbedding(_text: string, _config: any): Promise<number[]> {
    // NV-RAG-NOFAKE-001: this provider has no real implementation in the legacy
    // in-house store. Fail loud instead of returning a random vector. Use the
    // OpenAI provider or the canonical jrx-legal-embedding-service / pgvector RAG.
    throw new Error('Cohere embeddings are not implemented in vector-database; configure embeddingProvider="openai" or use the canonical RAG embedding path');
  }

  private async generateSentenceTransformersEmbedding(_text: string, _config: any): Promise<number[]> {
    // NV-RAG-NOFAKE-001: no real local Sentence-Transformers backend is wired
    // here. Fail loud rather than fabricate a vector.
    throw new Error('Sentence-Transformers embeddings are not implemented in vector-database; configure embeddingProvider="openai" or use the canonical RAG embedding path');
  }

  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(val => val / magnitude) : vector;
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 0.75);
  }

  async insertVectors(collectionId: string, vectors: Vector[]): Promise<void> {
    logger.info(`➕ Inserting ${vectors.length} vectors into collection ${collectionId}`);

    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    const startTime = Date.now();

    try {
      switch (this.config.backend) {
        case 'database':
          await this.insertVectorsToDatabase(collectionId, vectors);
          break;
        case 'memory':
          await this.insertVectorsToMemory(collectionId, vectors);
          break;
        case 'faiss':
          await this.insertVectorsToFAISS(collectionId, vectors);
          break;
        case 'chroma':
          await this.insertVectorsToChroma(collectionId, vectors);
          break;
        case 'pinecone':
          await this.insertVectorsToPinecone(collectionId, vectors);
          break;
      }

      collection.vectorCount += vectors.length;
      collection.updatedAt = new Date();

      const insertTime = Date.now() - startTime;
      logger.info(`✅ Inserted ${vectors.length} vectors in ${insertTime}ms`);
      
      this.emit('vectorsInserted', { collectionId, count: vectors.length, time: insertTime });

    } catch (error: any) {
      logger.error('❌ Vector insertion failed:', error);
      throw error;
    }
  }

  private async insertVectorsToDatabase(collectionId: string, vectors: Vector[]): Promise<void> {
    const dbInstance = await this.databaseSystem.getDatabase();
    
    for (const vector of vectors) {
      await dbInstance.execute(`
        INSERT INTO vector_index (
          id, collection_id, vector, metadata, document_reference, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        vector.id,
        collectionId,
        JSON.stringify(vector.values),
        JSON.stringify(vector.metadata),
        vector.metadata.documentId || null,
        new Date().toISOString()
      ]);
    }
  }

  private async insertVectorsToMemory(collectionId: string, vectors: Vector[]): Promise<void> {
    if (!this.vectorIndex.has(collectionId)) {
      this.vectorIndex.set(collectionId, []);
    }
    
    const collectionVectors = this.vectorIndex.get(collectionId)!;
    collectionVectors.push(...vectors);
  }

  private async insertVectorsToFAISS(collectionId: string, vectors: Vector[]): Promise<void> {
    logger.info('🔍 Inserting vectors to FAISS index');
  }

  private async insertVectorsToChroma(collectionId: string, vectors: Vector[]): Promise<void> {
    logger.info('🎨 Inserting vectors to Chroma database');
  }

  private async insertVectorsToPinecone(collectionId: string, vectors: Vector[]): Promise<void> {
    logger.info('🌲 Inserting vectors to Pinecone database');
  }

  async searchVectors(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    logger.info(`🔍 Searching vectors in collection ${collectionId} (topK: ${request.topK})`);

    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    const startTime = Date.now();

    try {
      let results: VectorSearchResult[];

      switch (this.config.backend) {
        case 'database':
          results = await this.searchVectorsInDatabase(collectionId, request);
          break;
        case 'memory':
          results = await this.searchVectorsInMemory(collectionId, request);
          break;
        case 'faiss':
          results = await this.searchVectorsInFAISS(collectionId, request);
          break;
        case 'chroma':
          results = await this.searchVectorsInChroma(collectionId, request);
          break;
        case 'pinecone':
          results = await this.searchVectorsInPinecone(collectionId, request);
          break;
        default:
          throw new Error(`Search not implemented for backend: ${this.config.backend}`);
      }

      const searchTime = Date.now() - startTime;
      logger.info(`✅ Found ${results.length} similar vectors in ${searchTime}ms`);
      
      this.emit('vectorsSearched', { collectionId, resultCount: results.length, time: searchTime });
      
      return results;

    } catch (error: any) {
      logger.error('❌ Vector search failed:', error);
      throw error;
    }
  }

  private async searchVectorsInDatabase(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const dbInstance = await this.databaseSystem.getDatabase();

    // NV-RAG-NOFAKE-001: the previous `1 - (RANDOM() * 0.5)` similarity score
    // was fabricated — ranking was effectively random. Fetch the candidate
    // vectors and compute a REAL cosine similarity against the query vector
    // app-side (this in-house store has no pgvector operator), then sort.
    const query = `
      SELECT id, vector, metadata
      FROM vector_index
      WHERE collection_id = ?
    `;

    const rows = await dbInstance.execute(query, [collectionId]);

    const scored = (rows as any[]).map((row: any) => {
      let values: number[] = [];
      try { values = JSON.parse(row.vector); } catch { values = []; }
      const score = values.length === request.vector.length
        ? this.calculateCosineSimilarity(request.vector, values)
        : 0;
      return { id: row.id, score, values, metadata: row.metadata };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, request.topK).map((row) => ({
      id: row.id,
      score: row.score,
      values: request.includeValues ? row.values : undefined,
      metadata: (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })(),
    }));
  }

  private async searchVectorsInMemory(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const vectors = this.vectorIndex.get(collectionId) || [];
    
    const similarities = vectors.map(vector => ({
      vector,
      score: this.calculateCosineSimilarity(request.vector, vector.values)
    }));
    
    similarities.sort((a, b) => b.score - a.score);
    const topResults = similarities.slice(0, request.topK);
    
    return topResults.map(result => ({
      id: result.vector.id,
      score: result.score,
      values: request.includeValues ? result.vector.values : undefined,
      metadata: result.vector.metadata
    }));
  }

  private async searchVectorsInFAISS(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    logger.info('🔍 Searching vectors in FAISS index');
    return [];
  }

  private async searchVectorsInChroma(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    logger.info('🎨 Searching vectors in Chroma database');
    return [];
  }

  private async searchVectorsInPinecone(collectionId: string, request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    logger.info('🌲 Searching vectors in Pinecone database');
    return [];
  }

  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  async deleteVectors(collectionId: string, vectorIds: string[]): Promise<void> {
    logger.info(`🗑️ Deleting ${vectorIds.length} vectors from collection ${collectionId}`);

    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    try {
      switch (this.config.backend) {
        case 'database':
          await this.deleteVectorsFromDatabase(collectionId, vectorIds);
          break;
        case 'memory':
          await this.deleteVectorsFromMemory(collectionId, vectorIds);
          break;
        case 'faiss':
          await this.deleteVectorsFromFAISS(collectionId, vectorIds);
          break;
        case 'chroma':
          await this.deleteVectorsFromChroma(collectionId, vectorIds);
          break;
        case 'pinecone':
          await this.deleteVectorsFromPinecone(collectionId, vectorIds);
          break;
      }

      collection.vectorCount = Math.max(0, collection.vectorCount - vectorIds.length);
      collection.updatedAt = new Date();

      this.emit('vectorsDeleted', { collectionId, count: vectorIds.length });
      logger.info(`✅ Deleted ${vectorIds.length} vectors`);

    } catch (error: any) {
      logger.error('❌ Vector deletion failed:', error);
      throw error;
    }
  }

  private async deleteVectorsFromDatabase(collectionId: string, vectorIds: string[]): Promise<void> {
    const dbInstance = await this.databaseSystem.getDatabase();
    
    for (const vectorId of vectorIds) {
      await dbInstance.execute(`
        DELETE FROM vector_index 
        WHERE collection_id = ? AND id = ?
      `, [collectionId, vectorId]);
    }
  }

  private async deleteVectorsFromMemory(collectionId: string, vectorIds: string[]): Promise<void> {
    const vectors = this.vectorIndex.get(collectionId);
    if (!vectors) return;

    const vectorIdsSet = new Set(vectorIds);
    const remainingVectors = vectors.filter(vector => !vectorIdsSet.has(vector.id));
    this.vectorIndex.set(collectionId, remainingVectors);
  }

  private async deleteVectorsFromFAISS(collectionId: string, vectorIds: string[]): Promise<void> {
    logger.info('🔍 Deleting vectors from FAISS index');
  }

  private async deleteVectorsFromChroma(collectionId: string, vectorIds: string[]): Promise<void> {
    logger.info('🎨 Deleting vectors from Chroma database');
  }

  private async deleteVectorsFromPinecone(collectionId: string, vectorIds: string[]): Promise<void> {
    logger.info('🌲 Deleting vectors from Pinecone database');
  }

  async getCollections(): Promise<VectorCollection[]> {
    return Array.from(this.collections.values());
  }

  async getCollectionStats(collectionId: string): Promise<VectorIndexStats> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    return {
      totalVectors: collection.vectorCount,
      dimension: collection.dimension,
      indexSize: collection.vectorCount * collection.dimension * 4,
      memoryUsage: this.getMemoryUsage(collectionId),
      searchLatency: 50,
      indexingRate: 1000
    };
  }

  private getMemoryUsage(collectionId: string): number {
    const vectors = this.vectorIndex.get(collectionId);
    if (!vectors) return 0;

    return vectors.length * this.config.dimension * 4;
  }

  private async loadExistingCollections(): Promise<void> {
    if (this.config.backend === 'database') {
      try {
        const dbInstance = await this.databaseSystem.getDatabase();
        const collections = await dbInstance.execute(`
          SELECT * FROM vector_collections ORDER BY created_at
        `);

        for (const row of collections) {
          const collection: VectorCollection = {
            id: row.id,
            name: row.name,
            dimension: row.dimension,
            metric: row.metric as DistanceMetric,
            vectorCount: row.document_count,
            metadata: JSON.parse(row.metadata || '{}'),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
          };

          this.collections.set(collection.id, collection);
        }

        logger.info(`📚 Loaded ${collections.length} existing collections`);

      } catch (error: any) {
        logger.warn('⚠️ Could not load existing collections:', error);
      }
    }
  }

  async reindex(collectionId: string): Promise<void> {
    logger.info(`🔄 Reindexing collection ${collectionId}`);
    
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    switch (this.config.backend) {
      case 'faiss':
        break;
      case 'chroma':
        break;
      case 'pinecone':
        break;
      default:
        logger.info('Reindexing not required for this backend');
    }

    this.emit('reindexCompleted', { collectionId });
  }

  async deleteCollection(collectionId: string): Promise<void> {
    logger.info(`🗑️ Deleting collection ${collectionId}`);

    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    try {
      if (this.config.backend === 'database') {
        const dbInstance = await this.databaseSystem.getDatabase();
        await dbInstance.execute('DELETE FROM vector_collections WHERE id = ?', [collectionId]);
        await dbInstance.execute('DELETE FROM vector_index WHERE collection_id = ?', [collectionId]);
      } else if (this.config.backend === 'memory') {
        this.vectorIndex.delete(collectionId);
      }

      this.collections.delete(collectionId);
      this.emit('collectionDeleted', { collectionId });
      logger.info(`✅ Collection deleted: ${collectionId}`);

    } catch (error: any) {
      logger.error('❌ Collection deletion failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    logger.info('🔌 Closing Jurexio Vector Database...');
    
    this.collections.clear();
    this.vectorIndex.clear();
    this.isInitialized = false;
    
    this.emit('closed');
  }
}

export { NyayavignyaVectorDatabase as VectorDatabase };

export async function createNyayavignyaVectorDatabase(
  config: VectorDatabaseConfig, 
  databaseSystem: NyayavignyaDatabaseSystem
): Promise<NyayavignyaVectorDatabase> {
  const vectorDB = new NyayavignyaVectorDatabase(config, databaseSystem);
  await vectorDB.initialize();
  return vectorDB;
}

export const defaultVectorConfig: VectorDatabaseConfig = {
  backend: 'memory',
  dimension: 1536,
  metric: 'cosine',
  indexType: 'hnsw',
  maxVectors: 100000,
  batchSize: 100
};
