/**
 * DocumentsApi — Document intelligence pipeline for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/documents/* and /api/jrx/doc-analyze/*
 */

import type {
  NyvDocumentUploadResponse,
  NyvDocumentStatus,
  NyvDocumentSearchResult,
  NyvDocumentAnalysis,
  NyvListResponse,
  NyvPaginationOptions,
} from '../types/index.js';
import type { NyvHttpClient } from '../NyvClient.js';

export interface DocumentUploadOptions {
  fileName: string;
  mimeType?: string;
  jurisdiction?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DocumentSearchOptions {
  limit?: number;
  jurisdiction?: string;
  searchMode?: 'hybrid' | 'semantic' | 'keyword';
  filters?: {
    docType?: string;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
  };
}

export interface DocumentAnalysisOptions {
  generateSummary?: boolean;
  extractClauses?: boolean;
  identifyObligations?: boolean;
  assessRisks?: boolean;
  findMissingTerms?: boolean;
  detectPrivacyAlerts?: boolean;
}

export class DocumentsApi {
  constructor(private readonly http: NyvHttpClient) {}

  /**
   * Upload a document buffer for RAG indexing.
   * Files > 5MB are automatically queued as async jobs.
   * Returns immediately with docId + jobId.
   */
  async upload(
    fileBuffer: Buffer | Uint8Array,
    options: DocumentUploadOptions
  ): Promise<NyvDocumentUploadResponse> {
    return this.uploadBuffer(fileBuffer, options);
  }

  /** NSP alias — upload document buffer for RAG indexing. */
  async uploadBuffer(
    fileBuffer: Buffer | Uint8Array,
    options: DocumentUploadOptions
  ): Promise<NyvDocumentUploadResponse> {
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    return this.http.post('/api/jrx/doc-analyze/extract', {
      fileBase64,
      fileName: options.fileName,
      metadata: options.metadata,
    });
  }

  /**
   * Upload via FormData (for browser use with File/Blob input).
   * Uses the multipart endpoint at /api/jrx/documents/upload.
   */
  async uploadFormData(
    file: File | Blob,
    options: Omit<DocumentUploadOptions, 'mimeType'>
  ): Promise<NyvDocumentUploadResponse> {
    const form = new FormData();
    form.append('file', file, options.fileName);
    if (options.tags) form.append('tags', JSON.stringify(options.tags));
    if (options.jurisdiction) form.append('jurisdiction', options.jurisdiction);
    if (options.metadata) form.append('metadata', JSON.stringify(options.metadata));
    return this.http.postForm('/api/jrx/documents/upload', form);
  }

  /** Poll document indexing status by docId */
  getStatus(docId: string): Promise<NyvDocumentStatus> {
    return this.http.get(`/api/jrx/documents/${docId}/status`);
  }

