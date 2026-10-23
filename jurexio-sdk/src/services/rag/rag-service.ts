// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import { documentEmbeddings, documentExtractedContent, documentParsing } from '../../../shared/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { nyayavignyaEmbeddingService } from '../document-pipeline/embedding-service.js';
import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('rag-service');

// task-256 (2026-05-13): switched from `if (!db) throw` at module top to the
// canonical JRX-NS-022 lazy Proxy. The eager throw crashed every transitive
// importer (e.g. jrx-orchestration-services → rag-service) when no
// DATABASE_URL is set, defeating the lazy-Proxy contract that task-251
// installed across ~95 other files. Caught by the
// `tests/regression/jrx-gateway-boots-without-db.test.ts` suite.
const db = lazyRequire(() => _raw_db, 'db', 'rag-service requires DATABASE_URL');

/**
 * Jurexio RAG Service - Multimodal Retrieval Augmented Generation (Phase 6.2)
 * Integrates document parsing with vector embeddings for semantic search
 */

export interface SemanticSearchRequest {
  query: string;
  userId: string;
  assistantId?: number;
  documentId?: number;
  limit?: number;
  minSimilarity?: number;
  filters?: {
    documentType?: string;
    tags?: string[];
    dateRange?: { start: Date; end: Date };
  };
}

