/**
 * Task #156 — SME GRPO Redis training queue + EMA preference tracker.
 *
 * Two surfaces:
 *   1. enqueueTrainingPair(): XADD onto stream `nyv:grpo:training`.
 *      Downstream trainers/back-fill jobs consume; gateway never blocks.
 *   2. bumpEma()/getEmaBoost(): per-(jurisdiction, taskKind, model) EMA hash
 *      `nyv:grpo:prefs:{j}:{taskKind}:{model}` updated on each rating.
 *      Read by the intelligent-router as a soft tie-breaker boost.
 *
 * Redis is OPTIONAL: when no TCP URL is configured (resolveRedisTcpUrl
 * returns disabled) all calls become no-ops and emit one warn line. The
 * Postgres write in `/feedback` is the durable source of truth — Redis is
 * a fast-path signal channel only.
 *
 * NV-SECRETS-001 compliant: uses resolveRedisTcpUrl() for the URL.
 * NV-ARCH-001: read-side EMA boost is bounded (max ±0.04 of pickSequence
 * score); write-side enqueue is fire-and-forget so a Redis blip never
 * fails an SME's send.
 */

import { createLogger } from '../../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../../utils/redis-tcp-url.js';

const logger = createLogger('sme-grpo-redis-queue');

// Minimal structural type for the subset of ioredis we use. We import
// ioredis lazily so the `Redis` type is local; this avoids `any` while
// not coupling the build to the type re-export shape of the package.
interface MinimalRedis {
  xadd(...args: Array<string | number>): Promise<string | null>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...args: Array<string | number>): Promise<number>;
  hincrby(key: string, field: string, delta: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  on(event: 'error', handler: (e: Error) => void): void;
}

let _client: MinimalRedis | null = null;
let _disabled = false;

async function getClient(): Promise<MinimalRedis | null> {
  if (_disabled) return null;
  if (_client) return _client;
  const r = resolveRedisTcpUrl();
  if (!r.enabled || !r.url) {
    _disabled = true;
    logRedisDisabledOnce('sme-grpo-redis-queue', r.reason ?? 'no TCP url');
    return null;
  }
  try {
    const ioredisMod = await import('ioredis');
    const IORedis = (ioredisMod as { default?: unknown }).default ?? ioredisMod;
    const Ctor = IORedis as unknown as new (url: string, opts: Record<string, unknown>) => MinimalRedis;
    // NV-SME-GRPO-REDIS-OFFLINE-QUEUE-2026-05-12: ioredis with
    // `enableOfflineQueue: false` rejects every command issued before the
    // socket reaches `ready` ("Stream isn't writeable"). On Upstash TLS
    // that handshake takes ~50-200ms, so the first SME feedback after
    // gateway boot reliably failed and the EMA never bumped. The queue
    // contract is fire-and-forget at the call-site (catches own errors,
    // never blocks /feedback) so a small offline buffer is safe — it just
    // lets the very first XADD wait for the socket instead of dying. We
    // still cap retries so a sustained Redis outage doesn't pile up
    // commands forever.
    const client = new Ctor(r.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      connectTimeout: 5000,
    });
    client.on('error', (e: Error) => {
      logger.warn('[sme-grpo] redis error (non-fatal): ' + e.message);
    });
    _client = client;
    return _client;
  } catch (e) {
    _disabled = true;
    logger.warn('[sme-grpo] ioredis import/connect failed; queue disabled: ' + (e as Error).message);
    return null;
  }
}

export interface GrpoTrainingPair {
  feedbackId: number | string;
  orchestrationId: string;
  smeUserId: number | string;
  jurisdiction: string;
  taskKind: string;
  model: string;
  prompt: string;
  response: string;
  ratings: Record<string, number | string>;
  comment?: string | null;
  preferredOver?: string | null;
  judgeVerdict?: unknown;
}

const STREAM_KEY = 'nyv:grpo:training';
const STREAM_MAXLEN = 50000;

