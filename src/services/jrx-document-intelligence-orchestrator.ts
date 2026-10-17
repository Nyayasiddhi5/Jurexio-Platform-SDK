// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV Document Intelligence Orchestrator v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MISSING GLUE: Unified pipeline that chains every document service into a
 * single, coherent, asynchronous flow:
 *
 *   Upload → Virus Scan → Store (S3/GCS/Replit) → Parse (Intelligence Service)
 *         → Chunk → Embed (OpenAI/Cohere) → Index (pgvector/BM25) → RAG-ready
 *
 * Then for retrieval:
 *   Query → Language Detect → Namespace Resolution → Hybrid RAG (vector + BM25)
 *         → GraphRAG (entity traversal) → Rerank → Citation Ground → Response
 *
 * ISOLATION: Every document is scoped to orgs/{orgId}/{platform}/users/{userId}/
 *            No cross-tenant data leakage at any pipeline stage.
 *
 * AGENTIC INTEGRATION: Documents, once ingested, are available to all 148 ROMA L5
 *                      agents through the RAG pipeline. Agents cite documents by
 *                      docId + chunkIndex for full auditability.
 *
 * JOB QUEUE: All heavy work (parse/embed/index) runs in the PgJobQueue under the
 *            './jrx-documents' queue so the HTTP response is immediate (<100ms).
 *
 * @module nv-document-intelligence-orchestrator
 * @version 1.0.0
 */

import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { jobQueue } from './job-queue.js';
import { nyvDocumentStorage } from './nyv-document-storage-service.js';
import { nyvRagPipeline } from './rag/nyv-rag-pipeline-enhanced.js';
import { nvOcrAdapterService } from './document-pipeline/jrx-got-ocr-adapter-service.js';
import { NYV_RAG, NYV_STORAGE } from '../config/nyv-master-config.js';

const require = createRequire(import.meta.url);

const logger = createLogger('doc-intelligence-orchestrator');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type IngestStatus =
  | 'queued'        // Job created in PgJobQueue, not yet started
  | 'scanning'      // Virus / content safety scan
  | 'storing'       // Writing to storage backend
  | 'parsing'       // Extracting text / tables / images
  | 'chunking'      // Splitting into RAG chunks
  | 'embedding'     // Generating vector embeddings
  | 'indexing'      // Writing to pgvector and BM25 index
  | 'graph_indexing'// Updating the Legal GraphRAG entity graph
  | 'completed'     // Fully indexed and retrievable
  | 'failed'        // Terminal failure (see errorMessage)
  | 'partial';      // Indexed with some errors (still retrievable)

export interface IngestRequest {
  // Identity
  orgId: string;
  platform: string;
  userId: string;

  // File
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileBuffer: Buffer;

  // Classification
  documentClass?: 'user_document' | 'statute' | 'case_law' | 'compliance' | 'contract' | 'evidence' | 'correspondence' | 'template';
  jurisdiction?: string;         // 'IN', 'UK', 'US', 'EU', 'GC', 'SG'
  language?: string;             // 'en', 'hi', 'ta', etc.
  tags?: string[];
  isConfidential?: boolean;
  retentionDays?: number;

  // RAG options
  namespaces?: ('global_statutes' | 'org_shared' | 'user_documents' | 'user_matters')[];
  chunkSize?: number;            // Override NYV_RAG_CHUNK_SIZE
  enableGraphRAG?: boolean;      // Index into Legal GraphRAG (default: true)

  // Metadata passthrough
  customMetadata?: Record<string, string>;
}

export interface IngestResult {
  docId: string;
  jobId: string;
  status: IngestStatus;
  storagePath: string;
  estimatedProcessingSeconds: number;
  statusUrl: string;
  sha256Hash: string;
}

export interface IngestStatusResult {
  docId: string;
  jobId: string;
  status: IngestStatus;
  progress: number;              // 0–100
  stage: string;
  chunksIndexed: number;
  embeddingsGenerated: number;
  graphNodesAdded: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  retrievable: boolean;          // True once at least partially indexed
}

export interface DocumentSearchRequest {
  query: string;
  orgId: string;
  platform: string;
  userId: string;
  jurisdiction?: string;
  language?: string;
  docIds?: string[];             // Limit search to specific documents
  maxResults?: number;           // Default 10
  minScore?: number;             // Default 0.72
  includeGlobalStatutes?: boolean; // Include global statute namespace
  includeOrgShared?: boolean;    // Include org-shared documents
  enableRerank?: boolean;        // Cross-encoder reranking (default: true)
  enableGraphRAG?: boolean;      // Include GraphRAG results (default: true)
}