  /**
   * Wait for a document job to complete (polls every intervalMs until done or timeout).
   */
  async waitForCompletion(
    docId: string,
    { intervalMs = 2000, timeoutMs = 120_000 } = {}
  ): Promise<NyvDocumentStatus> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getStatus(docId);
      if (status.status === 'COMPLETED' || status.status === 'FAILED') return status;
      await sleep(intervalMs);
    }
    throw new Error(`Document ${docId} did not complete within ${timeoutMs}ms`);
  }

  /** Hybrid RAG search across all indexed documents */
  search(query: string, options: DocumentSearchOptions = {}): Promise<NyvDocumentSearchResult> {
    return this.http.post('/api/jrx/documents/search', { query, ...options });
  }

  /** List all documents for the current user/org */
  list(pagination: NyvPaginationOptions = {}): Promise<NyvListResponse<{ docId: string; fileName: string; status: string; createdAt: string }>> {
    const params = new URLSearchParams();
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/documents/list?${params}`);
  }

  /** Delete a document and all its indexes */
  delete(docId: string): Promise<{ success: boolean; message: string }> {
    return this.http.delete(`/api/jrx/documents/${docId}`);
  }

  /**
   * Analyze document text (extract clauses, obligations, risks, summaries).
   * For pure text input — no upload required.
   */
  analyzeText(text: string, options: DocumentAnalysisOptions = {}): Promise<NyvDocumentAnalysis> {
    return this.http.post('/api/jrx/doc-analyze/analyze', { text, options });
  }

  /**
   * Extract text from a base64-encoded document (PDF or DOCX).
   * Returns extracted text, page count, word count.
   */
  extractText(
    fileBuffer: Buffer | Uint8Array,
    fileName: string
  ): Promise<{ success: boolean; text: string; pageCount: number; wordCount: number; format: string }> {
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    return this.http.post('/api/jrx/doc-analyze/extract', { fileBase64, fileName });
  }

  /**
   * Convenience: extract + analyze in one call.
   * Files > 5MB are queued asynchronously.
   */
  extractAndAnalyze(
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    options: DocumentAnalysisOptions = {}
  ): Promise<NyvDocumentAnalysis & NyvDocumentUploadResponse> {
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    return this.http.post('/api/jrx/doc-analyze/extract-and-analyze', { fileBase64, fileName, options });
  }

  /** Get legal knowledge graph stats (entity count, relationship count) */
  getGraphStats(): Promise<Record<string, unknown>> {
    return this.http.get('/api/jrx/documents/graph/stats');
  }

  /** Get document analysis stats for the current org */
  getAnalysisStats(): Promise<Record<string, unknown>> {
    return this.http.get('/api/jrx/doc-analyze/stats');
  }

  // ── NV-DOCPIPE-MRH-001 — Redline / Merge / Highlight ─────────────────────────

  /**
   * Redline two document versions (deterministic LCS track-changes diff) with an
   * optional safety-ring semantic material-change summary. `POST /api/jrx/documents/redline`.
   */
  redline(
    documentA: string,
    documentB: string,
    options: RedlineOptions = {}
  ): Promise<RedlineResult> {
    return this.http.post('/api/jrx/documents/redline', {
      documentA,
      documentB,
      semantic: options.semantic,
      jurisdiction: options.jurisdiction,
    });
  }

  /**
   * Merge ≥2 documents with deterministic clause dedupe + conflict detection.
   * `POST /api/jrx/documents/merge`.
   */
  merge(
    documents: MergeInputDocument[],
    options: { dedupeClauses?: boolean } = {}
  ): Promise<MergeResult> {
    return this.http.post('/api/jrx/documents/merge', {
      documents,
      dedupeClauses: options.dedupeClauses,
    });
  }

  /**
   * Analyze a document and map findings (risks / clauses / privacy / missing
   * terms) to character-offset highlight spans for inline rendering.
   * `POST /api/jrx/documents/highlight`.
   */
  highlight(
    text: string,
    options: { documentType?: string; pageCount?: number } = {}
  ): Promise<HighlightResult> {
    return this.http.post('/api/jrx/documents/highlight', {
      text,
      documentType: options.documentType,
      pageCount: options.pageCount,
    });
  }
}

export interface RedlineOptions {
  /** Include the safety-ring semantic material-change summary (default true). */
  semantic?: boolean;
  jurisdiction?: string;
}

export interface RedlineSegment {
  type: 'unchanged' | 'added' | 'removed' | string;
  text: string;
  [k: string]: unknown;
}

export interface RedlineResult {
  stats: Record<string, number>;
  segments: RedlineSegment[];
  /** Rendered unified track-changes diff. */
  unified: string;
  semanticSummary: string;
  materialChanges: string[];
}

export interface MergeInputDocument {
  title?: string;
  text: string;
}

export interface MergeConflict {
  clauseKey: string;
  sources: string[];
  variants: string[];
}

export interface MergeResult {
  merged: string;
  sections: Array<{ title: string; paragraphs: number }>;
  conflicts: MergeConflict[];
  dedupedCount: number;
  stats: { documents: number; paragraphs: number; uniqueParagraphs: number };
}

export interface HighlightSpan {
  start: number;
  end: number;
  category: string;
  severity?: string;
  note?: string;
  [k: string]: unknown;
}

export interface HighlightResult {
  documentType?: string;
  riskDistribution?: Record<string, unknown>;
  confidenceScore?: number;
  highlights: HighlightSpan[];
  risks: Array<Record<string, unknown>>;
  clauses: Array<Record<string, unknown>>;
  privacyAlerts: Array<Record<string, unknown>>;
  missingTerms: Array<Record<string, unknown>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
