/**
 * EcosystemDocumentsApi — Large/shared document jobs (NV-EDJ-001).
 * Canonical path: /api/jrx/v1/sdk/ecosystem-documents/jobs
 */
import type { JrxHttpClient } from '../JrxClient.js';

export type EdjOutputProfile =
  | 'ingest_only'
  | 'summary'
  | 'extraction'
  | 'full_intelligence'
  | 'custom';

export type StorageRefType = 'nyv_shared_key' | 'presigned_get' | 'nyv_doc_id';

export interface EdjStorageRef {
  type: StorageRefType;
  storageKey?: string;
  url?: string;
  expiresAt?: string;
  nyvDocId?: string;
  sha256?: string;
  sizeBytes?: number;
  mimeType?: string;
  fileName?: string;
}

export interface EdjFieldManifestField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  extract?: {
    method: 'regex' | 'builtin' | 'llm' | 'tool';
    pattern?: string;
    handler?: string;
    instruction?: string;
    toolId?: string;
  };
}

export interface CreateEdjJobRequest {
  platformCode?: string;
  correlationId: string;
  orgId: string;
  userId?: string;
  jurisdiction?: string;
  documentType?: string;
  storageRef: EdjStorageRef;
  outputProfile?: EdjOutputProfile;
  outputOptions?: {
    enableRagIndex?: boolean;
    enableGraphRag?: boolean;
    languages?: string[];
  };
  fieldManifest?: { version?: string; fields: EdjFieldManifestField[] };
  delivery?: {
    mode?: 'poll' | 'webhook' | 'poll_and_webhook';
    webhookUrl?: string;
    callbackMetadata?: Record<string, unknown>;
  };
  ttlSeconds?: number;
}

export interface EdjJobSubmitResponse {
  jobId: string;
  taskId: string;
  status: 'queued';
  statusUrl: string;
  resultUrl: string;
  pollIntervalMs: number;
  expiresAt: string;
}

export interface EdjRawContent {
  /** First N characters of extracted text (inline preview). */
  preview: string;
  /** Total character count. */
  charCount: number;
  /** Total word count. */
  wordCount: number;
  /** Estimated page count. */
  pageCount: number;
  /** URL to fetch the complete raw content. */
  contentUrl: string;
  mimeType: 'text/plain';
  encoding: 'utf-8';
}

export interface EdjContentResponse {
  jobId: string;
  platformCode: string;
  correlationId: string;
  /** The complete raw parsed text of the document. */
  content: string;
  charCount: number;
  wordCount: number;
  pageCount: number;
  mimeType: 'text/plain';
  encoding: 'utf-8';
  extractedAt: string;
  /**
   * Extracted fields from the fieldManifest (if requested during job submission).
   * Use this for structured data without running your own NLP on the raw text.
   * null if no fieldManifest was provided or extraction not yet complete.
   */
  fields: Record<string, unknown> | null;
  /**
   * Document metadata detected during processing.
   */
  documentMeta: {
    documentType?: string;
    jurisdiction?: string;
    language?: string;
    fileName?: string;
    storagePath?: string;
    nyvDocId?: string;
  } | null;
}

export interface EdjJobStatus {
  jobId: string;
  taskId: string;
  status: string;
  phase: string;
  progress: number;
  platformCode?: string;
  correlationId?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  error?: { code: string; message: string; retryable: boolean } | null;
  resultInline?: Record<string, unknown> | null;
  resultRef?: { url: string; expiresAt: string; bytes?: number } | null;
  statusUrl: string;
  resultUrl: string;
  pollIntervalMs: number;
}

