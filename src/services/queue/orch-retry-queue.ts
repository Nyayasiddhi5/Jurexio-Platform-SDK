/**
 * NV-ORCH-RETRY-001 — Durable retry queue for failed orchestration / LLM calls.
 *
 * When /orchestrate hits a provider timeout, network error, or AI_SERVICE_UNAVAILABLE,
 * the request payload is enqueued here. BullMQ retries with exponential backoff;
 * permanent failures land in ORCH_RETRY_DLQ for operator review.
 *
 * Fail-soft: if Redis/BullMQ is down, we still write an audit row to
 * nv_schema.async_job_queue so nothing is silently lost.
 */
import { sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import { db as _raw_db } from '../../db/index.js';
import { enqueueOrchRetry } from './bullmq-queue.js';

const logger = createLogger('orch-retry-queue');
const db = lazyRequire(() => _raw_db, 'db');

export interface OrchRetryJob {
  requestId: string;
  prompt: string;
  jurisdiction?: string;
  tier?: string;
  tenantId?: string;
  userId?: string;
  agentKey?: string;
  enableCoT?: boolean;
  enableRAG?: boolean;
  enableMemory?: boolean;
  failureReason: string;
  failedAt: string;
  attempt?: number;
}

async function mirrorAsyncJob(job: OrchRetryJob, status: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO nv_schema.async_job_queue (job_id, job_type, status, input, user_id, priority, created_at, error_message)
      VALUES (
        ${`orch_retry_${job.requestId}`},
        'orchestration_retry',
        ${status},
        ${JSON.stringify(job)},
        ${job.userId ?? 'system'},
        'high',
        NOW(),
        ${job.failureReason}
      )
      ON CONFLICT (job_id) DO UPDATE SET
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        updated_at = NOW()
    `);
  } catch (err: unknown) {
    // Table may lack ON CONFLICT target — best-effort insert only
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.async_job_queue (job_id, job_type, status, input, user_id, priority, created_at, error_message)
        VALUES (
          ${`orch_retry_${job.requestId}_${Date.now()}`},
          'orchestration_retry',
          ${status},
          ${JSON.stringify(job)},
          ${job.userId ?? 'system'},
          'high',
          NOW(),
          ${job.failureReason}
        )
      `);
    } catch (e2: unknown) {
      logger.warn('orch_retry_mirror_failed', { err: e2 instanceof Error ? e2.message : String(e2) });
    }
  }
}

/**
 * Enqueue a failed orchestration for background retry.
 * Returns the BullMQ job id when queued, or null when only audit-mirrored.
 */
export async function enqueueOrchestrationRetry(job: OrchRetryJob): Promise<string | null> {
  await mirrorAsyncJob(job, 'queued');

  try {
    const added = await enqueueOrchRetry(job);
    const bullId = (added as { id?: string })?.id;
    logger.info('orch_retry_enqueued', { requestId: job.requestId, bullId, reason: job.failureReason });
    return bullId ? String(bullId) : null;
  } catch (err: unknown) {
    logger.warn('orch_retry_enqueue_bullmq_failed', {
      requestId: job.requestId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function handleOrchestrationRetry(job: OrchRetryJob): Promise<{ ok: boolean; contentLength?: number }> {
  const { executeWithFullSafetyRing } = await import('../../orchestration/jrx-sdk-orchestration-wrapper.js');
  const result = await executeWithFullSafetyRing(
    {
      id: job.requestId,
      userId: String(job.userId || 'anon'),
      prompt: job.prompt,
      systemPrompt: 'You are a precise legal AI assistant. Provide accurate, well-cited responses.',
      maxTokens: 2048,
      timestamp: new Date(),
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional',
      },
      fallbackLevels: 3,
    },
    {
      sdkPlatform: './jrx-orch-retry',
      ctx: { tenantId: job.tenantId, userId: job.userId },
      agentKey: job.agentKey || 'auto',
      jurisdiction: job.jurisdiction || 'IN',
      tier: job.tier || 'pro',
      enableRAG: job.enableRAG !== false,
      enableMemory: !!job.enableMemory,
      enableCoT: !!job.enableCoT,
    },
  );

  if ((result as any).model === 'error' || (result as any).providerError) {
    await mirrorAsyncJob(job, 'failed');
    throw new Error((result as any).providerError?.message || 'AI provider still unavailable on retry');
  }

  await mirrorAsyncJob({ ...job, failureReason: 'recovered' }, 'completed');
  logger.info('orch_retry_succeeded', { requestId: job.requestId });
  return { ok: true, contentLength: String(result.content || '').length };
}
