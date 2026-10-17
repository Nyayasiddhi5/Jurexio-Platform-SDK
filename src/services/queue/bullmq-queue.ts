/**
 * BullMQ Queue Layer — durable Redis-backed queues for delivery-critical work.
 *
 * Why BullMQ in addition to the existing PgJobQueue:
 *  - Webhook delivery, long-document parsing, summarisation, and per-platform
 *    request relay must NEVER be lost between accept and complete. BullMQ
 *    gives us native retries with exponential back-off, durable failed-job
 *    storage, dead-letter queues, scheduled / repeatable jobs, and
 *    concurrency control out of the box on top of Redis we already run.
 *  - PgJobQueue stays the canonical store for SDK-internal lifecycle work
 *    (org provisioning, key rotations, etc.). The two coexist.
 */

import { Queue, QueueEvents, Worker, type WorkerOptions, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../../utils/redis-tcp-url.js';

const logger = createLogger('bullmq-queue');

// NYV-OPS-BULLMQ-DISABLE-001 (Task #28): refuse to construct an ioredis
// client when no usable TCP URL is configured. Previously we'd default to
// the Upstash REST URL (https://...), ioredis would parse "https" as a
// username and the server would WRONGPASS-loop forever, spamming the
// gateway log every ~1 second. Now we log ONCE on startup and silently
// no-op all enqueue/worker calls so the platform stays readable.
const _redisResolution = resolveRedisTcpUrl();
// `_runtimeDisabled` flips to true when ioredis surfaces a fatal auth
// error at runtime (WRONGPASS / NOAUTH). Once tripped we tear the
// connection down and stop reconnecting — every subsequent enqueue/worker
// call short-circuits to a no-op, matching the static-disabled behaviour.
let _runtimeDisabled = false;
let _runtimeDisabledReason: string | null = null;
const REDIS_URL = _redisResolution.url ?? '';

export const isQueueEnabled: boolean = _redisResolution.enabled;

/**
 * Public probe — is BullMQ usable RIGHT NOW. Combines the static
 * resolution result with the runtime auth-failure trip.
 */
export function isQueueLive(): boolean {
  return isQueueEnabled && !_runtimeDisabled;
}

export function getQueueDisabledReason(): string | null {
  if (!isQueueEnabled) return _redisResolution.reason ?? null;
  if (_runtimeDisabled) return _runtimeDisabledReason;
  return null;
}

if (!isQueueEnabled && _redisResolution.reason) {
  logRedisDisabledOnce('BullMQ', _redisResolution.reason);
}

/* ---------- shared connection ---------- */

let _connection: IORedis | null = null;

/**
 * Auth-failure detection. Upstash and stock Redis 7 surface bad credentials
 * as a top-level `Error` whose message starts with `WRONGPASS` or
 * `NOAUTH`. Without this guard ioredis retries forever and emits one log
 * line per attempt — exactly the WRONGPASS spam Task #28 was created to
 * silence.
 */
function isFatalAuthError(err: Error): boolean {
  const m = (err?.message || '').toUpperCase();
  // NYV-OPS-AUTH-DETECT-001 (Task #28 round 5): tightened from
  // includes('AUTH') (which would match unrelated tokens like
  // "AUTHENTICATED", "AUTHORIZATION", "ASYNC_AUTH_HOOK") to the
  // explicit Redis reply prefixes only. Same set used by
  // nv-rate-limit-middleware and nv-redis-platform-rate-limiter.
  return m.includes('WRONGPASS') || m.includes('NOAUTH');
}

/**
 * Returns the shared ioredis connection used by all BullMQ queues/workers.
 * When BullMQ is disabled — either at boot (no valid TCP URL) or at runtime
 * (auth error) — returns null so callers can short-circuit to a no-op
 * gracefully. Callers MUST handle null.
 */
export function getQueueConnection(): IORedis | null {
  if (!isQueueLive()) return null;
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, {
      // BullMQ requires this; ioredis would otherwise drop in-flight cmds
      // on reconnect.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Keep TCP alive across NAT/idle so we do not silently lose worker reads.
      keepAlive: 30_000,
      // NYV-OPS-RECONNECT-NARROW-001 (Task #28 round 7): only AUTH
      // failures permanently disable the queue path. Transient
      // connect failures (network blips, DNS hiccups, broker
      // restarts) keep retrying with exponential backoff capped at
      // 5s — they should self-heal, not flip the platform into a
      // permanent in-memory fallback that requires a process
      // restart. The previous "after 5 attempts disable forever"
      // policy was over-eager under network turbulence.
      retryStrategy: (times: number) => {
        if (_runtimeDisabled) return null; // auth-disabled — stop retrying
        return Math.min(times * 500, 5_000);
      },
      // CRITICAL: do NOT reconnect on auth failures. Returning false here
      // tells ioredis to abandon the socket and stop spamming.
      reconnectOnError: (err: Error) => {
        if (isFatalAuthError(err)) return false;
        return true;
      },
    });

    _connection.on('error', (e: Error) => {
      if (isFatalAuthError(e) && !_runtimeDisabled) {
        _runtimeDisabled = true;
        _runtimeDisabledReason = `auth failed: ${e.message}`;
        // ONE log line, then permanently silent.
        logRedisDisabledOnce('BullMQ', _runtimeDisabledReason);
        try { _connection?.disconnect(); } catch { /* ignore */ }
        _connection = null;
        return;
      }
      // Non-auth errors are still notable but rate-limited by ioredis itself
      // (one per reconnect cycle, not per second).
      if (!_runtimeDisabled) {
        logger.warn('redis connection error', { err: e.message });
      }
    });
    _connection.on('connect', () => logger.info('redis connected for queues'));
  }
  return _connection;
}

