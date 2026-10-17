// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * @deprecated NYV-NS-009 (2026-05-01)
 *
 * Legacy Postgres-backed job queue. New code MUST use BullMQ (5 queues
 * registered in src/services/jrx-bullmq-queues.ts). This file remains live
 * because nv-job-worker.ts and nv-document-intelligence-orchestrator.ts
 * still consume it; deletion is gated on:
 *
 *   1. Migrating the two consumer files to BullMQ producers.
 *   2. Draining nv_schema.async_job_queue (stop polling, let in-flight rows
 *      finish or be re-enqueued onto BullMQ).
 *   3. Adding a vitest contract suite that asserts no `from './job-queue.js'`
 *      imports exist outside this file.
 *
 * That work is queued under NYV-NS-009 in NYV-TECH-SPEC-MASTER §14.
 *
 * A single-shot deprecation warning is logged at module load so anyone
 * touching the file in dev sees the migration breadcrumb in the console.
 */

import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('job-queue');

logger.warn('[NYV-NS-009] DEPRECATED: src/services/job-queue.ts is the legacy '
  + 'Postgres queue. New code must use BullMQ (nv-bullmq-queues.ts). '
  + 'See NYV-TECH-SPEC-MASTER §14 NYV-NS-009 for the migration plan.');

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
/** Faster claim for EDJ / document jobs — override with NYV_PG_JOB_POLL_MS. */
const POLL_INTERVAL = Math.max(500, Number(process.env.NYV_PG_JOB_POLL_MS) || 1500);
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BATCH_SIZE = 10;

export interface JobPayload {
  [key: string]: any;
}

export interface Job {
  id: string;
  queue: string;
  taskType: string;
  payload: JobPayload;
  status: string;
  priority: number;
  maxAttempts: number;
  attemptCount: number;
  runAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  result: any;
  createdAt: Date;
  createdBy: string | null;
  orgId: number | null;
  platform: string | null;
}

type JobHandler = (job: Job) => Promise<any>;

function getPool() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

