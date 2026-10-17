/**
 * BullMQ worker — @jurexio/docparse-sdk legal ingest jobs (NV-DOCPARSE-JOBS-001).
 */
import type { DocparseJobRecord } from '@jurexio/docparse-sdk';
import { saveDocparseSdkJobRecord } from '../jrx-docparse-sdk-job-store.js';
import { createLogger } from '../../utils/logger.js';
import type { DocparseSdkBullJob } from './bullmq-queue.js';

const logger = createLogger('./jrx-docparse-sdk-worker');

export async function handleDocparseSdkJob(data: DocparseSdkBullJob): Promise<void> {
  const { jobId } = data;
  const now = () => new Date().toISOString();

  const running: DocparseJobRecord = {
    jobId,
    status: 'running',
    createdAt: data.createdAt,
    updatedAt: now(),
  };
  await saveDocparseSdkJobRecord(running);

  try {
    const { runComplete } = await import('@jurexio/docparse-sdk');
    const { createNyvPartialFieldRecoveryProvider } = await import('../jrx-docparse-partial-llm-sdk-provider.js');
    const { createNyvCloudOcrProvider } = await import('../jrx-docparse-cloud-ocr-sdk-provider.js');
    const files = data.files.map((f) => ({
      bytes: new Uint8Array(Buffer.from(f.base64, 'base64')),
      fileName: f.fileName,
      mime: f.mime,
    }));
    const completed = await runComplete(files, {
      ...data.run,
      partialFieldRecovery: createNyvPartialFieldRecoveryProvider(),
      cloudOcr: createNyvCloudOcrProvider(),
      onPage: async (detail) => {
        const rec: DocparseJobRecord = {
          jobId,
          status: 'running',
          createdAt: data.createdAt,
          updatedAt: now(),
          progress: {
            pageNo: detail.pageNo,
            pageTotal: detail.pageTotal,
            documentId: detail.documentId,
          },
        };
        await saveDocparseSdkJobRecord(rec);
      },
    });
    const result = completed.extraction;
    await saveDocparseSdkJobRecord({
      jobId,
      status: 'done',
      createdAt: data.createdAt,
      updatedAt: now(),
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('docparse-sdk job failed', { jobId, err: msg.slice(0, 200) });
    await saveDocparseSdkJobRecord({
      jobId,
      status: 'failed',
      createdAt: data.createdAt,
      updatedAt: now(),
      error: msg.slice(0, 500),
    });
    throw e;
  }
}
