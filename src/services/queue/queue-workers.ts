/**
 * Worker bootstrapper — wires every queue handler to its consumer.
 *
 * Called once at startup from src/index.ts (gated by JRX_QUEUE_WORKERS env).
 * Returns a stop() handle so we can drain on SIGTERM cleanly.
 */

import {
  QueueNames,
  registerWorker,
  shutdownWorkers,
  enqueuePqcSign,
  isQueueLive,
  getQueueDisabledReason,
  type WebhookDeliveryJob,
  type DocParseJob,
  type DocparseSdkBullJob,
  type DocSummarizeJob,
  type PlatformRelayJob,
  type PqcSignJob,
  type DocAiConvertJob,
  type EcosystemDocJobPayload,
  getQueue,
} from './bullmq-queue.js';
import { handleWebhookDelivery } from './webhook-dispatcher.js';
import { handleDocParse, handleDocSummarize } from './document-jobs.js';
import { handleDocparseSdkJob } from './jrx-docparse-sdk-worker.js';
import { handlePlatformRelay } from './platform-relay.js';
import { handleDocAiConvert } from './doc-ai-worker.js';
import { sweepExpiredBlobs } from './doc-ai-job-store.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('queue-workers');

export async function startQueueWorkers(): Promise<{ stop: () => Promise<void> }> {
  // JRX-OPS-WORKERS-DISABLE-001 (Task #28 round 6): use isQueueLive()
  // (runtime-aware) instead of the boot-time isQueueEnabled flag, so
  // workers are also skipped if the connection was disabled mid-flight
  // by a runtime WRONGPASS/NOAUTH trip — not just at boot. Without
  // this, registerWorker() calls would bring up a doomed worker that
  // immediately fails getQueueConnection() and emits noisy errors.
  // task-133: the doc-ai blob sweeper is independent of BullMQ — it runs
  // on a plain timer and self-heals object-storage / local-disk blobs
  // whose ledger entry has expired. Start it BEFORE the queue-live gate
  // so it works in dev (no Redis) too. The interval is best-effort and
  // the sweep itself logs / records stats on `getLastSweepStats()`.
  const sweeperHandle = startDocAiSweeper();

  if (!isQueueLive()) {
    logger.info('BullMQ workers skipped — queue disabled', {
      reason: getQueueDisabledReason() ?? 'no valid Redis TCP URL',
    });
    return {
      stop: async () => {
        sweeperHandle.stop();
      },
    };
  }
  // 1. Webhook delivery
  registerWorker<WebhookDeliveryJob>({
    name: QueueNames.WEBHOOK_DELIVERY,
    dlq: QueueNames.WEBHOOK_DLQ,
    concurrency: Number(process.env.JRX_WORKER_WEBHOOK_CONCURRENCY ?? 10),
    handler: (data) => handleWebhookDelivery(data),
  });

  // 2. Document parse (CPU/IO heavy — moderate concurrency)
  registerWorker<DocParseJob>({
    name: QueueNames.DOC_PARSE,
    dlq: QueueNames.DOC_PARSE_DLQ,
    concurrency: Number(process.env.JRX_WORKER_DOC_PARSE_CONCURRENCY ?? 4),
    handler: (data, job) => handleDocParse(data, job),
  });

  registerWorker<DocparseSdkBullJob>({
    name: QueueNames.DOCPARSE_SDK,
    dlq: QueueNames.DOCPARSE_SDK_DLQ,
    concurrency: Number(process.env.JRX_WORKER_DOCPARSE_SDK_CONCURRENCY ?? 3),
    handler: (data) => handleDocparseSdkJob(data),
  });

  // 3. Summarisation (LLM heavy — back off concurrency to respect provider rate)
  registerWorker<DocSummarizeJob>({
    name: QueueNames.DOC_SUMMARIZE,
    dlq: QueueNames.DOC_SUMMARIZE_DLQ,
    concurrency: Number(process.env.JRX_WORKER_DOC_SUMMARIZE_CONCURRENCY ?? 3),
    handler: (data, job) => handleDocSummarize(data, job),
  });

  // 4. Platform relay
  registerWorker<PlatformRelayJob>({
    name: QueueNames.PLATFORM_RELAY,
    dlq: QueueNames.PLATFORM_RELAY_DLQ,
    concurrency: Number(process.env.JRX_WORKER_PLATFORM_RELAY_CONCURRENCY ?? 8),
    handler: (data) => handlePlatformRelay(data),
  });

  // 4b. Doc-AI convert (Task #130) — durable, cross-pod doc conversion.
  //
  // Concurrency model (cluster-wide):
  //   - JRX_DOC_AI_GLOBAL_CONCURRENCY  → BullMQ Queue.setGlobalConcurrency,
  //                                       enforced by the broker across ALL
  //                                       worker pods. THIS is the real
  //                                       global cap (replaces the old
  //                                       per-pod JRX_DOC_CONVERT_CONCURRENCY
  //                                       × pod count problem).
  //   - JRX_WORKER_DOC_AI_CONVERT_CONCURRENCY → per-worker fetch parallelism,
  //                                       defaults to the global cap so a
  //                                       single pod can saturate it. With
  //                                       multiple pods, the queue-level
  //                                       cap dominates regardless of how
  //                                       many fetches a worker keeps open.
  const docAiGlobal = Number(process.env.JRX_DOC_AI_GLOBAL_CONCURRENCY ?? 4);
  const docAiPerWorker = Number(process.env.JRX_WORKER_DOC_AI_CONVERT_CONCURRENCY ?? docAiGlobal);
  registerWorker<DocAiConvertJob>({
    name: QueueNames.DOC_AI_CONVERT,
    dlq: QueueNames.DOC_AI_CONVERT_DLQ,
    concurrency: docAiPerWorker,
    handler: (data, job) => handleDocAiConvert(data, job),
  });
  // Apply the cluster-wide cap. This is best-effort — if the broker
  // rejects (very old Redis without the script support BullMQ relies on),
  // we fall back to per-worker concurrency only, which is at least no
  // worse than the legacy in-process behaviour.
  try {
    const docAiQueue = getQueue(QueueNames.DOC_AI_CONVERT);
    if (docAiQueue && Number.isFinite(docAiGlobal) && docAiGlobal > 0) {
      await docAiQueue.setGlobalConcurrency(docAiGlobal);
      logger.info('doc-ai-convert global concurrency set', { globalConcurrency: docAiGlobal, perWorker: docAiPerWorker });
    }
  } catch (e: any) {
    logger.warn('failed to apply doc-ai-convert global concurrency', { err: e?.message });
  }

  // 5. PQC signing (CPU heavy when oqs is real; ok to parallelise modestly)
  registerWorker<PqcSignJob>({
    name: QueueNames.PQC_SIGN,
    dlq: QueueNames.PQC_SIGN_DLQ,
    concurrency: Number(process.env.JRX_WORKER_PQC_SIGN_CONCURRENCY ?? 4),
    handler: async (data) => {
      const { signArtifact } = await import('../security/jrx-pqc-service.js');
      // Scope keys per platform+artifact-class so a memory dump cannot expose
      // every platform's signing material at once.
      const scope = `${data.platform}:${data.algorithm ?? 'ML-DSA-65'}`;
      return await signArtifact(data.payloadHash, data.algorithm, scope);
    },
  });

  // 6. Orchestration / LLM failure retry (timeouts, network, provider 503)
  registerWorker({
    name: QueueNames.ORCH_RETRY,
    dlq: QueueNames.ORCH_RETRY_DLQ,
    concurrency: Number(process.env.JRX_WORKER_ORCH_RETRY_CONCURRENCY ?? 3),
    handler: async (data) => {
      const { handleOrchestrationRetry } = await import('./orch-retry-queue.js');
      return handleOrchestrationRetry(data as any);
    },
  });

  // 7. Ecosystem Document Job (EDJ) — BullMQ primary; PG queue is fallback only
  registerWorker<EcosystemDocJobPayload>({
    name: QueueNames.ECOSYSTEM_DOC_JOB,
    dlq: QueueNames.ECOSYSTEM_DOC_JOB_DLQ,
    concurrency: Number(process.env.JRX_WORKER_EDJ_CONCURRENCY ?? 2),
    handler: async (data) => {
      const {
        processEcosystemDocumentJob,
        failEcosystemDocumentJob,
        getEcosystemDocumentJobRow,
        EdjProcessingError,
      } = await import('../jrx-ecosystem-document-job-service.js');
      const jobId = String(data.jobId || '');
      if (!jobId) throw new Error('EDJ BullMQ job missing jobId');
      const row = await getEcosystemDocumentJobRow(jobId);
      const ledgerInput = (row?.input ?? row?.payload) as Record<string, unknown> | undefined;
      const payload = {
        ...(ledgerInput || {}),
        ...data,
        jobId,
      };
      try {
        return await processEcosystemDocumentJob(payload as any);
      } catch (err: any) {
        if (err instanceof EdjProcessingError || err?.name === 'EdjProcessingError') {
          await failEcosystemDocumentJob(payload as any, err);
        }
        throw err;
      }
    },
  });

  logger.info('all queue workers started', { queues: Object.values(QueueNames) });

  // Re-export the enqueue helper for PQC so callers do not need to import the queue file directly.
  (globalThis as any).__nyvEnqueuePqcSign = enqueuePqcSign;

  return {
    stop: async () => {
      logger.info('draining workers...');
      sweeperHandle.stop();
      await shutdownWorkers();
      logger.info('workers stopped');
    },
  };
}