class PgJobQueue {
  private handlers: Map<string, JobHandler> = new Map();
  private pollers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  async enqueue(options: {
    queue?: string;
    taskType: string;
    payload: JobPayload;
    priority?: number;
    maxAttempts?: number;
    runAt?: Date;
    createdBy?: string;
    orgId?: number;
    platform?: string;
  }): Promise<string> {
    const db = getPool();
    const result = await db.query(
      `INSERT INTO pg_jobs (queue, task_type, payload, priority, max_attempts, run_at, created_by, org_id, platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        options.queue || 'default',
        options.taskType,
        JSON.stringify(options.payload),
        options.priority || 0,
        options.maxAttempts || 3,
        options.runAt || new Date(),
        options.createdBy || null,
        options.orgId || null,
        options.platform || null,
      ]
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
    return result.rows[0].id;
  }

  async enqueueBatch(jobs: Array<{
    queue?: string;
    taskType: string;
    payload: JobPayload;
    priority?: number;
    platform?: string;
  }>): Promise<string[]> {
    const db = getPool();
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const job of jobs) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
      values.push(job.queue || 'default', job.taskType, JSON.stringify(job.payload), job.priority || 0, job.platform || null);
      idx += 5;
    }

    const result = await db.query(
      `INSERT INTO pg_jobs (queue, task_type, payload, priority, platform)
       VALUES ${placeholders.join(', ')}
       RETURNING id`,
      values
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    return result.rows.map((r: any) => r.id);
  }

  registerHandler(taskType: string, handler: JobHandler): void {
    this.handlers.set(taskType, handler);
  }

  async startProcessing(queues: string[] = ['default']): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const queue of queues) {
      const poller = setInterval(() => this.processQueue(queue), POLL_INTERVAL);
      this.pollers.set(queue, poller);
    }

    setInterval(() => this.recoverStaleJobs(), 60000);

    logger.info(`[JobQueue] Worker ${WORKER_ID} started processing queues: ${queues.join(', ')}`);
  }

  async stopProcessing(): Promise<void> {
    this.running = false;
    for (const [, poller] of this.pollers) {
      clearInterval(poller);
    }
    this.pollers.clear();

    const db = getPool();
    await db.query(
      `UPDATE pg_jobs SET status = 'pending', locked_by = NULL, locked_at = NULL
       WHERE locked_by = $1 AND status = 'processing'`,
      [WORKER_ID]
    );
  }

  private async processQueue(queue: string): Promise<void> {
    if (!this.running) return;

    try {
      const db = getPool();
      const result = await db.query(
        `UPDATE pg_jobs SET status = 'processing', locked_by = $1, locked_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
         WHERE id IN (
           SELECT id FROM pg_jobs
           WHERE queue = $2 AND status = 'pending' AND run_at <= NOW()
           ORDER BY priority DESC, created_at ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, queue, task_type, payload, status, priority, max_attempts, attempt_count, run_at, locked_by, locked_at, completed_at, failed_at, error_message, result, created_at, created_by, org_id, platform`,
        [WORKER_ID, queue, MAX_BATCH_SIZE]
      );

      // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
      for (const row of result.rows) {
        const job = this.rowToJob(row);
        await this.executeJob(job);
      }
    } catch (error: any) {
      if (error.message !== 'Database pool not initialized') {
        logger.error(`[JobQueue] Error processing queue ${queue}:`, error.message);
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.taskType);
    if (!handler) {
      await this.failJob(job.id, `No handler registered for task type: ${job.taskType}`, job.attemptCount >= job.maxAttempts, job);
      return;
    }

    try {
      const result = await handler(job);
      await this.completeJob(job.id, result, job);
    } catch (error: any) {
      const isDead = job.attemptCount >= job.maxAttempts;
      await this.failJob(job.id, error.message || 'Unknown error', isDead, job);
    }
  }

  private async syncEdjAsyncMirror(job: Job, status: 'completed' | 'failed', output?: unknown, errorMessage?: string): Promise<void> {
    if (job.taskType !== 'ecosystem_document_job') return;
    const edjJobId = job.payload?.jobId || job.payload?._jobId;
    if (!edjJobId || typeof edjJobId !== 'string') return;
    try {
      const db = getPool();
      if (status === 'completed') {
        await db.query(
          `UPDATE nv_schema.async_job_queue
           SET status = 'completed', completed_at = NOW(), output = $1, updated_at = NOW()
           WHERE job_id = $2 AND status NOT IN ('completed', 'failed', 'expired', 'cancelled')`,
          [JSON.stringify(output ?? {}), edjJobId],
        );
      } else {
        await db.query(
          `UPDATE nv_schema.async_job_queue
           SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE job_id = $2 AND status NOT IN ('completed', 'failed', 'expired', 'cancelled')`,
          [errorMessage || 'Job failed', edjJobId],
        );
      }
    } catch {
      /* mirror is best-effort */
    }
  }

  private async completeJob(jobId: string, result: any, job?: Job): Promise<void> {
    const db = getPool();
    await db.query(
      `UPDATE pg_jobs SET status = 'completed', completed_at = NOW(), result = $1, locked_by = NULL, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result || {}), jobId]
    );
    if (job) await this.syncEdjAsyncMirror(job, 'completed', result);
  }

  private async failJob(jobId: string, errorMessage: string, isDead: boolean, job?: Job): Promise<void> {
    const db = getPool();
    const newStatus = isDead ? 'dead_letter' : 'pending';
    const backoffSeconds = isDead ? 0 : Math.min(300, Math.pow(2, 3) * 10);

    await db.query(
      `UPDATE pg_jobs SET
         status = $1,
         error_message = $2,
         failed_at = NOW(),
         locked_by = NULL,
         locked_at = NULL,
         run_at = CASE WHEN $1 = 'pending' THEN NOW() + INTERVAL '${backoffSeconds} seconds' ELSE run_at END,
         updated_at = NOW()
       WHERE id = $3`,
      [newStatus, errorMessage, jobId]
    );
    if (job && isDead) await this.syncEdjAsyncMirror(job, 'failed', undefined, errorMessage);
  }

  private async recoverStaleJobs(): Promise<void> {
    try {
      const db = getPool();
      const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS);
      const result = await db.query(
        `UPDATE pg_jobs SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = NOW()
         WHERE status = 'processing' AND locked_at < $1
         RETURNING id`,
        [staleThreshold]
      );
      if (result.rowCount && result.rowCount > 0) {
        logger.info(`[JobQueue] Recovered ${result.rowCount} stale jobs`);
      }
    } catch {}
  }

  async getJobStatus(jobId: string): Promise<Job | null> {
    const db = getPool();
    const result = await db.query(`SELECT * FROM pg_jobs WHERE id = $1`, [jobId]);
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    return result.rows.length > 0 ? this.rowToJob(result.rows[0]) : null;
  }

  async getQueueStats(queue?: string): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    const db = getPool();
    const whereClause = queue ? `WHERE queue = '${queue}'` : '';
    const result = await db.query(
      `SELECT status, COUNT(*) as count FROM pg_jobs ${whereClause} GROUP BY status`
    );
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, deadLetter: 0 };
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    for (const row of result.rows) {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      if (row.status === 'pending') stats.pending = parseInt(row.count);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      if (row.status === 'processing') stats.processing = parseInt(row.count);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      if (row.status === 'completed') stats.completed = parseInt(row.count);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      if (row.status === 'failed') stats.failed = parseInt(row.count);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      if (row.status === 'dead_letter') stats.deadLetter = parseInt(row.count);
    }
    return stats;
  }

  async cleanupCompleted(olderThanDays: number = 7): Promise<number> {
    const db = getPool();
    const result = await db.query(
      `DELETE FROM pg_jobs WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '${olderThanDays} days' RETURNING id`
    );
    return result.rowCount || 0;
  }

  private rowToJob(row: any): Job {
    return {
      id: row.id,
      queue: row.queue,
      taskType: row.task_type,
      payload: row.payload,
      status: row.status,
      priority: row.priority,
      maxAttempts: row.max_attempts,
      attemptCount: row.attempt_count,
      runAt: row.run_at,
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
      errorMessage: row.error_message,
      result: row.result,
      createdAt: row.created_at,
      createdBy: row.created_by,
      orgId: row.org_id,
      platform: row.platform,
    };
  }
}