/* ---------- canonical queue names ---------- */

// NYV-OPS-Q-NAMES-001 (2026-04-25): BullMQ ≥ v5 rejects queue names containing
// `:` (it reserves `:` for its own Redis key namespacing). Use `-` as separator.
// If you need to reuse a Redis instance that previously held data under the old
// `nyv:*` keys, those keys are orphaned (drain manually) — there is no
// migration because no successful enqueue happened with the old constructor
// (the worker registration always threw).
export const QueueNames = {
  WEBHOOK_DELIVERY: 'nyv-webhook-delivery',
  WEBHOOK_DLQ: 'nyv-webhook-dlq',

  DOC_PARSE: 'nyv-doc-parse',
  DOC_PARSE_DLQ: 'nyv-doc-parse-dlq',

  DOC_SUMMARIZE: 'nyv-doc-summarize',
  DOC_SUMMARIZE_DLQ: 'nyv-doc-summarize-dlq',

  PLATFORM_RELAY: 'nyv-platform-relay',
  PLATFORM_RELAY_DLQ: 'nyv-platform-relay-dlq',

  PQC_SIGN: 'nyv-pqc-sign',
  PQC_SIGN_DLQ: 'nyv-pqc-sign-dlq',

  // Task #130 (2026-05-11): /api/nv5/doc-ai/convert async job queue.
  // Job payload is the jobId only; source bytes + result bytes live in
  // object storage and the ledger lives in Redis (see
  // services/queue/doc-ai-job-store.ts) so any pod can fulfil the work.
  DOC_AI_CONVERT: 'nyv-doc-ai-convert',
  DOC_AI_CONVERT_DLQ: 'nyv-doc-ai-convert-dlq',

  /** Failed orchestrate / LLM requests — durable retry with backoff + DLQ */
  ORCH_RETRY: 'nyv-orch-retry',
  ORCH_RETRY_DLQ: 'nyv-orch-retry-dlq',

  /** Ecosystem Document Job — durable Redis path (async_job_queue remains status ledger) */
  ECOSYSTEM_DOC_JOB: 'nyv-ecosystem-doc-job',
  ECOSYSTEM_DOC_JOB_DLQ: 'nyv-ecosystem-doc-job-dlq',

  /** NV-DOCPARSE-JOBS-001 — Platform SDK async parse (legal-first). */
  DOCPARSE_SDK: 'nyv-docparse-sdk',
  DOCPARSE_SDK_DLQ: 'nyv-docparse-sdk-dlq',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/* ---------- default job options (retries + back-off + DLQ) ---------- */

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s, 8s, 16s
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 }, // keep failures 30 days for inspection
};

/* ---------- queue factory + registry ---------- */

const _queues = new Map<string, Queue>();
const _events = new Map<string, QueueEvents>();

/**
 * Disabled-result returned by enqueue helpers when the queue subsystem is
 * not live. Mirrors the shape callers care about (id + a marker) without
 * forcing them to handle null at every site. `disabled:true` lets callers
 * decide whether to log, fall back, or ignore.
 */