/**
 * task-133: periodic doc-ai blob sweeper. Runs once at startup (after a
 * short delay so the boot path stays unblocked) and then on a fixed
 * interval. Single-pod execution is fine — the sweep is idempotent
 * (checks ledger before deleting, skips young blobs by age gate) so even
 * if every pod ran it concurrently the worst outcome is duplicated
 * delete() calls against already-gone keys.
 */
function startDocAiSweeper(): { stop: () => void } {
  const enabled = (process.env.JRX_DOC_AI_SWEEPER_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    logger.info('doc-ai blob sweeper disabled via JRX_DOC_AI_SWEEPER_ENABLED=false');
    return { stop: () => {} };
  }
  const intervalMs = Math.max(
    60_000,
    Number.parseInt(process.env.JRX_DOC_AI_SWEEP_INTERVAL_SEC ?? '3600', 10) * 1000 || 3_600_000,
  );
  const initialDelayMs = Math.max(
    1_000,
    Number.parseInt(process.env.JRX_DOC_AI_SWEEP_INITIAL_DELAY_SEC ?? '60', 10) * 1000 || 60_000,
  );

  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    sweepExpiredBlobs().catch((e) => {
      logger.warn('doc-ai blob sweeper tick failed', { err: e?.message });
    });
  };
  // First run is delayed so we don't pile work onto a cold start.
  const initial = setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }, initialDelayMs);
  if (typeof initial.unref === 'function') initial.unref();
  logger.info('doc-ai blob sweeper scheduled', { intervalMs, initialDelayMs });
  return {
    stop: () => {
      clearTimeout(initial);
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