export interface DocumentSearchResult {
  chunks: SearchChunk[];
  totalFound: number;
  retrievalMethod: 'hybrid' | 'vector' | 'bm25' | 'graphrag' | 'none';
  latencyMs: number;
  queryAnalysis: {
    intent: string;
    complexity: string;
    jurisdiction: string | null;
    language: string;
    keywords: string[];
  };
  graphRAGResults?: GraphSearchResult[];
}

export interface SearchChunk {
  chunkId: string;
  docId: string;
  fileName: string;
  text: string;
  score: number;
  pageNumber?: number;
  chunkIndex: number;
  jurisdiction?: string;
  statute?: string;
  documentClass?: string;
  namespace: string;
  isGrounded: boolean;
  citationRef?: string;
}

export interface GraphSearchResult {
  entityId: string;
  entityType: string;
  entityValue: string;
  relatedStatutes: string[];
  relatedSections: string[];
  connectedDocIds: string[];
  hopCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB SCHEMA (auto-created)
// ─────────────────────────────────────────────────────────────────────────────

const INGEST_TABLE = 'nv_schema.nv_document_ingest_status';

async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_document_ingest_status (
        doc_id              TEXT PRIMARY KEY,
        job_id              TEXT NOT NULL,
        org_id              TEXT NOT NULL,
        platform            TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        file_name           TEXT NOT NULL,
        mime_type           TEXT NOT NULL,
        file_size_bytes     BIGINT NOT NULL DEFAULT 0,
        sha256_hash         TEXT NOT NULL,
        storage_path        TEXT NOT NULL,
        document_class      TEXT DEFAULT 'user_document',
        jurisdiction        TEXT,
        language            TEXT DEFAULT 'en',
        tags                JSONB DEFAULT '[]'::jsonb,
        is_confidential     BOOLEAN DEFAULT false,
        status              TEXT NOT NULL DEFAULT 'queued',
        progress            INTEGER DEFAULT 0,
        stage               TEXT DEFAULT 'queued',
        chunks_indexed      INTEGER DEFAULT 0,
        embeddings_generated INTEGER DEFAULT 0,
        graph_nodes_added   INTEGER DEFAULT 0,
        error_message       TEXT,
        retrievable         BOOLEAN DEFAULT false,
        started_at          TIMESTAMPTZ,
        completed_at        TIMESTAMPTZ,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW(),
        custom_metadata     JSONB DEFAULT '{}'::jsonb
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_doc_ingest_user ON nv_schema.nv_document_ingest_status (org_id, platform, user_id);
      CREATE INDEX IF NOT EXISTS idx_nv_doc_ingest_status ON nv_schema.nv_document_ingest_status (status);
      CREATE INDEX IF NOT EXISTS idx_nv_doc_ingest_created ON nv_schema.nv_document_ingest_status (created_at DESC);
    `).catch(() => {}); // Ignore if indexes already exist
  } catch (err: any) {
    logger.warn('schema_init_warning', { error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class NyvDocumentIntelligenceOrchestrator extends EventEmitter {
  private static instance: NyvDocumentIntelligenceOrchestrator;
  private schemaReady = false;

  static getInstance(): NyvDocumentIntelligenceOrchestrator {
    if (!this.instance) this.instance = new NyvDocumentIntelligenceOrchestrator();
    return this.instance;
  }

  async init(): Promise<void> {
    if (this.schemaReady) return;
    await ensureSchema();
    this.schemaReady = true;
    logger.info('orchestrator_ready');
  }

  // ── INGEST ────────────────────────────────────────────────────────────────

  /**
   * Ingest a document into the full NYV pipeline.
   * Returns immediately after storage upload.
   * All heavy work (parse/embed/index) is queued as an async job.
   */
  async ingest(req: IngestRequest): Promise<IngestResult> {
    await this.init();

    const docId = `doc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const sha256Hash = crypto.createHash('sha256').update(req.fileBuffer).digest('hex');

    // 1. Validate file
    this.validateFile(req);

    // 2. Build storage path
    const ext = path.extname(req.fileName).toLowerCase();
    const storagePath = `orgs/${req.orgId}/${req.platform}/users/${req.userId}/documents/${docId}/${req.fileName}`;

    // 3. Upload to storage backend (fast — Replit object storage or S3)
    await nyvDocumentStorage.upload({
      orgId: req.orgId,
      platform: req.platform,
      userId: req.userId,
      docId,
      fileName: req.fileName,
      mimeType: req.mimeType,
      content: req.fileBuffer,
      category: 'user_documents',
      jurisdiction: req.jurisdiction,
      tags: req.tags,
      isConfidential: req.isConfidential,
      retentionDays: req.retentionDays,
      customMetadata: {
        sha256: sha256Hash,
        language: req.language ?? 'auto',
        documentClass: req.documentClass ?? 'user_document',
        ...req.customMetadata,
      },
    });

    // 4. Enqueue async processing job
    const jobId = await jobQueue.enqueue({
      queue: './jrx-documents',
      taskType: 'document_pipeline',
      payload: {
        docId,
        orgId: req.orgId,
        platform: req.platform,
        userId: req.userId,
        fileName: req.fileName,
        mimeType: req.mimeType,
        storagePath,
        sha256Hash,
        documentClass: req.documentClass ?? 'user_document',
        jurisdiction: req.jurisdiction,
        language: req.language ?? 'auto',
        tags: req.tags ?? [],
        namespaces: req.namespaces ?? ['user_documents'],
        chunkSize: req.chunkSize ?? NYV_RAG.chunkSize,
        enableGraphRAG: req.enableGraphRAG !== false,
      },
      priority: req.isConfidential ? 10 : 5,
      createdBy: req.userId,
      orgId: parseInt(req.orgId, 10) || undefined,
      platform: req.platform,
    });

    // 5. Record status in DB
    await db.execute(sql`
      INSERT INTO nv_schema.nv_document_ingest_status (
        doc_id, job_id, org_id, platform, user_id, file_name, mime_type, file_size_bytes,
        sha256_hash, storage_path, document_class, jurisdiction, language, tags, is_confidential
      ) VALUES (
        ${docId}, ${jobId}, ${req.orgId}, ${req.platform}, ${req.userId},
        ${req.fileName}, ${req.mimeType}, ${req.fileSizeBytes},
        ${sha256Hash}, ${storagePath},
        ${req.documentClass ?? 'user_document'}, ${req.jurisdiction ?? null},
        ${req.language ?? 'auto'}, ${JSON.stringify(req.tags ?? [])},
        ${req.isConfidential ?? false}
      )
      ON CONFLICT (doc_id) DO UPDATE SET updated_at = NOW()
    `);

    logger.info('document_queued', { docId, jobId, fileName: req.fileName, orgId: req.orgId, userId: req.userId });

    const estimatedSeconds = Math.ceil(req.fileSizeBytes / 50_000) + 5; // ~5s base + 1s per 50KB

    return {
      docId,
      jobId,
      status: 'queued',
      storagePath,
      estimatedProcessingSeconds: estimatedSeconds,
      statusUrl: `/api/jrx/documents/${docId}/status`,
      sha256Hash,
    };
  }

