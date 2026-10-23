/**
 * NV-DOCPARSE-SDK-JOB-001 — async docparse jobs (Redis/BullMQ when live, else in-process).
 */
import crypto from 'node:crypto';
import type { DocparseJobRecord, DocparseJobSubmitRequest } from '@jurexio/docparse-sdk';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { enqueueDocparseSdk, isQueueLive, type DocparseSdkBullJob } from './queue/bullmq-queue.js';
import {
  loadDocparseSdkJobRecord,
  saveDocparseSdkJobRecord,
} from './jrx-docparse-sdk-job-store.js';
import { handleDocparseSdkJob } from './queue/jrx-docparse-sdk-worker.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-docparse-sdk-job');

function serializeFiles(req: DocparseJobSubmitRequest) {
  return req.files.map((f) => ({
    fileName: f.fileName,
    mime: f.mime,
    base64: Buffer.from(f.bytes).toString('base64'),
  }));
}

function buildBullPayload(
  jobId: string,
  createdAt: string,
  req: DocparseJobSubmitRequest,
): DocparseSdkBullJob {
  const domainPackId = req.domainPackId ?? req.run.domainPackId ?? 'legal-in';
  return {
    jobId,
    createdAt,
    domainPackId,
    run: {
      batchId: req.run.batchId,
      actor: req.run.actor,
      domainPackId: req.run.domainPackId ?? domainPackId,
      maxPagesPerDoc: req.run.maxPagesPerDoc,
      forceOcr: req.run.forceOcr,
      preferOcr: req.run.preferOcr,
    },
    files: serializeFiles(req),
  };
}

/** In-process runComplete + cloud OCR/Textract (same handler as BullMQ worker). */
async function submitDocparseSdkJobInProcess(req: DocparseJobSubmitRequest): Promise<string> {
  const jobId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const queued: DocparseJobRecord = {
    jobId,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
  };
  await saveDocparseSdkJobRecord(queued).catch((e) => {
    logger.warn('docparse job record save failed (in-process)', {
      jobId,
      err: e instanceof Error ? e.message : String(e),
    });
  });
  const payload = buildBullPayload(jobId, createdAt, req);
  queueMicrotask(() => {
    void handleDocparseSdkJob(payload).catch((e) => {
      logger.warn('docparse in-process job failed', {
        jobId,
        err: e instanceof Error ? e.message : String(e),
      });
    });
  });
  return jobId;
}

export async function submitDocparseSdkJob(req: DocparseJobSubmitRequest): Promise<string> {
  const useRedis = isJrxFeatureOn('docparseJobs') && isQueueLive();
  if (useRedis) {
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const domainPackId = req.domainPackId ?? req.run.domainPackId ?? 'legal-in';
    const queued: DocparseJobRecord = {
      jobId,
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
    };
    await saveDocparseSdkJobRecord(queued);
    const enq = await enqueueDocparseSdk(buildBullPayload(jobId, createdAt, req));
    if ('disabled' in enq && enq.disabled) {
      return submitDocparseSdkJobInProcess(req);
    }
    return jobId;
  }
  return submitDocparseSdkJobInProcess(req);
}

export async function getDocparseSdkJob(jobId: string): Promise<DocparseJobRecord | undefined> {
  const redisRec = await loadDocparseSdkJobRecord(jobId);
  if (redisRec) return redisRec;
  return undefined;
}