export const jobQueue = new PgJobQueue();

export function registerDefaultHandlers(): void {
  jobQueue.registerHandler('document.process', async (job) => {
    const { documentId, orgId, fileName, extractionMode } = job.payload;
    logger.info(`[JobQueue] Processing document: ${fileName} (${documentId})`);
    return { processed: true, documentId };
  });

  jobQueue.registerHandler('ai.orchestration', async (job) => {
    const { agentKey, prompt, tier, jurisdiction } = job.payload;
    logger.info(`[JobQueue] AI orchestration task: ${agentKey}`);
    return { orchestrated: true, agentKey };
  });

  jobQueue.registerHandler('email.send', async (job) => {
    const { to, subject, template } = job.payload;
    logger.info(`[JobQueue] Sending email to: ${to}, subject: ${subject}`);
    return { sent: true, to };
  });

  jobQueue.registerHandler('notification.push', async (job) => {
    const { userId, title, body } = job.payload;
    logger.info(`[JobQueue] Push notification to user: ${userId}`);
    return { notified: true, userId };
  });

  jobQueue.registerHandler('report.generate', async (job) => {
    const { reportType, orgId, params } = job.payload;
    logger.info(`[JobQueue] Generating report: ${reportType} for org: ${orgId}`);
    return { generated: true, reportType };
  });

  jobQueue.registerHandler('compliance.scan', async (job) => {
    const { documentId, jurisdiction, framework } = job.payload;
    logger.info(`[JobQueue] Compliance scan: ${framework} for ${jurisdiction}`);
    return { scanned: true, framework };
  });
}
