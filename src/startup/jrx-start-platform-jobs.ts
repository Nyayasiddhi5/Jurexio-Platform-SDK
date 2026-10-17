/**
 * NV-PLATFORM-JOBS-001 — unified background worker bootstrap (v5.0.0).
 * Called from index.ts after database + Redis are ready.
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('platform-jobs');

export interface PlatformJobsHandle {
  stop: () => Promise<void>;
  status: () => Record<string, 'running' | 'disabled' | 'skipped'>;
}

let _status: Record<string, 'running' | 'disabled' | 'skipped'> = {};
let _bullmqStop: (() => Promise<void>) | null = null;
let _hitlSlaStop: (() => void) | null = null;
let _retentionStop: (() => void) | null = null;
let _legalIntelStop: (() => void) | null = null;
let _grpoExportStop: (() => void) | null = null;

function pgWorkerEnabled(): boolean {
  const v = String(process.env.JRX_PG_JOB_WORKER ?? 'on').toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

function docProcessorEnabled(): boolean {
  const v = String(process.env.JRX_DOC_PROCESSOR_ENABLED ?? 'on').toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

/**
 * Start Postgres queue, BullMQ, legacy doc poller, and governance timers.
 * Must run after initializeDatabase() (and ideally after Redis connect).
 */
export async function startPlatformJobs(): Promise<PlatformJobsHandle> {
  _status = {};

  if (pgWorkerEnabled()) {
    try {
      const { startNvJobWorker } = await import('../services/jrx-job-worker.js');
      await startNvJobWorker();
      _status.pgJobQueue = 'running';
      logger.info('platform_jobs_pg_worker_started');
    } catch (e: unknown) {
      _status.pgJobQueue = 'skipped';
      logger.error('platform_jobs_pg_worker_failed', { err: e instanceof Error ? e.message : String(e) });
    }
  } else {
    _status.pgJobQueue = 'disabled';
  }

  if (docProcessorEnabled()) {
    try {
      const { startJobPoller } = await import('../services/document-pipeline/production-doc-processor.js');
      const interval = Number(process.env.JRX_DOC_POLL_INTERVAL_MS ?? 3000);
      await startJobPoller(interval);
      _status.nsDocProcessor = 'running';
    } catch (e: unknown) {
      _status.nsDocProcessor = 'skipped';
      logger.warn('platform_jobs_doc_processor_skipped', { err: e instanceof Error ? e.message : String(e) });
    }
  } else {
    _status.nsDocProcessor = 'disabled';
  }

  if (process.env.JRX_QUEUE_WORKERS !== 'off') {
    try {
      const { startQueueWorkers } = await import('../services/queue/queue-workers.js');
      const { stop } = await startQueueWorkers();
      _bullmqStop = stop;
      _status.bullmq = 'running';
      try {
        const { startSdkWebhookListener } = await import('../services/sdk/sdk-webhook-listener.js');
        startSdkWebhookListener();
        _status.sdkWebhookListener = 'running';
      } catch (e: unknown) {
        _status.sdkWebhookListener = 'skipped';
        logger.error('platform_jobs_webhook_listener_failed', { err: e instanceof Error ? e.message : String(e) });
      }
    } catch (e: unknown) {
      _status.bullmq = 'skipped';
      logger.error('platform_jobs_bullmq_failed', { err: e instanceof Error ? e.message : String(e) });
    }
  } else {
    _status.bullmq = 'disabled';
    _status.sdkWebhookListener = 'disabled';
  }

  if (process.env.JRX_HITL_SLA_TIMER !== 'off') {
    try {
      const { startHitlSlaTimer } = await import('../services/jrx-hitl-sla-timer.js');
      _hitlSlaStop = startHitlSlaTimer().stop;
      _status.hitlSla = 'running';
    } catch (e: unknown) {
      _status.hitlSla = 'skipped';
      logger.error('platform_jobs_hitl_sla_failed', { err: e instanceof Error ? e.message : String(e) });
    }
  } else {
    _status.hitlSla = 'disabled';
  }

  /*
   * NV-GRAPH-MEMORY-DURABLE-001 — rebuild the graph tier from Postgres at boot.
   *
   * Without this the write-through in `graph-memory-service` would only help future
   * restarts: the process would still start with an empty graph and answer as if the user
   * had never spoken to us. Bounded and awaited-but-non-fatal — a failed hydrate degrades
   * memory breadth, it must never stop the platform from booting.
   */
  try {
    const { graphMemoryService } = await import('../services/memory/graph-memory-service.js');
    const n = await graphMemoryService.hydrateFromDb();
    /* `_status` is a fixed three-literal union; the node count belongs in the log, not in a
     * status field whose type would have to be widened for every caller. */
    _status.graphMemoryHydrate = n > 0 ? 'running' : 'skipped';
    logger.info('platform_jobs_graph_memory_hydrated', { nodes: n });
  } catch (e: unknown) {
    _status.graphMemoryHydrate = 'skipped';
    logger.error('platform_jobs_graph_memory_hydrate_failed', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const { startRetentionSweep } = await import('../services/jrx-retention-service.js');
    _retentionStop = startRetentionSweep().stop;
    _status.retention = 'running';
  } catch (e: unknown) {
    _status.retention = 'skipped';
    logger.error('platform_jobs_retention_failed', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const { startLegalIntelligenceFeedScheduler } = await import('../services/jrx-legal-intelligence-feed-service.js');
    _legalIntelStop = startLegalIntelligenceFeedScheduler().stop;
    _status.legalIntelFeed = 'running';
  } catch (e: unknown) {
    _status.legalIntelFeed = 'skipped';
    logger.error('platform_jobs_legal_intel_failed', { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const { startGrpoNightlyExport } = await import('../services/jrx-grpo-nightly-export-scheduler.js');
    _grpoExportStop = startGrpoNightlyExport().stop;
    _status.grpoNightlyExport = process.env.JRX_GRPO_NIGHTLY_EXPORT === 'off' ? 'disabled' : 'running';
  } catch (e: unknown) {
    _status.grpoNightlyExport = 'skipped';
    logger.warn('platform_jobs_grpo_export_skipped', { err: e instanceof Error ? e.message : String(e) });
  }

  logger.info('platform_jobs_started', { status: _status });

  return {
    status: () => ({ ..._status }),
    stop: async () => {
      try { if (_bullmqStop) await _bullmqStop(); } catch { /* swallow */ }
      try { if (_hitlSlaStop) _hitlSlaStop(); } catch { /* swallow */ }
      try { if (_retentionStop) _retentionStop(); } catch { /* swallow */ }
      try { if (_legalIntelStop) _legalIntelStop(); } catch { /* swallow */ }
      try { if (_grpoExportStop) _grpoExportStop(); } catch { /* swallow */ }
      try {
        const { jobQueue } = await import('../services/jrx-job-worker.js');
        await jobQueue.stopProcessing();
      } catch { /* swallow */ }
    },
  };
}