export interface DisabledQueueResult {
  id: null;
  disabled: true;
  reason: string;
  queue: string;
}

function disabledResult(queue: string): DisabledQueueResult {
  return { id: null, disabled: true, queue, reason: getQueueDisabledReason() ?? 'queue disabled' };
}

/**
 * Returns the BullMQ Queue or `null` when the subsystem is disabled.
 * Callers MUST handle null — the prior throw-when-disabled behaviour
 * caused unhandled rejections every time a request hit an enqueue path.
 */
export function getQueue(name: QueueName): Queue | null {
  if (!isQueueLive()) return null;
  let q = _queues.get(name);
  if (!q) {
    const conn = getQueueConnection();
    if (!conn) return null;
    q = new Queue(name, { connection: conn, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    _queues.set(name, q);
    logger.info('queue registered', { name });
  }
  return q;
}

export function getQueueEvents(name: QueueName): QueueEvents | null {
  if (!isQueueLive()) return null;
  let e = _events.get(name);
  if (!e) {
    const conn = getQueueConnection();
    if (!conn) return null;
    e = new QueueEvents(name, { connection: conn });
    _events.set(name, e);
  }
  return e;
}

/* ---------- typed enqueue helpers ---------- */

export interface WebhookDeliveryJob {
  appId: string;
  platform: string;
  url: string;
  event: string;
  payload: Record<string, unknown>;
  secret: string; // HMAC signing secret
  correlationId?: string;
}

export interface DocParseJob {
  documentId: string;
  orgId: string | number | null;
  platform: string;
  storagePath: string; // s3 key or local
  mimeType: string;
  totalBytes: number;
  ocrRequired?: boolean;
  language?: string;
}

export interface DocSummarizeJob {
  documentId: string;
  orgId: string | number | null;
  platform: string;
  chunkIds?: string[]; // map-reduce inputs
  mode?: 'extractive' | 'abstractive' | 'hybrid';
  jurisdiction?: string;
}

export interface PlatformRelayJob {
  platform: string;
  apiKey: string;
  endpoint: string; // absolute URL
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  correlationId: string;
  /** ms — used for visibility in admin UI; SLA owner (NOT a hard timeout) */
  slaTargetMs?: number;
}

export interface PqcSignJob {
  artifactId: string;
  platform: string;
  payloadHash: string; // sha256 hex
  algorithm?: 'ML-DSA-65' | 'SLH-DSA-SHA2-128s';
}

// Task #130: tiny by design. The full job record (formats, byte counts,
// status, options) lives in Redis via doc-ai-job-store; the source +
// result bytes live in object storage. Worker only needs the id.
export interface DocAiConvertJob {
  jobId: string;
}

export interface DocparseSdkBullJob {
  jobId: string;
  createdAt: string;
  domainPackId: string;
  run: {
    batchId: string;
    actor: string;
    domainPackId?: string;
    maxPagesPerDoc?: number;
    forceOcr?: boolean;
    preferOcr?: boolean;
  };
  files: Array<{ fileName: string; mime?: string; base64: string }>;
}

// Each enqueue helper short-circuits to a typed DisabledQueueResult when
// the queue subsystem is not live. Callers should treat `disabled:true` as
// "skipped — handle synchronously / persist for later" rather than as a
// hard error.
export async function enqueueWebhook(j: WebhookDeliveryJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.WEBHOOK_DELIVERY);
  if (!q) return disabledResult(QueueNames.WEBHOOK_DELIVERY);
  return q.add('deliver', j, opts);
}
export async function enqueueDocParse(j: DocParseJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.DOC_PARSE);
  if (!q) return disabledResult(QueueNames.DOC_PARSE);
  // priority is payload-size-aware (smaller = higher priority => lower number)
  const priority = j.totalBytes < 256 * 1024 ? 1 : j.totalBytes < 5 * 1024 * 1024 ? 5 : 10;
  return q.add('parse', j, { ...opts, priority });
}
export async function enqueueDocSummarize(j: DocSummarizeJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.DOC_SUMMARIZE);
  if (!q) return disabledResult(QueueNames.DOC_SUMMARIZE);
  return q.add('summarize', j, opts);
}
export async function enqueuePlatformRelay(j: PlatformRelayJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.PLATFORM_RELAY);
  if (!q) return disabledResult(QueueNames.PLATFORM_RELAY);
  return q.add('relay', j, opts);
}
export async function enqueuePqcSign(j: PqcSignJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.PQC_SIGN);
  if (!q) return disabledResult(QueueNames.PQC_SIGN);
  return q.add('sign', j, opts);
}
export async function enqueueDocAiConvert(j: DocAiConvertJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.DOC_AI_CONVERT);
  if (!q) return disabledResult(QueueNames.DOC_AI_CONVERT);
  return q.add('convert', j, opts);
}
export async function enqueueDocparseSdk(j: DocparseSdkBullJob, opts?: JobsOptions) {
  const q = getQueue(QueueNames.DOCPARSE_SDK);
  if (!q) return disabledResult(QueueNames.DOCPARSE_SDK);
  const bytes = j.files.reduce((n, f) => n + Buffer.byteLength(f.base64, 'base64'), 0);
  const priority = bytes < 512 * 1024 ? 2 : bytes < 4 * 1024 * 1024 ? 6 : 12;
  return q.add('docparse-sdk', j, { ...opts, priority });
}