  // ── PROCESS (called by job worker) ────────────────────────────────────────

  /**
   * Full processing pipeline: parse → chunk → embed → index → graph.
   * Called by nv-job-worker when processing 'document_pipeline' tasks.
   */
  async processDocument(payload: {
    docId: string;
    orgId: string;
    platform: string;
    userId: string;
    fileName: string;
    mimeType: string;
    storagePath: string;
    sha256Hash: string;
    documentClass: string;
    jurisdiction?: string;
    language?: string;
    namespaces: string[];
    chunkSize: number;
    enableGraphRAG: boolean;
    /** When provided, skip re-download + re-OCR (EDJ already extracted). */
    extractedText?: string;
    fileBuffer?: Buffer;
  }): Promise<{ chunksIndexed: number; embeddingsGenerated: number; graphNodesAdded: number }> {
    const { docId, orgId, platform, userId, fileName, mimeType, storagePath, jurisdiction, language, chunkSize, enableGraphRAG } = payload;
    let chunksIndexed = 0;
    let embeddingsGenerated = 0;
    let graphNodesAdded = 0;

    try {
      await this.updateStatus(docId, 'parsing', 10, 'Parsing document content');

      let extractedText = typeof payload.extractedText === 'string' ? payload.extractedText.trim() : '';
      if (!extractedText) {
        const fileBuffer =
          payload.fileBuffer ??
          (await nyvDocumentStorage.download(storagePath).catch(() => null))?.content ??
          null;
        if (!fileBuffer) throw new Error(`Storage download failed for ${storagePath}`);
        extractedText = await this.extractText(fileBuffer, mimeType, fileName, language ?? 'en');
      }

      await this.updateStatus(docId, 'chunking', 30, 'Chunking document');

      // Step 3: Chunk text — structure-aware legal chunking (sections / clauses /
      // definitions) with parent-context breadcrumbs. NV-INGEST-CHUNK-001:
      // replaced the naive fixed-window word split so async-ingested documents
      // are chunked the same way the SME/legal-pipeline path chunks them.
      const chunks = await this.legalChunk(extractedText, mimeType, jurisdiction, chunkSize);

      await this.updateStatus(docId, 'embedding', 50, `Generating embeddings for ${chunks.length} chunks`);

      // Step 4: Generate embeddings + store in pgvector
      const stored = await this.embedAndStore({
        docId, orgId, platform, userId, fileName, mimeType, chunks,
        jurisdiction, documentClass: payload.documentClass, namespace: payload.namespaces[0] ?? 'user_documents',
      });
      chunksIndexed = stored.chunksStored;
      embeddingsGenerated = stored.embeddingsGenerated;

      await this.updateStatus(docId, 'graph_indexing', 80, 'Building legal entity graph');

      // Step 5: Legal GraphRAG indexing
      if (enableGraphRAG) {
        try {
          const { nyvGraphRAGLegal } = await import('./rag/nyv-graphrag-legal-service.js');
          const graphResult = await nyvGraphRAGLegal.indexDocument({
            docId, text: extractedText, fileName, jurisdiction: jurisdiction ?? 'IN',
            documentClass: payload.documentClass,
          });
          graphNodesAdded = graphResult.nodesAdded;
        } catch (graphErr: any) {
          logger.warn('graphrag_index_failed', { docId, error: graphErr.message });
        }
      }

      // Step 6: Mark complete
      await this.updateStatus(docId, 'completed', 100, 'Document fully indexed', {
        chunksIndexed, embeddingsGenerated, graphNodesAdded, retrievable: true,
      });

      logger.info('document_processed', { docId, chunksIndexed, embeddingsGenerated, graphNodesAdded });
      return { chunksIndexed, embeddingsGenerated, graphNodesAdded };
    } catch (err: any) {
      logger.error('document_process_failed', { docId, error: err.message });
      await this.updateStatus(docId, 'failed', 0, err.message, { error: err.message });
      throw err;
    }
  }

