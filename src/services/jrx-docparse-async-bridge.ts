/**
 * NV-DOCPARSE-ASYNC-BRIDGE-001 — route large binary ingest through BullMQ docparse-sdk
 * when JRX_F_DOCPARSE_JOBS=1 (production-doc-processor + adapter share this gate).
 */
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { getDocparseSdkJob, submitDocparseSdkJob } from './jrx-docparse-sdk-job-service.js';
import type { ExtractionResult } from '@jurexio/docparse-sdk';

const DEFAULT_MIN_BYTES = 4 * 1024 * 1024;
const POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;

export function docparseAsyncMinBytes(): number {
  const raw = Number(process.env.JRX_DOCPARSE_ASYNC_MIN_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_BYTES;
}

export function shouldUseAsyncDocparseJob(totalBytes: number): boolean {
  if (!isJrxFeatureOn('docparseJobs')) return false;
  return totalBytes >= docparseAsyncMinBytes();
}

export async function awaitDocparseSdkJobResult(
  jobId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExtractionResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rec = await getDocparseSdkJob(jobId);
    if (!rec) throw new Error(`Docparse job ${jobId} not found`);
    if (rec.status === 'done' && rec.result) return rec.result;
    if (rec.status === 'failed') {
      throw new Error(rec.error || `Docparse job ${jobId} failed`);
    }
    if (rec.status === 'cancelled') {
      throw new Error(`Docparse job ${jobId} was cancelled`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Docparse job ${jobId} timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export async function runDocparseSdkViaQueue(input: {
  files: Array<{ bytes: Buffer; fileName: string; mimeType?: string }>;
  batchId: string;
  actor: string;
  domainPackId?: string;
  forceOcr?: boolean;
  preferOcr?: boolean;
  maxPagesPerDoc?: number;
}): Promise<ExtractionResult> {
  const domainPackId = input.domainPackId ?? 'legal-in';
  const jobId = await submitDocparseSdkJob({
    files: input.files.map((f) => ({
      bytes: new Uint8Array(f.bytes),
      fileName: f.fileName,
      mime: f.mimeType,
    })),
    domainPackId,
    run: {
      batchId: input.batchId,
      actor: input.actor,
      domainPackId,
      maxPagesPerDoc: input.maxPagesPerDoc,
      forceOcr: input.forceOcr,
      preferOcr: input.preferOcr,
    },
  });
  return awaitDocparseSdkJobResult(jobId);
}