export class EcosystemDocumentsApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** Submit a durable ecosystem document job (large/shared storage). */
  async createJob(req: CreateEdjJobRequest): Promise<EdjJobSubmitResponse> {
    const res = await this.http.post<{ success: boolean; data: EdjJobSubmitResponse }>(
      '/api/jrx/v1/sdk/ecosystem-documents/jobs',
      req,
    );
    return (res as { data?: EdjJobSubmitResponse }).data ?? (res as unknown as EdjJobSubmitResponse);
  }

  /** Poll job status (phase, progress, inline result when small). */
  getJob(jobId: string): Promise<EdjJobStatus> {
    return this.http
      .get<{ success: boolean; data: EdjJobStatus }>(`/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}`)
      .then((r) => (r as { data?: EdjJobStatus }).data ?? (r as unknown as EdjJobStatus));
  }

  /** Fetch full result payload (for large docs or after webhook). */
  getResult(jobId: string): Promise<Record<string, unknown>> {
    return this.http
      .get<{ success: boolean; data: Record<string, unknown> }>(
        `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/result`,
      )
      .then((r) => (r as { data?: Record<string, unknown> }).data ?? (r as Record<string, unknown>));
  }

  /**
   * Fetch the full raw parsed document content (text extracted via OCR/parsing).
   * Use this when your platform needs the raw text for custom processing,
   * field extraction, or downstream integrations beyond what the EDJ pipeline provides.
   */
  getContent(jobId: string): Promise<EdjContentResponse> {
    return this.http
      .get<{ success: boolean; data: EdjContentResponse }>(
        `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/content`,
      )
      .then((r) => (r as { data?: EdjContentResponse }).data ?? (r as unknown as EdjContentResponse));
  }

  /**
   * Fetch the raw parsed content as plain text string (no JSON envelope).
   * Useful for streaming into your own NLP pipeline.
   */
  async getContentText(jobId: string): Promise<string> {
    const response = await this.getContent(jobId);
    return response.content;
  }

  /**
   * Fetch only the extracted fields (from fieldManifest) without the raw text.
   * Ideal when your platform only needs structured data and wants to minimize payload size.
   */
  async getFields(jobId: string): Promise<{
    jobId: string;
    platformCode: string;
    correlationId: string;
    fields: Record<string, unknown> | null;
    documentMeta: EdjContentResponse['documentMeta'];
    charCount: number;
    wordCount: number;
    pageCount: number;
    extractedAt: string;
  }> {
    return this.http
      .get<{ success: boolean; data: {
        jobId: string;
        platformCode: string;
        correlationId: string;
        fields: Record<string, unknown> | null;
        documentMeta: EdjContentResponse['documentMeta'];
        charCount: number;
        wordCount: number;
        pageCount: number;
        extractedAt: string;
      } }>(`/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/content?format=fields_only`)
      .then((r) => (r as { data?: any }).data ?? r);
  }

  /**
   * NSP shared storage → Jurexio RAG indexing via durable EDJ.
   * Requires `platformClient` on JrxClient config (`X-NSP-Client` header).
   */
  async processNspSharedDoc(body: {
    storageKey: string;
    orgId: number | string;
    docId: number | string;
    jurisdiction?: string;
    documentType?: string;
    sizeBytes?: number;
    mimeType?: string;
    fileName?: string;
  }): Promise<EdjJobSubmitResponse & { pollUrl: string }> {
    const res = await this.http.post<{ success: boolean; data: EdjJobSubmitResponse & { pollUrl?: string } }>(
      '/api/jrx/shared-docs/process',
      body,
    );
    const data = (res as { data?: EdjJobSubmitResponse }).data ?? (res as unknown as EdjJobSubmitResponse);
    return { ...data, pollUrl: data.statusUrl };
  }

  /** Poll NSP shared-doc job status (EDJ-backed). */
  getNspSharedDocStatus(jobId: string): Promise<EdjJobStatus> {
    return this.http
      .get<{ success: boolean; data: EdjJobStatus }>(`/api/jrx/shared-docs/status/${encodeURIComponent(jobId)}`)
      .then((r) => (r as { data?: EdjJobStatus }).data ?? (r as unknown as EdjJobStatus));
  }

  /**
   * Legacy NSP alias — POST /api/jrx-docs/process (returns taskId = jobId).
   * @deprecated Use createJob() or processNspSharedDoc()
   */
  async processSharedDoc(body: {
    storageKey: string;
    orgId: number | string;
    docId: number | string;
    jurisdiction?: string;
    documentType?: string;
    sizeBytes?: number;
    mimeType?: string;
    fileName?: string;
  }): Promise<EdjJobSubmitResponse & { pollUrl: string }> {
    const res = await this.http.post<{ success: boolean; data: EdjJobSubmitResponse & { pollUrl?: string } }>(
      '/api/jrx-docs/process',
      body,
    );
    const data = (res as { data?: EdjJobSubmitResponse }).data ?? (res as unknown as EdjJobSubmitResponse);
    return { ...data, pollUrl: data.statusUrl };
  }

  /** Poll until terminal state or timeout. */
  async waitForJob(
    jobId: string,
    { intervalMs = 1000, timeoutMs = 3_600_000, onProgress }: {
      intervalMs?: number;
      timeoutMs?: number;
      onProgress?: (status: EdjJobStatus) => void;
    } = {},
  ): Promise<EdjJobStatus> {
    const start = Date.now();
    const terminal = new Set(['completed', 'partial', 'failed', 'expired', 'cancelled']);
    while (Date.now() - start < timeoutMs) {
      const status = await this.getJob(jobId);
      onProgress?.(status);
      if (terminal.has(status.status)) {
        if (status.status === 'failed' || status.status === 'expired') {
          throw new Error(status.error?.message || `Job ${jobId} ended with status ${status.status}`);
        }
        return status;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Ecosystem document job ${jobId} did not complete within ${timeoutMs}ms`);
  }

  /** Submit + poll + fetch full result in one call. */
  async processAndWait(
    req: CreateEdjJobRequest,
    waitOpts?: Parameters<EcosystemDocumentsApi['waitForJob']>[1],
  ): Promise<{ status: EdjJobStatus; result: Record<string, unknown> }> {
    const submitted = await this.createJob(req);
    const status = await this.waitForJob(submitted.jobId, waitOpts);
    const result =
      (status.resultInline as Record<string, unknown> | null | undefined) ??
      (await this.getResult(submitted.jobId));
    return { status, result };
  }

  /**
   * Submit, wait for completion, then fetch both the intelligence result AND
   * the full raw parsed document content in one go. Ideal for platforms that need
   * both the AI analysis and the raw text for their own downstream processing.
   */
  async processAndGetContent(
    req: CreateEdjJobRequest,
    waitOpts?: Parameters<EcosystemDocumentsApi['waitForJob']>[1],
  ): Promise<{ status: EdjJobStatus; result: Record<string, unknown>; content: EdjContentResponse }> {
    const { status, result } = await this.processAndWait(req, waitOpts);
    const content = await this.getContent(status.jobId);
    return { status, result, content };
  }
}
