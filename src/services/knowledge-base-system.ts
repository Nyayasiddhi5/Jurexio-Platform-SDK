// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Knowledge Base System for Jurexio Enterprise Platform SDK 9.0
 * Comprehensive document management with versioning, search, and real-time updates
 * Features: Multi-tenant support, access control, analytics, monitoring
 */

import { EventEmitter } from 'events';
import { DatabaseSystem } from './database-system.js';
import { DocumentProcessor, ProcessedDocument, DocumentProcessingRequest } from './document-processor.js';
import { VectorDatabase, VectorSearchRequest, EmbeddingRequest, type EmbeddingModel } from './vector-database.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('knowledge-base-system');

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  organizationId?: string;
  type: 'personal' | 'team' | 'organization' | 'public';
  status: 'active' | 'inactive' | 'archiving' | 'archived';
  settings: KnowledgeBaseSettings;
  statistics: KnowledgeBaseStatistics;
  permissions: KnowledgeBasePermissions;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  lastIndexedAt?: Date;
}

export interface KnowledgeBaseSettings {
  enableVersioning: boolean;
  enableAutoIndexing: boolean;
  enableRealTimeUpdates: boolean;
  maxDocuments: number;
  maxSizeBytes: number;
  retentionDays: number;
  allowedFileTypes: string[];
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  searchThreshold: number;
  accessControl: 'open' | 'restricted' | 'private';
}

export interface KnowledgeBaseStatistics {
  totalDocuments: number;
  totalSizeBytes: number;
  totalChunks: number;
  totalEmbeddings: number;
  lastUpdated: Date;
  indexingProgress: number;
  searchQueries: number;
  popularDocuments: string[];
  languageDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
}

export interface KnowledgeBasePermissions {
  readers: string[];
  writers: string[];
  admins: string[];
  public: boolean;
  requireApproval: boolean;
  allowedDomains: string[];
}

export interface DocumentRecord {
  id: string;
  knowledgeBaseId: string;
  title: string;
  content: string;
  documentType: string;
  filePath?: string;
  url?: string;
  metadata: DocumentMetadata;
  version: number;
  status: 'processing' | 'active' | 'archived' | 'failed';
  embeddings: string[]; // Vector IDs
  tags: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
}

export interface DocumentMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  language: string;
  wordCount: number;
  characterCount: number;
  readTime: number; // estimated reading time in minutes
  complexity: number; // complexity score 0-100
  sentiment: number; // sentiment score -1 to 1
  extractedEntities: string[];
  keyPhrases: string[];
  summary?: string;
  checksum: string;
}

export interface SearchRequest {
  query: string;
  knowledgeBaseId?: string;
  filters?: SearchFilters;
  options?: SearchOptions;
  userId: string;
}

export interface SearchFilters {
  documentTypes?: string[];
  tags?: string[];
  dateRange?: { start: Date; end: Date };
  language?: string;
  authors?: string[];
  minRelevanceScore?: number;
  excludeDocuments?: string[];
}

export interface SearchOptions {
  maxResults?: number;
  offset?: number;
  includeContent?: boolean;
  includeMetadata?: boolean;
  enableSemanticSearch?: boolean;
  enableHybridSearch?: boolean;
  rerank?: boolean;
  contextualExpansion?: boolean;
  fuzzyMatching?: boolean;
}

export interface SearchResult {
  document: DocumentRecord;
  relevanceScore: number;
  matchType: 'exact' | 'semantic' | 'hybrid' | 'fuzzy';
  highlightedContent: string;
  matchedChunks: string[];
  contextualInfo: Record<string, any>;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalCount: number;
  searchTime: number;
  metadata: {
    searchMethod: string;
    filtersApplied: string[];
    suggestedQueries: string[];
    relatedTopics: string[];
  };
}

export interface IndexingJob {
  id: string;
  knowledgeBaseId: string;
  type: 'full' | 'incremental' | 'document' | 'reindex';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  documentsProcessed: number;
  totalDocuments: number;
  errors: string[];
  startedAt?: Date;
  completedAt?: Date;
  estimatedCompletionTime?: Date;
}

