/**
 * Real OCR Pipeline Service (SDK surface)
 *
 * Job-tracked OCR over the single real OCR engine (nv-got-ocr-adapter-service).
 * No canned strings: every processed document is extracted for real (PDF text
 * layer / vision OCR / local Tesseract) or the job fails with a real error.
 */

import { createRequire } from 'module';
import { createLogger } from '../../utils/logger.js';
import { nvOcrAdapterService } from '../document-pipeline/jrx-got-ocr-adapter-service.js';

const logger = createLogger('real-ocr-pipeline-service');
const require = createRequire(import.meta.url);

interface OCRInput {
  /** 'base64' (raw base64 or data-URL) or 'url' (remote file to fetch). */
  type?: 'base64' | 'url';
  data?: string;
  /** Legacy field name; treated the same as `data`. */
  content?: string;
  fileName: string;
  fileType?: string;
}

interface OCRProcessResult {
  text: string;
  confidence: number;
  pages: number;
  language: string;
  metadata: Record<string, any>;
}

interface OCRJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fileName: string;
  createdAt: string;
  completedAt?: string;
  result?: OCRProcessResult;
  error?: string;
}

class RealOCRPipelineService {
  private jobs: Map<string, OCRJob> = new Map();
  private processedCount = 0;
  private failedCount = 0;
  private confidenceSum = 0;

  async processDocument(input: OCRInput): Promise<OCRProcessResult> {
    try {
      const { buffer, mimeType } = await this.resolveInput(input);
      const result = await this.extract(buffer, mimeType, input.fileName);
      this.processedCount++;
      this.confidenceSum += result.confidence;
      return result;
    } catch (err) {
      this.failedCount++;
      throw err;
    }
  }

  createJob(input: OCRInput): OCRJob {
    const jobId = `ocr-${Date.now()}-${crypto.randomUUID().substring(0, 9)}`;
    const job: OCRJob = {
      jobId,
      status: 'pending',
      fileName: input.fileName,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);

    // Real asynchronous processing (no faked timers / canned results).
    void (async () => {
      job.status = 'processing';
      try {
        job.result = await this.processDocument(input);
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date().toISOString();
        logger.warn({ method: 'createJob', jobId, failed: job.error });
      }
    })();

    return job;
  }

  getJob(jobId: string): OCRJob | null {
    return this.jobs.get(jobId) || null;
  }

  getStats(): { processedCount: number; failedCount: number; activeJobs: number; averageConfidence: number } {
    const active = [...this.jobs.values()].filter(j => j.status === 'pending' || j.status === 'processing').length;
    return {
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      activeJobs: active,
      averageConfidence: this.processedCount > 0 ? Number((this.confidenceSum / this.processedCount).toFixed(4)) : 0,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async resolveInput(input: OCRInput): Promise<{ buffer: Buffer; mimeType: string }> {
    const raw = input.data ?? input.content;
    if (!raw) throw new Error('OCR input requires `data` (base64/data-URL) or `url`');

    if (input.type === 'url') {
      const response = await fetch(raw, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Failed to fetch document URL: HTTP ${response.status} ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const headerMime = response.headers.get('content-type')?.split(';')[0]?.trim();
      return { buffer, mimeType: headerMime || this.mimeFromName(input.fileName) };
    }

    const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(raw);
    if (dataUrl) return { buffer: Buffer.from(dataUrl[2], 'base64'), mimeType: dataUrl[1] };
    return { buffer: Buffer.from(raw, 'base64'), mimeType: input.fileType || this.mimeFromName(input.fileName) };
  }

  private mimeFromName(fileName: string): string {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'pdf': return 'application/pdf';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'tif':
      case 'tiff': return 'image/tiff';
      case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'doc': return 'application/msword';
      case 'txt': return 'text/plain';
      case 'md': return 'text/markdown';
      default: return 'application/octet-stream';
    }
  }

  private async extract(buffer: Buffer, mimeType: string, fileName: string): Promise<OCRProcessResult> {
    // Plain text — no OCR needed.
    if (mimeType.startsWith('text/')) {
      const text = buffer.toString('utf-8').trim();
      return {
        text,
        confidence: 1,
        pages: Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 300)),
        language: 'en',
        metadata: { fileName, mimeType, extractionMethod: 'plain-text', processedAt: new Date().toISOString() },
      };
    }

    // Word documents — real text extraction via mammoth.
    if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value || '').trim();
      if (!text) throw new Error(`No text could be extracted from ${fileName}`);
      return {
        text,
        confidence: 1,
        pages: Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 300)),
        language: 'en',
        metadata: { fileName, mimeType, extractionMethod: 'docx-parser', processedAt: new Date().toISOString() },
      };
    }

    // PDF / images — real OCR engine.
    const ocr = await nvOcrAdapterService.ocrDocument(buffer, mimeType, {});
    return {
      text: ocr.text,
      confidence: ocr.confidence,
      pages: ocr.pages.length || 1,
      language: ocr.language,
      metadata: {
        fileName,
        mimeType,
        provider: ocr.provider,
        model: ocr.model,
        extractionMethod: ocr.extractionMethod,
        confidenceSource: ocr.confidenceSource,
        costCategory: ocr.costCategory,
        processedAt: new Date().toISOString(),
      },
    };
  }
}

export const realOCRPipelineService = new RealOCRPipelineService();