/** Failed orchestration / LLM request — durable retry with backoff. */
export interface OrchRetryJobPayload {
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
}

export async function enqueueOrchRetry(j: OrchRetryJobPayload, opts?: JobsOptions) {
  const q = getQueue(QueueNames.ORCH_RETRY);
  if (!q) return disabledResult(QueueNames.ORCH_RETRY);
  return q.add('retry', j, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
    ...opts,
  });
}

/** EDJ worker payload — jobId is enough; full payload is also persisted for retries. */
export interface EcosystemDocJobPayload {
  jobId: string;
  userId?: string;
  [key: string]: unknown;
}

export async function enqueueEcosystemDocJob(j: EcosystemDocJobPayload, opts?: JobsOptions) {
  const q = getQueue(QueueNames.ECOSYSTEM_DOC_JOB);
  if (!q) return disabledResult(QueueNames.ECOSYSTEM_DOC_JOB);
  return q.add('process', j, {
    jobId: j.jobId,
    attempts: 4,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 2000 },
    removeOnFail: { age: 30 * 24 * 3600 },
    ...opts,
  });
}

/* ---------- DLQ helper ---------- */

export async function pushToDlq(originalQueue: QueueName, dlq: QueueName, jobName: string, data: unknown, reason: string) {
  const q = getQueue(dlq);
  if (!q) {
    // DLQ unreachable — surface in logs but don't throw out of the worker callback.
    logger.error('job moved to DLQ but DLQ disabled', { from: originalQueue, dlq, reason, queueDisabledReason: getQueueDisabledReason() });
    return;
  }
  await q.add(
    jobName,
    { from: originalQueue, data, reason, ts: new Date().toISOString() },
    { attempts: 1, removeOnComplete: false, removeOnFail: false },
  );
  logger.error('job moved to DLQ', { from: originalQueue, dlq, reason });
}

/* ---------- worker factory ---------- */

export interface RegisterWorkerOpts<T = unknown, R = unknown> {
  name: QueueName;
  dlq?: QueueName;
  concurrency?: number;
  handler: (data: T, job: any) => Promise<R>;
  options?: Partial<WorkerOptions>;
}

const _workers: Worker[] = [];

// NYV-OPS-STALLED-001 (2026-04-30): in-memory per-queue stalled counter.
// BullMQ surfaces stalled jobs via the `stalled` worker event when a
// running job's lock is not renewed within the lockDuration. The job is
// then moved back to the wait set for retry. Without an explicit handler,
// silent re-enqueue can mask worker crashes / event-loop blocks. Counting
// here lets the admin health endpoint flag the rate so operators see
// worker thrash before it manifests as customer-visible failures.
const _stalledCounts = new Map<string, number>();

export function getStalledCount(queueName: string): number {
  return _stalledCounts.get(queueName) ?? 0;
}

export function getAllStalledCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.values(QueueNames)) out[name] = _stalledCounts.get(name) ?? 0;
  return out;
}

/**
 * Registers a BullMQ worker, or short-circuits to a no-op when the queue
 * subsystem is disabled. Returns null in the disabled case so callers can
 * skip downstream wiring rather than crash on construction.
 */