export class KnowledgeBaseSystem extends EventEmitter {
  private databaseSystem: DatabaseSystem;
  private documentProcessor: DocumentProcessor;
  private vectorDatabase: VectorDatabase;
  private knowledgeBases: Map<string, KnowledgeBase> = new Map();
  private indexingJobs: Map<string, IndexingJob> = new Map();
  private searchCache: Map<string, SearchResponse> = new Map();
  private isInitialized = false;

  // Configuration
  private readonly defaultSettings: KnowledgeBaseSettings = {
    enableVersioning: true,
    enableAutoIndexing: true,
    enableRealTimeUpdates: true,
    maxDocuments: 10000,
    maxSizeBytes: 1024 * 1024 * 1024, // 1GB
    retentionDays: 365,
    allowedFileTypes: ['pdf', 'docx', 'txt', 'md', 'html', 'json', 'csv'],
    embeddingModel: 'openai-ada-002',
    chunkSize: 1000,
    chunkOverlap: 200,
    searchThreshold: 0.7,
    accessControl: 'private'
  };

  constructor(
    databaseSystem: DatabaseSystem,
    documentProcessor: DocumentProcessor,
    vectorDatabase: VectorDatabase
  ) {
    super();
    this.databaseSystem = databaseSystem;
    this.documentProcessor = documentProcessor;
    this.vectorDatabase = vectorDatabase;
  }