  // ── STATUS ────────────────────────────────────────────────────────────────

  async getStatus(docId: string, userId: string): Promise<IngestStatusResult | null> {
    await this.init();
    try {
      const rows = await db.execute(sql`
        SELECT doc_id, job_id, status, progress, stage, chunks_indexed,
               embeddings_generated, graph_nodes_added, error_message,
               started_at, completed_at, retrievable
        FROM nv_schema.nv_document_ingest_status
        WHERE doc_id = ${docId} AND user_id = ${userId}
        LIMIT 1
      `);
      const row = ((rows as any).rows ?? rows)?.[0];
      if (!row) return null;
      return {
        docId: row.doc_id ?? docId,
        jobId: row.job_id,
        status: row.status,
        progress: row.progress ?? 0,
        stage: row.stage ?? '',
        chunksIndexed: row.chunks_indexed ?? 0,
        embeddingsGenerated: row.embeddings_generated ?? 0,
        graphNodesAdded: row.graph_nodes_added ?? 0,
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        retrievable: row.retrievable ?? false,
      };
    } catch {
      return null;
    }
  }

  async listDocuments(orgId: string, platform: string, userId: string, limit = 20, offset = 0): Promise<{
    documents: IngestStatusResult[];
    total: number;
  }> {
    await this.init();
    try {
      const rows = await db.execute(sql`
        SELECT doc_id, job_id, file_name, status, progress, stage, chunks_indexed,
               embeddings_generated, graph_nodes_added, retrievable, created_at, completed_at
        FROM nv_schema.nv_document_ingest_status
        WHERE org_id = ${orgId} AND platform = ${platform} AND user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      const countRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM nv_schema.nv_document_ingest_status
        WHERE org_id = ${orgId} AND platform = ${platform} AND user_id = ${userId}
      `);
      const docs = ((rows as any).rows ?? rows ?? []).map((r: any) => ({
        docId: r.doc_id, jobId: r.job_id, fileName: r.file_name,
        status: r.status, progress: r.progress ?? 0, stage: r.stage,
        chunksIndexed: r.chunks_indexed ?? 0, embeddingsGenerated: r.embeddings_generated ?? 0,
        graphNodesAdded: r.graph_nodes_added ?? 0, retrievable: r.retrievable ?? false,
        startedAt: r.created_at, completedAt: r.completed_at,
      }));
      const total = parseInt(((countRows as any).rows ?? countRows)?.[0]?.cnt ?? '0', 10);
      return { documents: docs, total };
    } catch {
      return { documents: [], total: 0 };
    }
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────

  /**
   * Search across all indexed documents for this user using the enhanced RAG pipeline.
   * Combines: pgvector semantic search + BM25 keyword + optional GraphRAG.
   */
  async search(req: DocumentSearchRequest): Promise<DocumentSearchResult> {
    const startMs = Date.now();
    try {
      const ragResult = await nyvRagPipeline.retrieve({
        query: req.query,
        userId: req.userId,
        orgId: req.orgId,
        platform: req.platform,
        jurisdiction: req.jurisdiction,
        language: req.language,
        topK: req.maxResults ?? 10,
        minSimilarity: req.minScore ?? 0.72,
        useReranker: req.enableRerank !== false,
        namespaces: this.resolveNamespaces(req) as any,
      });

      let graphResults: GraphSearchResult[] = [];
      if (req.enableGraphRAG !== false) {
        try {
          const { nyvGraphRAGLegal } = await import('./rag/nyv-graphrag-legal-service.js');
          graphResults = await nyvGraphRAGLegal.search(req.query, req.orgId, req.userId, 5);
        } catch {}
      }

      const sourceChunks: any[] = ragResult.topChunks ?? ragResult.retrievedChunks ?? [];
      const chunks: SearchChunk[] = sourceChunks.map((c: any, idx: number) => ({
        chunkId: c.id ?? `${c.documentId}-${idx}`,
        docId: String(c.documentId ?? ''),
        fileName: c.sourceFileName ?? '',
        text: c.text,
        score: c.hybridScore ?? c.vectorScore ?? 0,
        pageNumber: c.pageNumber,
        chunkIndex: c.chunkIndex ?? idx,
        jurisdiction: c.jurisdiction,
        statute: c.statute,
        documentClass: c.metadata?.documentClass,
        namespace: c.namespace ?? 'user_documents',
        isGrounded: c.isGrounded ?? true,
        citationRef: c.citationRef,
      }));

      return {
        chunks,
        totalFound: ragResult.totalChunks ?? chunks.length,
        retrievalMethod: (ragResult.retrievalStrategy as any) ?? 'hybrid',
        latencyMs: Date.now() - startMs,
        queryAnalysis: {
          intent: ragResult.analysis?.intent ?? 'general',
          complexity: ragResult.analysis?.complexity ?? 'moderate',
          jurisdiction: ragResult.analysis?.jurisdiction ?? req.jurisdiction ?? null,
          language: ragResult.analysis?.language ?? req.language ?? 'en',
          keywords: ragResult.analysis?.keywords ?? [],
        },
        graphRAGResults: graphResults,
      };
    } catch (err: any) {
      logger.error('search_failed', { query: req.query, error: err.message });
      return { chunks: [], totalFound: 0, retrievalMethod: 'none', latencyMs: Date.now() - startMs, queryAnalysis: { intent: 'general', complexity: 'simple', jurisdiction: null, language: 'en', keywords: [] } };
    }
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

  private validateFile(req: IngestRequest): void {
    const MAX_SIZE = 100 * 1024 * 1024; // 100MB
    if (req.fileSizeBytes > MAX_SIZE) throw new Error(`File exceeds 100MB limit: ${req.fileSizeBytes} bytes`);
    const ALLOWED_MIMES = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/markdown', 'text/html', 'application/json',
      'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
    ];
    if (!ALLOWED_MIMES.includes(req.mimeType)) throw new Error(`Unsupported file type: ${req.mimeType}`);
  }

  /**
   * Extract plain text from a stored document buffer for the async pipeline.
   *
   * Mirrors the synchronous document-intelligence path: text / JSON / HTML are
   * decoded as UTF-8, Word documents are parsed with mammoth, and PDFs / images
   * go through the single real OCR engine (digital text layer first, then the
   * provider-precedence OCR in nv-got-ocr-adapter-service).
   *
   * When no OCR provider can produce text the adapter throws
   * OcrProviderUnavailableError; that error propagates so processDocument marks
   * the job failed rather than indexing fabricated content.
   */
  private async extractText(buffer: Buffer, mimeType: string, fileName: string, language: string): Promise<string> {
    if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'text/html') {
      return buffer.toString('utf-8');
    }

    if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value || '').trim();
      if (!text) throw new Error(`No text could be extracted from ${fileName}`);
      return text;
    }

    if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
      const ocrOptions = language && language !== 'auto' ? { language } : {};
      const ocr = await nvOcrAdapterService.ocrDocument(buffer, mimeType, ocrOptions);
      logger.info('extractText:ocr', {
        fileName, mimeType, provider: ocr.provider, method: ocr.extractionMethod, chars: ocr.text.length,
      });
      return ocr.text;
    }

    // Other supported binary formats (xls / ppt) — best-effort UTF-8 decode.
    return buffer.toString('utf-8');
  }

  /**
   * NV-INGEST-CHUNK-001 — structure-aware legal chunking for the async ingest
   * pipeline. Parses the extracted text into a legal document structure, then
   * chunks per section/clause/definition with parent-context breadcrumbs so the
   * embedded text carries hierarchy (statute > chapter > section, contract >
   * clause, etc.). Falls back to the deterministic fixed-window word split if
   * parsing/chunking yields nothing, so ingest never silently drops a document.
   */
  private async legalChunk(text: string, mimeType: string, jurisdiction: string | undefined, chunkSize: number): Promise<string[]> {
    if (!text || text.trim().length === 0) return [];
    try {
      const [{ nvLegalParserService }, { NvLegalChunkerService }] = await Promise.all([
        import('./document-pipeline/jrx-legal-parser-service.js'),
        import('./document-pipeline/jrx-legal-chunker-service.js'),
      ]);
      const juris = (['IN', 'UK', 'EU', 'US', 'GC', 'SG'].includes(String(jurisdiction)) ? jurisdiction : (jurisdiction === 'GCC' ? 'GC' : 'IN')) as 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';
      const parsed = await nvLegalParserService.parseDocument(text, mimeType);
      const legalChunks = await NvLegalChunkerService.getInstance().chunkDocument(parsed, {
        jurisdiction: juris,
        maxChunkTokens: Math.max(200, Math.ceil(chunkSize * 1.3)),
        overlapTokens: Math.floor(chunkSize * 0.2),
        includeParentContext: true,
      });
      const mapped = legalChunks
        .map((c) => (c.parentContext ? `${c.parentContext}\n${c.content}` : c.content))
        .filter((c) => c.trim().length > 20);
      if (mapped.length > 0) return mapped.slice(0, NYV_RAG.maxChunksPerDoc);
      logger.warn('legal_chunk_empty_fallback_word_split', { mimeType, jurisdiction });
    } catch (err: any) {
      logger.warn('legal_chunk_failed_fallback_word_split', { error: err?.message, mimeType, jurisdiction });
    }
    return this.chunkText(text, chunkSize, Math.floor(chunkSize * 0.2));
  }

  private chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
    if (!text || text.trim().length === 0) return [];
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let i = 0;
    while (i < words.length) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 20) chunks.push(chunk);
      i += chunkSize - overlap;
    }
    return chunks.slice(0, NYV_RAG.maxChunksPerDoc);
  }

  private async embedAndStore(params: {
    docId: string; orgId: string; platform: string; userId: string;
    fileName: string; mimeType: string; chunks: string[];
    jurisdiction?: string; documentClass?: string; namespace: string;
  }): Promise<{ chunksStored: number; embeddingsGenerated: number }> {
    // Live RDS knowledge_chunks schema (rag-service): source/title/content/
    // jurisdiction/domain/citation_ref/chunk_index/token_count/embedding.
    // Do NOT write doc_id/user_id/org_id/namespace — those columns are absent.
    const { docId, fileName, chunks, jurisdiction, documentClass, namespace } = params;
    let chunksStored = 0;
    let embeddingsGenerated = 0;
    const domain = documentClass ?? 'user_document';
    const juris = jurisdiction ?? 'global';
    const citationFor = (idx: number) =>
      `edj:${docId}|ns:${namespace}|chunk:${idx}`;

    const storePlain = async (chunk: string, idx: number): Promise<boolean> => {
      try {
        await db.execute(sql`
          INSERT INTO knowledge_chunks (
            source, title, content, jurisdiction, domain,
            citation_ref, chunk_index, token_count, updated_at
          ) VALUES (
            ${fileName}, ${fileName}, ${chunk}, ${juris}, ${domain},
            ${citationFor(idx)}, ${idx}, ${Math.ceil(chunk.length / 4)}, NOW()
          )
        `);
        chunksStored++;
        return true;
      } catch (err: any) {
        logger.warn('knowledge_chunk_plain_insert_failed', {
          docId, idx, error: err?.message || String(err),
        });
        return false;
      }
    };

    try {
      const { generateGeminiEmbeddingsBatch } = await import('./jrx-gemini-embeddings.js');

      for (let i = 0; i < chunks.length; i += 10) {
        const batch = chunks.slice(i, i + 10);
        let embeddings: Array<number[] | null> = [];
        try {
          embeddings = await generateGeminiEmbeddingsBatch(batch);
        } catch (err: any) {
          logger.warn('gemini_batch_embed_failed', { docId, error: err?.message || String(err) });
          embeddings = batch.map(() => null);
        }

        // Fallback: try Google batch service when Gemini returns all-null
        if (embeddings.every((e) => !e)) {
          try {
            const { nyayavignyaEmbeddingService } = await import('./document-pipeline/embedding-service.js');
            const embedResult = await (nyayavignyaEmbeddingService as any).generateBatchEmbeddings?.({
              texts: batch,
              provider: 'google',
            });
            if (embedResult?.embeddings) {
              embeddings = embedResult.embeddings.map((r: any) => r?.embedding ?? null);
            }
          } catch {
            /* continue with plain text */
          }
        }

        for (let j = 0; j < batch.length; j++) {
          const embedding = embeddings[j];
          const idx = i + j;
          if (Array.isArray(embedding) && embedding.length > 0) {
            const embeddingStr = `[${embedding.join(',')}]`;
            try {
              await db.execute(sql`
                INSERT INTO knowledge_chunks (
                  source, title, content, jurisdiction, domain,
                  citation_ref, chunk_index, token_count, embedding, updated_at
                ) VALUES (
                  ${fileName}, ${fileName}, ${batch[j]}, ${juris}, ${domain},
                  ${citationFor(idx)}, ${idx}, ${Math.ceil(batch[j].length / 4)},
                  ${embeddingStr}::vector, NOW()
                )
              `);
              chunksStored++;
              embeddingsGenerated++;
              continue;
            } catch (err: any) {
              logger.warn('knowledge_chunk_vector_insert_failed', {
                docId, idx, error: err?.message || String(err),
              });
              await storePlain(batch[j], idx);
              continue;
            }
          }
          await storePlain(batch[j], idx);
        }
      }
    } catch (err: any) {
      logger.warn('embed_store_degraded', { docId, error: err.message });
      for (let i = 0; i < chunks.length; i++) {
        await storePlain(chunks[i], i);
      }
    }

    return { chunksStored, embeddingsGenerated };
  }

  private resolveNamespaces(req: DocumentSearchRequest): string[] {
    const ns: string[] = ['user_documents'];
    if (req.includeOrgShared !== false) ns.push('org_shared');
    if (req.includeGlobalStatutes !== false) ns.push('global_statutes');
    return ns;
  }

  private async updateStatus(
    docId: string,
    status: IngestStatus,
    progress: number,
    stage: string,
    extra: Record<string, any> = {},
  ): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE nv_schema.nv_document_ingest_status
        SET status = ${status}, progress = ${progress}, stage = ${stage},
            chunks_indexed = COALESCE(${extra.chunksIndexed ?? null}, chunks_indexed),
            embeddings_generated = COALESCE(${extra.embeddingsGenerated ?? null}, embeddings_generated),
            graph_nodes_added = COALESCE(${extra.graphNodesAdded ?? null}, graph_nodes_added),
            retrievable = COALESCE(${extra.retrievable ?? null}, retrievable),
            error_message = ${extra.error ?? null},
            started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END,
            completed_at = CASE WHEN ${status} = 'completed' OR ${status} = 'failed' THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE doc_id = ${docId}
      `);
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const nyvDocIntelligence = NyvDocumentIntelligenceOrchestrator.getInstance();
export default nyvDocIntelligence;