export function registerWorker<T = unknown, R = unknown>(opts: RegisterWorkerOpts<T, R>): Worker | null {
  if (!isQueueLive()) {
    logger.warn('worker registration skipped (queue disabled)', { queue: opts.name, reason: getQueueDisabledReason() });
    return null;
  }
  const conn = getQueueConnection();
  if (!conn) return null;
  const w = new Worker(
    opts.name,
    async (job) => {
      try {
        return await opts.handler(job.data as T, job);
      } catch (err: any) {
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts?.attempts ?? DEFAULT_JOB_OPTIONS.attempts!);
        if (isFinalAttempt && opts.dlq) {
          await pushToDlq(opts.name, opts.dlq, job.name, job.data, err?.message || String(err));
        }
        throw err;
      }
    },
    {
      connection: conn,
      concurrency: opts.concurrency ?? 5,
      ...opts.options,
    },
  );
  w.on('failed', (job, err) =>
    logger.warn('job failed (will retry)', { queue: opts.name, jobId: job?.id, attempts: job?.attemptsMade, err: err?.message }),
  );
  w.on('completed', (job) => logger.debug('job done', { queue: opts.name, jobId: job.id }));
  // NYV-OPS-STALLED-001 (2026-04-30): track stalled jobs per-queue and
  // route to DLQ when the same job stalls past max attempts. BullMQ does
  // not pass the full job here (only the jobId), so DLQ entry carries
  // {jobId, reason:'stalled'} instead of the original payload — operators
  // can correlate via the queue-events stream.
  w.on('stalled', (jobId, _prev) => {
    const next = (_stalledCounts.get(opts.name) ?? 0) + 1;
    _stalledCounts.set(opts.name, next);
    logger.warn('job stalled (lock not renewed)', { queue: opts.name, jobId, totalStalled: next });
    if (opts.dlq) {
      pushToDlq(opts.name, opts.dlq, 'stalled', { jobId }, 'stalled: worker did not renew lock').catch((e) =>
        logger.error('stalled→DLQ push failed', { queue: opts.name, jobId, err: e?.message }),
      );
    }
  });
  _workers.push(w);
  logger.info('worker registered', { queue: opts.name, concurrency: opts.concurrency ?? 5 });
  return w;
}

export async function shutdownWorkers(): Promise<void> {
  await Promise.all(_workers.map((w) => w.close()));
  for (const q of _queues.values()) await q.close();
  for (const e of _events.values()) await e.close();
  if (_connection) {
    await _connection.quit().catch(() => {});
    _connection = null;
  }
}

/* ---------- queue health ---------- */

export async function getQueueHealth() {
  const out: Record<string, any> = {};
  // NYV-OPS-QUEUE-HEALTH-001 (Task #28 round 5): null-check `q` before
  // calling .getJobCounts(). When BullMQ is disabled at boot (no TCP
  // URL) or trips at runtime (WRONGPASS), getQueue() now returns null —
  // the previous code went straight into a TypeError caught by the
  // outer try/catch and emitted a noisy {ok:false} payload. Surface
  // the real "disabled" reason instead.
  if (!isQueueLive()) {
    const reason = getQueueDisabledReason() ?? 'queue disabled';
    for (const name of Object.values(QueueNames)) {
      out[name] = { ok: false, disabled: true, reason };
    }
    return out;
  }
  for (const name of Object.values(QueueNames)) {
    try {
      const q = getQueue(name as QueueName);
      if (!q) {
        out[name] = { ok: false, disabled: true, reason: getQueueDisabledReason() ?? 'queue disabled mid-flight' };
        continue;
      }
      const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      // NYV-OPS-STALLED-001 (2026-04-30): include stalled count + DLQ
      // depth pointer so admin health can show worker thrash and DLQ
      // backlog at a glance. dlqDepth is null for DLQ queues themselves.
      const stalled = _stalledCounts.get(name) ?? 0;
      const dlqName = (name as string).endsWith('-dlq') ? null : (name as string) + '-dlq';
      let dlqDepth: number | null = null;
      if (dlqName) {
        const dlq = _queues.get(dlqName);
        if (dlq) {
          try {
            const dc = await dlq.getJobCounts('waiting', 'active', 'failed');
            dlqDepth = (dc.waiting ?? 0) + (dc.active ?? 0) + (dc.failed ?? 0);
          } catch { dlqDepth = null; }
        } else {
          dlqDepth = 0;
        }
      }
      out[name] = { ok: true, ...counts, stalled, dlqDepth };
    } catch (e: any) {
      out[name] = { ok: false, error: e.message };
    }
  }
  return out;
}