export async function enqueueTrainingPair(pair: GrpoTrainingPair): Promise<boolean> {
  const c = await getClient();
  if (!c) {
    return false;
  }
  try {
    await c.xadd(
      STREAM_KEY,
      'MAXLEN', '~', String(STREAM_MAXLEN),
      '*',
      'feedbackId', String(pair.feedbackId),
      'orchestrationId', pair.orchestrationId,
      'smeUserId', String(pair.smeUserId),
      'jurisdiction', pair.jurisdiction,
      'taskKind', pair.taskKind,
      'model', pair.model,
      'prompt', truncate(pair.prompt, 4000),
      'response', truncate(pair.response, 8000),
      'ratings', JSON.stringify(pair.ratings),
      'comment', pair.comment ?? '',
      'preferredOver', pair.preferredOver ?? '',
      'judgeVerdict', pair.judgeVerdict ? JSON.stringify(pair.judgeVerdict) : '',
      'ts', String(Date.now()),
    );
    return true;
  } catch (e) {
    logger.warn('[sme-grpo] xadd failed (non-fatal): ' + (e as Error).message);
    return false;
  }
}

const ALPHA = 0.2; // EMA smoothing factor

function emaKey(jurisdiction: string, taskKind: string, model: string): string {
  return `nyv:grpo:prefs:${jurisdiction.toUpperCase()}:${taskKind.toLowerCase()}:${model.toLowerCase()}`;
}

/**
 * Update the per-(jurisdiction, taskKind, model) EMA score from an SME
 * rubric. `avgScore` is expected to be 0..1 (computed by the caller — we
 * average the 5 numeric rubric dimensions). New EMA is α·new + (1-α)·old.
 */
export async function bumpEma(opts: {
  jurisdiction: string;
  taskKind: string;
  model: string;
  avgScore: number;
}): Promise<void> {
  if (!Number.isFinite(opts.avgScore)) return;
  const c = await getClient();
  if (!c) return;
  const key = emaKey(opts.jurisdiction, opts.taskKind, opts.model);
  try {
    const prev = await c.hget(key, 'ema');
    const prevNum = prev != null ? Number(prev) : NaN;
    const next = Number.isFinite(prevNum)
      ? ALPHA * opts.avgScore + (1 - ALPHA) * prevNum
      : opts.avgScore;
    await c.hset(key, 'ema', String(next), 'updatedAt', String(Date.now()));
    await c.hincrby(key, 'count', 1);
    // Keep the hash from sticking around forever in dev. 60 days TTL.
    await c.expire(key, 60 * 24 * 3600);
  } catch (e) {
    logger.warn('[sme-grpo] ema bump failed (non-fatal): ' + (e as Error).message);
  }
}

/**
 * Read EMA boost for a (jurisdiction, taskKind, model). Returns a value
 * in [-0.04, +0.04] suitable for adding directly to the router score.
 *
 * Called from a HOT PATH (intelligent-router.pickSequence) — must NEVER
 * block the request. We use a tiny in-memory LRU + best-effort async
 * refresh; first ever lookup returns 0 then triggers a background fetch.
 */
const EMA_CACHE = new Map<string, { boost: number; expiresAt: number }>();
const EMA_TTL_MS = 60_000;

export function getEmaBoostSync(jurisdiction: string, taskKind: string, model: string): number {
  if (!jurisdiction || !taskKind || !model) return 0;
  const key = emaKey(jurisdiction, taskKind, model);
  const entry = EMA_CACHE.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.boost;
  // Stale or missing — schedule async refresh, return last-known (or 0).
  void refreshEmaBoost(jurisdiction, taskKind, model);
  return entry?.boost ?? 0;
}

async function refreshEmaBoost(jurisdiction: string, taskKind: string, model: string): Promise<void> {
  const c = await getClient();
  if (!c) return;
  const key = emaKey(jurisdiction, taskKind, model);
  try {
    const ema = await c.hget(key, 'ema');
    const num = ema != null ? Number(ema) : NaN;
    if (!Number.isFinite(num)) {
      EMA_CACHE.set(key, { boost: 0, expiresAt: Date.now() + EMA_TTL_MS });
      return;
    }
    // Map ema [0..1] → boost [-0.04..+0.04] centered on 0.5 so models
    // at neutral get no nudge. Bounded by design.
    const boost = Math.max(-0.04, Math.min(0.04, (num - 0.5) * 0.08));
    EMA_CACHE.set(key, { boost, expiresAt: Date.now() + EMA_TTL_MS });
  } catch {
    /* swallow */
  }
}

function truncate(s: string, n: number): string {
  return typeof s === 'string' && s.length > n ? s.slice(0, n) : (s ?? '');
}

/** test/observability — clear the LRU. */
export function _resetSmeGrpoCache(): void {
  EMA_CACHE.clear();
}