export interface SemanticSearchResult extends Record<string, unknown> {
  id: number;
  text: string;
  similarity: number;
  documentId: number;
  documentType?: string;
  sourceFileName?: string;
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface ContextAssembly {
  relevantChunks: SemanticSearchResult[];
  formattedContext: string;
  totalChunks: number;
  averageSimilarity: number;
  sources: Array<{
    documentId: number;
    fileName: string;
    chunkCount: number;
  }>;
}

export class RAGService {
  private createTextHash(text: string): string {
    return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  async embedDocumentChunks(documentId: number, userId: string): Promise<any[]> {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const document = await db!.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.userId !== userId) {
      throw new Error('Unauthorized: Document does not belong to user');
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const chunks = await db!.query.documentExtractedContent.findMany({
      where: eq(documentExtractedContent.documentId, documentId),
    });

    if (chunks.length === 0) {
      throw new Error('No chunks found for document');
    }

    const validChunks = chunks
      .map((chunk: any, originalIndex: number) => ({
        chunk,
        originalIndex,
        text: chunk.text || '',
      }))
      .filter((item: any) => item.text.trim().length > 0);
    
    if (validChunks.length === 0) {
      throw new Error('No valid text found in chunks');
    }

    const texts = validChunks.map((item: any) => item.text);

    const embeddingResponses = await nyayavignyaEmbeddingService.generateBatchEmbeddings({
      texts,
      provider: 'openai',
      model: 'text-embedding-3-small',
    });

    const stored = await Promise.all(
      validChunks.map(async ({ chunk, text }: any, validIndex: number) => {
        const textHash = this.createTextHash(text);

        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        const existing = await db!.query.documentEmbeddings.findFirst({
          where: and(
            eq(documentEmbeddings.documentId, documentId),
            eq(documentEmbeddings.textHash, textHash)
          ),
        });

        if (existing) {
          return existing;
        }

        const embeddingResponse = embeddingResponses.embeddings[validIndex];
        if (!embeddingResponse) {
          logger.warn(`No embedding generated for chunk ${chunk.id} (valid index ${validIndex})`);
          return null;
        }

        const [stored] = await db!.insert(documentEmbeddings).values({
          documentId,
          chunkId: chunk.id,
          userId,
          assistantId: document.assistantId || undefined,
          text,
          textHash,
          embedding: embeddingResponse.embedding,
          model: embeddingResponse.model,
          provider: embeddingResponse.provider,
          dimensions: embeddingResponse.embedding.length,
          chunkIndex: chunk.contentIndex,
          startPosition: chunk.startPosition,
          endPosition: chunk.endPosition,
          wordCount: chunk.wordCount,
          characterCount: chunk.characterCount,
          documentType: document.documentType || undefined,
          sourceFileName: document.originalFileName || undefined,
          metadata: chunk.metadata || {},
          tags: [],
        }).returning();

        return stored;
      })
    );

    return stored.filter(Boolean);
  }

  async semanticSearch(request: SemanticSearchRequest): Promise<SemanticSearchResult[]> {
    const queryEmbeddingResponse = await nyayavignyaEmbeddingService.generateEmbedding({
      text: request.query,
      provider: 'openai',
      model: 'text-embedding-3-small',
    });

    const queryEmbedding = queryEmbeddingResponse.embedding;
    const limit = request.limit || 10;
    const minSimilarity = request.minSimilarity || 0.5;

    let whereClause = eq(documentEmbeddings.userId, request.userId);

    if (request.assistantId) {
      whereClause = and(whereClause, eq(documentEmbeddings.assistantId, request.assistantId))!;
    }

    if (request.documentId) {
      whereClause = and(whereClause, eq(documentEmbeddings.documentId, request.documentId))!;
    }

    if (request.filters?.documentType) {
      whereClause = and(whereClause, eq(documentEmbeddings.documentType, request.filters.documentType))!;
    }

    const results = await db!.execute<SemanticSearchResult>(sql`
      SELECT 
        id,
        text,
        1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity,
        document_id as "documentId",
        document_type as "documentType",
        source_file_name as "sourceFileName",
        chunk_index as "chunkIndex",
        metadata
      FROM document_embeddings
      WHERE user_id = ${request.userId}
        ${request.assistantId ? sql`AND assistant_id = ${request.assistantId}` : sql``}
        ${request.documentId ? sql`AND document_id = ${request.documentId}` : sql``}
        ${request.filters?.documentType ? sql`AND document_type = ${request.filters.documentType}` : sql``}
        AND (1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector)) >= ${minSimilarity}
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT ${limit}
    `);

    return results.rows as SemanticSearchResult[];
  }

  async assembleContext(request: SemanticSearchRequest): Promise<ContextAssembly> {
    const relevantChunks = await this.semanticSearch(request);

    if (relevantChunks.length === 0) {
      return {
        relevantChunks: [],
        formattedContext: '',
        totalChunks: 0,
        averageSimilarity: 0,
        sources: [],
      };
    }

    const totalSimilarity = relevantChunks.reduce((sum, chunk) => sum + chunk.similarity, 0);
    const averageSimilarity = totalSimilarity / relevantChunks.length;

    const sourceMap = new Map<number, { fileName: string; chunks: SemanticSearchResult[] }>();
    
    for (const chunk of relevantChunks) {
      if (!sourceMap.has(chunk.documentId)) {
        sourceMap.set(chunk.documentId, {
          fileName: chunk.sourceFileName || `Document ${chunk.documentId}`,
          chunks: [],
        });
      }
      sourceMap.get(chunk.documentId)!.chunks.push(chunk);
    }

    const contextParts: string[] = [];
    const sources: Array<{ documentId: number; fileName: string; chunkCount: number }> = [];

    for (const [documentId, { fileName, chunks }] of sourceMap.entries()) {
      contextParts.push(`\n[Source: ${fileName}]`);
      
      chunks.forEach((chunk, index) => {
        contextParts.push(`\n${index + 1}. ${chunk.text}`);
      });

      sources.push({
        documentId,
        fileName,
        chunkCount: chunks.length,
      });
    }

    const formattedContext = contextParts.join('\n');

    return {
      relevantChunks,
      formattedContext,
      totalChunks: relevantChunks.length,
      averageSimilarity,
      sources,
    };
  }

  async queryWithContext(
    query: string,
    userId: string,
    options?: {
      assistantId?: number;
      documentId?: number;
      limit?: number;
      includeContext?: boolean;
    }
  ): Promise<{
    query: string;
    context: ContextAssembly;
    enhancedPrompt: string;
  }> {
    const context = await this.assembleContext({
      query,
      userId,
      assistantId: options?.assistantId,
      documentId: options?.documentId,
      limit: options?.limit,
    });

    const enhancedPrompt = options?.includeContext !== false && context.formattedContext
      ? `Context from relevant documents:\n${context.formattedContext}\n\nUser Question: ${query}\n\nPlease answer based on the provided context. If the context doesn't contain relevant information, say so.`
      : query;

    return {
      query,
      context,
      enhancedPrompt,
    };
  }

  async getDocumentEmbeddings(documentId: number, userId: string) {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const document = await db!.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.userId !== userId) {
      throw new Error('Unauthorized: Document does not belong to user');
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    return db!.query.documentEmbeddings.findMany({
      where: eq(documentEmbeddings.documentId, documentId),
    });
  }

  async getUserEmbeddings(userId: string, limit: number = 100) {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    return db!.query.documentEmbeddings.findMany({
      where: eq(documentEmbeddings.userId, userId),
      limit,
      orderBy: [desc(documentEmbeddings.createdAt)],
    });
  }

  async deleteDocumentEmbeddings(documentId: number, userId: string) {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const document = await db!.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.userId !== userId) {
      throw new Error('Unauthorized: Document does not belong to user');
    }

    await db!.delete(documentEmbeddings)
      .where(eq(documentEmbeddings.documentId, documentId));
  }

  async deleteUserEmbeddings(userId: string) {
    await db!.delete(documentEmbeddings)
      .where(eq(documentEmbeddings.userId, userId));
  }
}

export const ragService = new RAGService();