  async initialize(): Promise<void> {
    logger.info('📚 Initializing Knowledge Base System...');

    try {
      // Load existing knowledge bases
      await this.loadKnowledgeBases();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Start background tasks
      this.startIndexingScheduler();
      this.startCacheManager();
      
      this.isInitialized = true;
      this.emit('initialized');
      logger.info('✅ Knowledge Base System initialized successfully');

    } catch (error: any) {
      logger.error('❌ Knowledge Base System initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async createKnowledgeBase(
    name: string,
    options: {
      description?: string;
      ownerId: string;
      organizationId?: string;
      type?: 'personal' | 'team' | 'organization' | 'public';
      settings?: Partial<KnowledgeBaseSettings>;
      permissions?: Partial<KnowledgeBasePermissions>;
    }
  ): Promise<KnowledgeBase> {
    logger.info(`📖 Creating knowledge base: ${name}`);

    const knowledgeBase: KnowledgeBase = {
      id: crypto.randomUUID(),
      name,
      description: options.description,
      ownerId: options.ownerId,
      organizationId: options.organizationId,
      type: options.type || 'personal',
      status: 'active',
      settings: { ...this.defaultSettings, ...options.settings },
      statistics: this.createEmptyStatistics(),
      permissions: {
        readers: [],
        writers: [],
        admins: [options.ownerId],
        public: false,
        requireApproval: false,
        allowedDomains: [],
        ...options.permissions
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store in database
    await this.storeKnowledgeBase(knowledgeBase);
    
    // Create vector collection
    await this.vectorDatabase.createCollection(knowledgeBase.id, {
      name: `kb_${knowledgeBase.name}`,
      dimension: 1536, // OpenAI Ada-002 dimension
      metric: 'cosine'
    });

    this.knowledgeBases.set(knowledgeBase.id, knowledgeBase);
    this.emit('knowledgeBaseCreated', knowledgeBase);
    
    logger.info(`✅ Knowledge base created: ${name} (${knowledgeBase.id})`);
    return knowledgeBase;
  }

  private createEmptyStatistics(): KnowledgeBaseStatistics {
    return {
      totalDocuments: 0,
      totalSizeBytes: 0,
      totalChunks: 0,
      totalEmbeddings: 0,
      lastUpdated: new Date(),
      indexingProgress: 0,
      searchQueries: 0,
      popularDocuments: [],
      languageDistribution: {},
      typeDistribution: {}
    };
  }

  async addDocument(
    knowledgeBaseId: string,
    file: {
      path: string;
      originalName: string;
      size: number;
      mimeType: string;
    },
    options: {
      userId: string;
      tags?: string[];
      metadata?: Record<string, any>;
      autoIndex?: boolean;
    }
  ): Promise<DocumentRecord> {
    logger.info(`📄 Adding document to knowledge base ${knowledgeBaseId}: ${file.originalName}`);

    const knowledgeBase = this.knowledgeBases.get(knowledgeBaseId);
    if (!knowledgeBase) {
      throw new Error(`Knowledge base not found: ${knowledgeBaseId}`);
    }

    // Validate permissions
    await this.validateWritePermission(knowledgeBase, options.userId);

    // Validate file type
    const fileExtension = path.extname(file.originalName).substring(1).toLowerCase();
    if (!knowledgeBase.settings.allowedFileTypes.includes(fileExtension)) {
      throw new Error(`File type not allowed: ${fileExtension}`);
    }

    // Check storage limits
    await this.validateStorageLimits(knowledgeBase, file.size);

    // Process document
    const processingRequest: DocumentProcessingRequest = {
      id: crypto.randomUUID(),
      filePath: file.path,
      fileName: file.originalName,
      fileType: fileExtension as DocumentProcessingRequest['fileType'],
      options: {
        extractMetadata: true,
        generateChunks: true,
        chunkSize: knowledgeBase.settings.chunkSize,
        chunkOverlap: knowledgeBase.settings.chunkOverlap,
        languageDetection: true
      },
      metadata: options.metadata
    };

    const processedDocument = await this.documentProcessor.processDocument(processingRequest);

    // Create document record
    const documentRecord: DocumentRecord = {
      id: processingRequest.id,
      knowledgeBaseId,
      title: processedDocument.metadata.title || processedDocument.originalFileName,
      content: processedDocument.content,
      documentType: processedDocument.documentType,
      filePath: file.path,
      metadata: this.enhanceDocumentMetadata(processedDocument.metadata),
      version: 1,
      status: processedDocument.status === 'success' ? 'processing' : 'failed',
      embeddings: [],
      tags: options.tags || [],
      createdBy: options.userId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store document record
    await this.storeDocumentRecord(documentRecord);

    // Generate embeddings and index (if auto-indexing is enabled)
    if (knowledgeBase.settings.enableAutoIndexing && options.autoIndex !== false) {
      await this.indexDocument(documentRecord);
    }

    // Update knowledge base statistics
    await this.updateKnowledgeBaseStatistics(knowledgeBaseId);

    this.emit('documentAdded', { knowledgeBaseId, document: documentRecord });
    
    logger.info(`✅ Document added: ${file.originalName}`);
    return documentRecord;
  }

  private async indexDocument(document: DocumentRecord): Promise<void> {
    logger.info(`🔍 Indexing document: ${document.title}`);

    try {
      const knowledgeBase = this.knowledgeBases.get(document.knowledgeBaseId);
      if (!knowledgeBase) return;

      // Generate embeddings for document chunks
      const db = await this.databaseSystem.getDatabase();
      const chunks = await db.execute(`
        SELECT * FROM kb_document_chunks WHERE document_id = ? ORDER BY chunk_index
      `, [document.id]);

      const vectors = [];
      
      const chunkRows = chunks as unknown as Array<{
        id: string;
        content: string;
        chunk_index: number;
      }>;
      for (const chunk of chunkRows) {
        // Generate embedding
        const embeddingRequest: EmbeddingRequest = {
          text: chunk.content,
          model: knowledgeBase.settings.embeddingModel as EmbeddingModel,
          options: { normalize: true }
        };

        const embeddingResponse = await this.vectorDatabase.generateEmbedding(embeddingRequest);

        // Create vector
        const vector = {
          id: crypto.randomUUID(),
          values: embeddingResponse.embedding,
          metadata: {
            documentId: document.id,
            chunkId: chunk.id,
            chunkIndex: chunk.chunk_index,
            content: String(chunk.content).substring(0, 200), // Store snippet for preview
            documentTitle: document.title,
            documentType: document.documentType,
            tags: document.tags,
            createdAt: document.createdAt.toISOString()
          }
        };

        vectors.push(vector);
        document.embeddings.push(vector.id);
      }

      // Insert vectors to vector database
      if (vectors.length > 0) {
        await this.vectorDatabase.insertVectors(document.knowledgeBaseId, vectors);
      }

      // Update document status
      document.status = 'active';
      document.updatedAt = new Date();
      await this.updateDocumentRecord(document);

      logger.info(`✅ Document indexed: ${document.title} (${vectors.length} embeddings)`);
      this.emit('documentIndexed', { document, embeddingCount: vectors.length });

    } catch (error: any) {
      logger.error(`❌ Document indexing failed for ${document.title}:`, error);
      document.status = 'failed';
      await this.updateDocumentRecord(document);
      throw error;
    }
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();
    logger.info(`🔍 Searching knowledge bases: "${request.query}"`);

    try {
      // Check cache first
      const cacheKey = this.generateSearchCacheKey(request);
      const cachedResult = this.searchCache.get(cacheKey);
      if (cachedResult) {
        logger.info('📋 Using cached search result');
        return cachedResult;
      }

      // Validate permissions
      const knowledgeBases = await this.getAccessibleKnowledgeBases(
        request.userId, 
        request.knowledgeBaseId
      );

      if (knowledgeBases.length === 0) {
        return this.createEmptySearchResponse(request, Date.now() - startTime);
      }

      let results: SearchResult[] = [];

      // Perform semantic search if enabled
      if (request.options?.enableSemanticSearch !== false) {
        const semanticResults = await this.performSemanticSearch(request, knowledgeBases);
        results.push(...semanticResults);
      }

      // Perform keyword search
      const keywordResults = await this.performKeywordSearch(request, knowledgeBases);
      results.push(...keywordResults);

      // Combine and rank results
      if (request.options?.enableHybridSearch) {
        results = this.combineSearchResults(results);
      }

      // Apply filters
      results = this.applySearchFilters(results, request.filters);

      // Sort by relevance
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Apply pagination
      const offset = request.options?.offset || 0;
      const limit = request.options?.maxResults || 20;
      const paginatedResults = results.slice(offset, offset + limit);

      // Re-rank if requested
      if (request.options?.rerank && paginatedResults.length > 1) {
        // Implement advanced re-ranking algorithm
        // For now, using simple relevance-based ranking
      }

      const searchTime = Date.now() - startTime;
      const response: SearchResponse = {
        query: request.query,
        results: paginatedResults,
        totalCount: results.length,
        searchTime,
        metadata: {
          searchMethod: this.getSearchMethod(request.options),
          filtersApplied: this.getAppliedFilters(request.filters),
          suggestedQueries: await this.generateSuggestedQueries(request.query),
          relatedTopics: await this.extractRelatedTopics(paginatedResults)
        }
      };

      // Cache result
      this.searchCache.set(cacheKey, response);

      // Update search statistics
      await this.updateSearchStatistics(knowledgeBases, request.query);

      logger.info(`✅ Search completed: ${paginatedResults.length} results in ${searchTime}ms`);
      this.emit('searchPerformed', { request, response });

      return response;

    } catch (error: any) {
      logger.error('❌ Search failed:', error);
      this.emit('searchFailed', { request, error });
      throw error;
    }
  }

  private async performSemanticSearch(
    request: SearchRequest, 
    knowledgeBases: KnowledgeBase[]
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const kb of knowledgeBases) {
      try {
        // Generate query embedding
        const embeddingRequest: EmbeddingRequest = {
          text: request.query,
          model: kb.settings.embeddingModel as EmbeddingModel,
          options: { normalize: true }
        };

        const queryEmbedding = await this.vectorDatabase.generateEmbedding(embeddingRequest);

        // Search vectors
        const vectorSearchRequest: VectorSearchRequest = {
          vector: queryEmbedding.embedding,
          topK: request.options?.maxResults || 20,
          includeMetadata: true,
          filter: this.buildVectorFilter(request.filters)
        };

        const vectorResults = await this.vectorDatabase.searchVectors(kb.id, vectorSearchRequest);

        // Convert to search results
        for (const vectorResult of vectorResults) {
          if (vectorResult.score >= (request.filters?.minRelevanceScore || kb.settings.searchThreshold)) {
            const document = await this.getDocumentById(vectorResult.metadata.documentId);
            if (document) {
              results.push({
                document,
                relevanceScore: vectorResult.score,
                matchType: 'semantic',
                highlightedContent: this.highlightContent(
                  vectorResult.metadata.content, 
                  request.query
                ),
                matchedChunks: [vectorResult.metadata.content],
                contextualInfo: {
                  chunkIndex: vectorResult.metadata.chunkIndex,
                  similarityScore: vectorResult.score
                }
              });
            }
          }
        }

      } catch (error: any) {
        logger.warn(`Semantic search failed for KB ${kb.id}:`, error);
      }
    }

    return results;
  }

  private async performKeywordSearch(
    request: SearchRequest, 
    knowledgeBases: KnowledgeBase[]
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const keywords = this.extractKeywords(request.query);

    const db = await this.databaseSystem.getDatabase();

    for (const kb of knowledgeBases) {
      try {
        // Build search query
        const searchQuery = this.buildKeywordSearchQuery(keywords, request.filters);
        const searchParams = [kb.id, ...this.getSearchParams(keywords, request.filters)];

        const documents = await db.execute(searchQuery, searchParams);

        const docRows = documents as unknown as Array<Record<string, unknown> & { content: string }>;
        for (const doc of docRows) {
          const relevanceScore = this.calculateKeywordRelevance(String(doc.content), keywords);
          
          if (relevanceScore >= (request.filters?.minRelevanceScore || 0.3)) {
            results.push({
              document: this.mapToDocumentRecord(doc),
              relevanceScore,
              matchType: 'exact',
              highlightedContent: this.highlightContent(String(doc.content), request.query),
              matchedChunks: this.extractMatchedChunks(String(doc.content), keywords),
              contextualInfo: {
                keywordMatches: this.getKeywordMatches(String(doc.content), keywords)
              }
            });
          }
        }

      } catch (error: any) {
        logger.warn(`Keyword search failed for KB ${kb.id}:`, error);
      }
    }

    return results;
  }

  private extractKeywords(query: string): string[] {
    // Simple keyword extraction (in production, would use proper NLP)
    return query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'].includes(word));
  }

  private buildKeywordSearchQuery(keywords: string[], filters?: SearchFilters): string {
    let query = `
      SELECT d.*, 
             ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', ?)) as rank
      FROM kb_documents d 
      WHERE d.knowledge_base_id = ? 
        AND d.status = 'active'
        AND to_tsvector('english', d.content) @@ plainto_tsquery('english', ?)
    `;

    if (filters?.documentTypes?.length) {
      query += ` AND d.document_type = ANY(?)`;
    }

    if (filters?.dateRange) {
      query += ` AND d.created_at BETWEEN ? AND ?`;
    }

    if (filters?.language) {
      query += ` AND JSON_EXTRACT(d.metadata, '$.language') = ?`;
    }

    query += ` ORDER BY rank DESC, d.updated_at DESC`;

    return query;
  }

  private getSearchParams(keywords: string[], filters?: SearchFilters): unknown[] {
    const params: unknown[] = [keywords.join(' ')];

    if (filters?.documentTypes?.length) {
      params.push(filters.documentTypes);
    }

    if (filters?.dateRange) {
      params.push(filters.dateRange.start.toISOString());
      params.push(filters.dateRange.end.toISOString());
    }

    if (filters?.language) {
      params.push(filters.language);
    }

    return params;
  }

  private calculateKeywordRelevance(content: string, keywords: string[]): number {
    const contentLower = content.toLowerCase();
    const totalWords = content.split(/\s+/).length;
    let matches = 0;

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const keywordMatches = content.match(regex);
      if (keywordMatches) {
        matches += keywordMatches.length;
      }
    }

    // Calculate TF-IDF-like score
    const termFrequency = matches / totalWords;
    const keywordCoverage = keywords.filter(k => contentLower.includes(k)).length / keywords.length;
    
    return (termFrequency * 0.7) + (keywordCoverage * 0.3);
  }

  private highlightContent(content: string, query: string): string {
    const keywords = this.extractKeywords(query);
    let highlighted = content;

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }

    // Return first 500 characters with highlights
    return highlighted.length > 500 ? highlighted.substring(0, 500) + '...' : highlighted;
  }

  private extractMatchedChunks(content: string, keywords: string[]): string[] {
    const chunks: string[] = [];
    const sentences = content.split(/[.!?]+/);

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      if (keywords.some(keyword => sentenceLower.includes(keyword))) {
        chunks.push(sentence.trim());
      }
    }

    return chunks.slice(0, 3); // Return top 3 matched chunks
  }

  // Additional helper methods would be implemented here...
  
  private async validateWritePermission(kb: KnowledgeBase, userId: string): Promise<void> {
    if (!kb.permissions.writers.includes(userId) && 
        !kb.permissions.admins.includes(userId) && 
        kb.ownerId !== userId) {
      throw new Error('Insufficient permissions to write to this knowledge base');
    }
  }

  private async validateStorageLimits(kb: KnowledgeBase, fileSize: number): Promise<void> {
    if (kb.statistics.totalSizeBytes + fileSize > kb.settings.maxSizeBytes) {
      throw new Error('Knowledge base storage limit exceeded');
    }

    if (kb.statistics.totalDocuments >= kb.settings.maxDocuments) {
      throw new Error('Knowledge base document limit exceeded');
    }
  }

  private enhanceDocumentMetadata(metadata: any): DocumentMetadata {
    return {
      ...metadata,
      readTime: Math.ceil(metadata.wordCount / 200), // Average reading speed
      complexity: metadata.complexity || 50,
      sentiment: 0, // Placeholder for sentiment analysis
      extractedEntities: [],
      keyPhrases: [],
      checksum: crypto.createHash('md5').update(metadata.fileName + metadata.fileSize).digest('hex')
    };
  }

  private async storeKnowledgeBase(kb: KnowledgeBase): Promise<void> {
    const db = await this.databaseSystem.getDatabase();
    
    await db.execute(`
      INSERT INTO knowledge_bases (
        id, name, description, owner_id, organization_id, type, status,
        settings, statistics, permissions, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      kb.id, kb.name, kb.description, kb.ownerId, kb.organizationId, kb.type, kb.status,
      JSON.stringify(kb.settings), JSON.stringify(kb.statistics), 
      JSON.stringify(kb.permissions), JSON.stringify(kb.metadata),
      kb.createdAt.toISOString(), kb.updatedAt.toISOString()
    ]);
  }

  private async storeDocumentRecord(doc: DocumentRecord): Promise<void> {
    const db = await this.databaseSystem.getDatabase();
    
    await db.execute(`
      INSERT INTO kb_documents (
        id, knowledge_base_id, title, content, document_type, file_path,
        metadata, version, status, tags, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      doc.id, doc.knowledgeBaseId, doc.title, doc.content, doc.documentType, doc.filePath,
      JSON.stringify(doc.metadata), doc.version, doc.status, JSON.stringify(doc.tags),
      doc.createdBy, doc.createdAt.toISOString(), doc.updatedAt.toISOString()
    ]);
  }

  private async updateDocumentRecord(doc: DocumentRecord): Promise<void> {
    const db = await this.databaseSystem.getDatabase();
    
    await db.execute(`
      UPDATE kb_documents SET
        status = ?, updated_at = ?
      WHERE id = ?
    `, [doc.status, doc.updatedAt.toISOString(), doc.id]);
  }

  private async loadKnowledgeBases(): Promise<void> {
    try {
      const db = await this.databaseSystem.getDatabase();
      interface KbRow {
        id: string;
        name: string;
        description?: string;
        owner_id: string;
        organization_id?: string;
        type: KnowledgeBase['type'];
        status: KnowledgeBase['status'];
        settings: string | null;
        statistics: string | null;
        permissions: string | null;
        metadata: string | null;
        created_at: string | number | Date;
        updated_at: string | number | Date;
        last_indexed_at?: string | number | Date | null;
      }
      const kbs = await db.execute('SELECT * FROM knowledge_bases WHERE status = ?', ['active']) as unknown as KbRow[];

      for (const kb of kbs) {
        const knowledgeBase: KnowledgeBase = {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          ownerId: kb.owner_id,
          organizationId: kb.organization_id,
          type: kb.type,
          status: kb.status,
          settings: JSON.parse(String(kb.settings ?? '{}')),
          statistics: JSON.parse(String(kb.statistics ?? '{}')),
          permissions: JSON.parse(String(kb.permissions ?? '{}')),
          metadata: JSON.parse(String(kb.metadata ?? '{}')),
          createdAt: new Date(kb.created_at),
          updatedAt: new Date(kb.updated_at),
          lastIndexedAt: kb.last_indexed_at ? new Date(kb.last_indexed_at) : undefined
        };

        this.knowledgeBases.set(knowledgeBase.id, knowledgeBase);
      }

      logger.info(`📚 Loaded ${kbs.length} knowledge bases`);

    } catch (error: any) {
      logger.warn('⚠️ Could not load knowledge bases:', error);
    }
  }

  private setupEventListeners(): void {
    this.documentProcessor.on('documentProcessed', (doc: ProcessedDocument) => {
      this.emit('documentProcessingCompleted', doc);
    });

    this.vectorDatabase.on('vectorsInserted', (event) => {
      this.emit('embeddingsUpdated', event);
    });
  }

  private startIndexingScheduler(): void {
    // Schedule periodic reindexing
    setInterval(async () => {
      await this.performScheduledIndexing();
    }, 60 * 60 * 1000); // Every hour
  }

  private startCacheManager(): void {
    // Clear old cache entries
    setInterval(() => {
      this.searchCache.clear();
    }, 30 * 60 * 1000); // Every 30 minutes
  }

  private async performScheduledIndexing(): Promise<void> {
    logger.info('🔄 Performing scheduled indexing...');
    // Implementation for background indexing
  }

  // Placeholder implementations for remaining methods
  private buildVectorFilter(filters?: SearchFilters): Record<string, any> { return {}; }
  private async getDocumentById(id: string): Promise<DocumentRecord | null> { return null; }
  private generateSearchCacheKey(request: SearchRequest): string { return JSON.stringify(request); }
  private async getAccessibleKnowledgeBases(userId: string, kbId?: string): Promise<KnowledgeBase[]> { return []; }
  private createEmptySearchResponse(request: SearchRequest, searchTime: number): SearchResponse {
    return {
      query: request.query,
      results: [],
      totalCount: 0,
      searchTime,
      metadata: { searchMethod: 'none', filtersApplied: [], suggestedQueries: [], relatedTopics: [] }
    };
  }
  private combineSearchResults(results: SearchResult[]): SearchResult[] { return results; }
  private applySearchFilters(results: SearchResult[], filters?: SearchFilters): SearchResult[] { return results; }
  private getSearchMethod(options?: SearchOptions): string { return 'hybrid'; }
  private getAppliedFilters(filters?: SearchFilters): string[] { return []; }
  private async generateSuggestedQueries(query: string): Promise<string[]> { return []; }
  private async extractRelatedTopics(results: SearchResult[]): Promise<string[]> { return []; }
  private getKeywordMatches(content: string, keywords: string[]): string[] { return []; }
  private mapToDocumentRecord(doc: any): DocumentRecord {
    return {
      id: doc.id,
      knowledgeBaseId: doc.knowledge_base_id,
      title: doc.title,
      content: doc.content,
      documentType: doc.document_type,
      filePath: doc.file_path,
      metadata: JSON.parse(doc.metadata || '{}'),
      version: doc.version,
      status: doc.status,
      embeddings: [],
      tags: JSON.parse(doc.tags || '[]'),
      createdBy: doc.created_by,
      createdAt: new Date(doc.created_at),
      updatedAt: new Date(doc.updated_at)
    };
  }

  private async updateKnowledgeBaseStatistics(kbId: string): Promise<void> {
    // Update statistics implementation
    logger.info(`📊 Updating statistics for KB ${kbId}`);
  }

  private async updateSearchStatistics(kbs: KnowledgeBase[], query: string): Promise<void> {
    // Update search statistics implementation
    logger.info(`📈 Recording search: "${query}"`);
  }

  async close(): Promise<void> {
    logger.info('🔌 Closing Knowledge Base System...');
    
    this.knowledgeBases.clear();
    this.indexingJobs.clear();
    this.searchCache.clear();
    this.isInitialized = false;
    
    this.emit('closed');
  }
}