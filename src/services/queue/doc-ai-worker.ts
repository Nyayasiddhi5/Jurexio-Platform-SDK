/**
 * doc-ai-worker.ts — BullMQ handler for jrx-doc-ai-convert.
 *
 * Task #130 (2026-05-11): the worker is intentionally pod-agnostic. It
 * resolves the job from the shared Redis ledger, materialises the source
 * blob from object storage to a local tmp file (streamed, never fully in
 * RSS), runs the converter, uploads the result blob, and stamps the
 * outcome back on the ledger. Any pod with the queue worker enabled can
 * pick up the work — survives the originating pod crashing, and the
 * polling pod doesn't need to be the same as the executing pod.
 *
 * Concurrency cap is enforced cluster-wide via
 * Queue.setGlobalConcurrency(JRX_DOC_AI_GLOBAL_CONCURRENCY) in
 * queue-workers.ts — not the per-worker BullMQ `concurrency` setting,
 * which only controls per-pod fetch parallelism.
 */

import type { DocAiConvertJob } from './bullmq-queue.js';
import {
  getJob,
  updateJob,
  getSourceToTempPath,
  putResultBytes,
  getPodId,
} from './doc-ai-job-store.js';
import { nvDocumentConverter, type SourceFormat, type TargetFormat, type ConversionOptions } from '../jrx-document-converter-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('doc-ai-worker');

// Worker runs in distributed-mode by definition (BullMQ leased the job
// to us). Use strict ledger ops so a Redis fault during the attempt
// cannot silently downgrade us to a pod-local update — that would leave
// the Redis ledger entry stuck at `running`/`queued` while another pod
// sees a `done` shadow that no other pod knows about. Strict throws on
// any Redis error → BullMQ counts the attempt + retries via the queue's
// exponential back-off, which is the correct behaviour.
const STRICT = { strict: true } as const;

export async function handleDocAiConvert(data: DocAiConvertJob, bullJob?: any): Promise<{ jobId: string; status: string }> {
  const { jobId } = data;
  const job = await getJob(jobId, STRICT);
  if (!job) {
    // Ledger TTL expired or never existed (e.g. enqueued before a Redis
    // wipe). Nothing to do — completing without error so BullMQ doesn't
    // retry forever against a phantom job.
    logger.warn('doc-ai job missing from ledger; dropping', { jobId });
    return { jobId, status: 'missing' };
  }
  // Idempotency: only `done` is unconditionally terminal. `failed` is
  // only written on the FINAL attempt below — so if we observe `failed`
  // here it's the result of a previous final attempt and we must not
  // redo the work. (Earlier attempts of the same job leave the status
  // as `queued` / `running` so retries can proceed.)
  if (job.status === 'done' || job.status === 'failed') {
    return { jobId, status: job.status };
  }

  // Decide retry stance up-front so the catch block knows whether to
  // mark the ledger `failed` (terminal) or leave it retry-able. BullMQ
  // surfaces 0-based attemptsMade BEFORE this attempt completes; the
  // current attempt is `attemptsMade + 1`. Default attempts come from
  // bullmq-queue.ts DEFAULT_JOB_OPTIONS.
  const attemptsMade: number = Number(bullJob?.attemptsMade ?? 0);
  const maxAttempts: number = Number(bullJob?.opts?.attempts ?? 5);
  const isFinalAttempt = attemptsMade + 1 >= maxAttempts;

  const podId = getPodId();
  await updateJob(jobId, { status: 'running', startedAt: new Date().toISOString(), executedByPod: podId }, STRICT);

  let cleanupSrc: (() => Promise<void>) | null = null;
  try {
    const staged = await getSourceToTempPath(jobId);
    cleanupSrc = staged.cleanup;

    let options: ConversionOptions | undefined;
    if (job.optionsJson) {
      try { options = JSON.parse(job.optionsJson) as ConversionOptions; } catch { /* tolerate */ }
    }

    const result = await nvDocumentConverter.convert({
      sourcePath: staged.path,
      sourceFormat: job.sourceFormat as SourceFormat,
      targetFormat: job.targetFormat as TargetFormat,
      options,
    });

    if (!result.success || !result.outputBuffer) {
      // Treat as throwable so retry semantics in the catch block apply
      // uniformly (don't permanently mark `failed` until final attempt).
      throw new Error(result.error || 'conversion produced no output');
    }

    await putResultBytes(jobId, result.outputBuffer);
    await updateJob(jobId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      bytesOut: result.sizeBytes,
      mimeType: result.mimeType,
      fileName: result.fileName,
      conversionMs: result.conversionMs,
    }, STRICT);
    return { jobId, status: 'done' };
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('doc-ai conversion attempt failed', {
      jobId, attempt: attemptsMade + 1, maxAttempts, isFinalAttempt, err: msg,
    });
    // Stamp the ledger best-effort: if the strict update itself fails
    // (Redis fault again) we still want to throw the original conversion
    // error to BullMQ so the attempt counts. Wrapping in its own try/catch
    // prevents the ledger update from masking the original error.
    try {
      if (isFinalAttempt) {
        // Terminal: stamp `failed` so the idempotency guard returns
        // immediately if BullMQ leases this job again, and so polls see
        // a real error.
        await updateJob(jobId, {
          status: 'failed',
          error: msg,
          completedAt: new Date().toISOString(),
        }, STRICT);
      } else {
        // Transient: leave the ledger retry-able. Reset to `queued` so
        // the next attempt's `running` transition is a real transition,
        // and record the most recent error (clears on success).
        await updateJob(jobId, {
          status: 'queued',
          error: msg,
          startedAt: undefined,
        }, STRICT);
      }
    } catch (ledgerErr: any) {
      logger.error('doc-ai ledger update failed in catch path', { jobId, err: ledgerErr?.message });
    }
    // Re-throw so BullMQ counts the attempt — retries are governed by the
    // queue's defaultJobOptions (5 attempts, exponential back-off).
    throw e;
  } finally {
    if (cleanupSrc) await cleanupSrc();
  }
}
