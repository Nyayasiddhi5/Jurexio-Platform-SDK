/**
 * DocAiApi — Typed wrappers for the Batch C `/api/nv5/doc-ai/*` deterministic
 * document conversion surface (Session-10, 2026-05-10). Pure-deterministic
 * conversion (PDF/A, DOCX, OCR-PDF) — no LLM emission. Default OFF
 * (`JRX_F_DOC_AI_CONVERT`).
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 13b
 * Server: src/routes/nv5/doc-ai/convert-routes.ts
 */

import type { NyvHttpClient } from '../NyvClient.js';

/** Server returns the full `{ success, ... }` envelope. We preserve that shape. */
export interface DocAiHealthResponse {
  success: boolean;
  service: string;
  distributedMode: boolean;
  storeMode?: { distributed?: boolean; ledger?: string; blob?: string; podId?: string } | null;
  queueLive: boolean;
  activeLegacyJobs?: number;
  podId?: string;
  lastBlobSweep?: unknown;
}

export interface DocAiSupportedResponse {
  success: boolean;
  /**
   * Source-format → target-format[] map as returned by
   * `nvDocumentConverter.getSupportedConversions()`.
   */
  supported: Record<string, string[]>;
}

export type DocAiJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type DocAiMode = 'distributed' | 'in-process';

export interface DocAiSubmitResponse {
  success: boolean;
  jobId: string;
  status: DocAiJobStatus;
  bytesIn: number;
  mode: DocAiMode;
  ledger?: string;
  blob?: string;
}

export interface DocAiJob {
  id: string;
  status: DocAiJobStatus;
  sourceFormat: string;
  targetFormat: string;
  bytesIn: number;
  bytesOut?: number;
  conversionMs?: number;
  createdAt: string | Date;
  startedAt?: string | Date;
  completedAt?: string | Date;
  error?: string;
  acceptedByPod?: string;
  executedByPod?: string;
}

export interface DocAiJobResponse {
  success: boolean;
  job: DocAiJob;
}

export interface DocAiResultBytes {
  /** Raw converted bytes. */
  data: Uint8Array;
  /** MIME negotiated by the converter (`Content-Type`). */
  mimeType: string;
  /** Filename parsed from `Content-Disposition`, when present. */
  fileName?: string;
}

export interface DocAiSubmitOptions {
  /** Source format slug (`pdf`, `docx`, `txt`, …). REQUIRED — server rejects with 400 if missing. */
  sourceFormat: string;
  /** Target format slug (`pdf-a`, `docx`, `txt`, …). REQUIRED — server rejects with 400 if missing. */
  targetFormat: string;
  /** Optional converter options forwarded as a JSON-stringified `options` form field. */
  options?: Record<string, unknown>;
}

export interface DocAiSubmitBase64Options extends DocAiSubmitOptions {
  /** Base64-encoded source bytes (alternative to multipart `file`). */
  sourceBase64: string;
}

export class DocAiApi {
  constructor(private http: NyvHttpClient) {}

  health(): Promise<DocAiHealthResponse> {
    return this.http.get('/api/nv5/doc-ai/convert/health');
  }

  supported(): Promise<DocAiSupportedResponse> {
    return this.http.get('/api/nv5/doc-ai/convert/supported');
  }

  /**
   * Submit a conversion job from a binary file. The gateway accepts a
   * multer-parsed file (≤ 1 GB) under the `file` field; `sourceFormat` and
   * `targetFormat` are REQUIRED form fields per the server contract.
   */
  submitJob(
    file: Blob | Buffer | Uint8Array,
    fileName: string,
    options: DocAiSubmitOptions
  ): Promise<DocAiSubmitResponse> {
    const form = new FormData();
    let blob: Blob;
    if (file instanceof Blob) {
      blob = file;
    } else {
      const u8 = file instanceof Uint8Array
        ? new Uint8Array(file)
        : new Uint8Array(file as unknown as ArrayLike<number>);
      blob = new Blob([u8]);
    }
    form.append('file', blob, fileName);
    form.append('sourceFormat', options.sourceFormat);
    form.append('targetFormat', options.targetFormat);
    if (options.options) form.append('options', JSON.stringify(options.options));
    return this.http.postForm('/api/nv5/doc-ai/convert/jobs', form);
  }

  /**
   * Submit a conversion job from a base64-encoded source. Alternative to
   * `submitJob()` when you don't have a file handle (server accepts JSON
   * with `sourceBase64`).
   */
  submitJobBase64(opts: DocAiSubmitBase64Options): Promise<DocAiSubmitResponse> {
    return this.http.post('/api/nv5/doc-ai/convert/jobs', {
      sourceBase64: opts.sourceBase64,
      sourceFormat: opts.sourceFormat,
      targetFormat: opts.targetFormat,
      options: opts.options,
    });
  }

  /** Poll job status — server returns `{ success: true, job: {...} }`. */
  getJob(jobId: string): Promise<DocAiJobResponse> {
    return this.http.get(`/api/nv5/doc-ai/convert/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Download converted bytes. Server returns the raw file body with
   * `Content-Type` + `Content-Disposition`; this helper unwraps that into
   * `{ data, mimeType, fileName }`. Throws `NyvError` if the job is not
   * done (409) or the blob is missing (410).
   */
  getResult(jobId: string): Promise<DocAiResultBytes> {
    return this.http.getBytes(`/api/nv5/doc-ai/convert/jobs/${encodeURIComponent(jobId)}/result`);
  }
}
