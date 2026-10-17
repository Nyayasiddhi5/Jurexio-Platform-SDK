/**
 * NV-ADAPTIVE-PATH-EMA-001 — lightweight learned AdaptiveRouter (no ML infra).
 *
 * Records path outcomes (success/latency/grounded) into Redis hashes and applies
 * a bounded boost when the heuristic decision is near a queen↔specialist boundary.
 * Partner lean and forced Queen modes are NEVER overridden.
 *
 * Pillars: (2) speed — prefer specialist when history shows specialist wins for
 * similar moderate work; prefer Queen when specialist fails/ungrounds often.
 */
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../utils/redis-tcp-url.js';
import type { AdaptivePath, AdaptiveRouterDecision, AdaptiveRouterInput } from '../orchestration/jrx-adaptive-router.js';

const logger = createLogger('adaptive-path-ema');

const KEY_PREFIX = 'nyv:adaptive:path:ema:';
const CACHE_TTL_MS = 30_000;
const BOOST_THRESHOLD = 0.12;

type PathStats = { n: number; success: number; grounded: number; avgLatencyMs: number };

interface MinimalRedis {
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, ...args: Array<string | number>): Promise<number>;
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
    logRedisDisabledOnce('adaptive-path-ema', r.reason ?? 'no TCP url');
    return null;
  }
  try {
    const ioredisMod = await import('ioredis');
    const IORedis = (ioredisMod as { default?: unknown }).default ?? ioredisMod;
    const Ctor = IORedis as unknown as new (url: string, opts: Record<string, unknown>) => MinimalRedis;
    const client = new Ctor(r.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      connectTimeout: 5000,
    });
    client.on('error', () => { /* non-fatal */ });
    _client = client;
    return _client;
  } catch (e: any) {
    _disabled = true;
    logger.warn('adaptive_path_ema_redis_init_failed', { err: e?.message });
    return null;
  }
}

const memCache = new Map<string, { at: number; stats: Record<AdaptivePath, PathStats> }>();

function bucketKey(input: Pick<AdaptiveRouterInput, 'prompt' | 'complexity' | 'risk'>): string {
  const c = String(input.complexity || 'moderate').toLowerCase();
  const r = String(input.risk || 'medium').toLowerCase();
  const lang = /[\u0900-\u097F]/.test(input.prompt || '') ? 'hi' : 'en';
  return `${c}|${r}|${lang}`;
}

function emptyStats(): Record<AdaptivePath, PathStats> {
  return {
    queen: { n: 0, success: 0, grounded: 0, avgLatencyMs: 0 },
    specialist: { n: 0, success: 0, grounded: 0, avgLatencyMs: 0 },
    'doc-pipeline': { n: 0, success: 0, grounded: 0, avgLatencyMs: 0 },
  };
}

function score(s: PathStats): number {
  if (s.n < 5) return 0.5;
  const successRate = s.success / s.n;
  const groundRate = s.grounded / Math.max(1, s.n);
  const latencyPenalty = Math.min(0.15, (s.avgLatencyMs || 0) / 120_000);
  return 0.55 * successRate + 0.35 * groundRate + 0.1 * (1 - latencyPenalty);
}

async function loadStats(bucket: string): Promise<Record<AdaptivePath, PathStats>> {
  const hit = memCache.get(bucket);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stats;
  const stats = emptyStats();
  try {
    const redis = await getClient();
    if (!redis) {
      memCache.set(bucket, { at: Date.now(), stats });
      return stats;
    }
    const raw = await redis.hgetall(`${KEY_PREFIX}${bucket}`);
    for (const path of Object.keys(stats) as AdaptivePath[]) {
      const blob = raw?.[path];
      if (!blob) continue;
      try {
        const parsed = JSON.parse(blob) as PathStats;
        if (parsed && typeof parsed.n === 'number') stats[path] = parsed;
      } catch { /* ignore */ }
    }
  } catch (e: any) {
    logger.warn('adaptive_path_ema_load_failed', { err: e?.message });
  }
  memCache.set(bucket, { at: Date.now(), stats });
  return stats;
}

/**
 * Apply bounded path learning AFTER heuristics. Never overrides lean / forceQueen.
 */
export async function applyAdaptivePathLearning(
  decision: AdaptiveRouterDecision,
  input: AdaptiveRouterInput,
): Promise<AdaptiveRouterDecision> {
  if (process.env.JRX_ADAPTIVE_PATH_LEARNING === '0') return decision;
  if (input.partnerLean || input.engageQueenForced || input.forceQueenMode) return decision;
  if (decision.complexity === 'very_complex' || decision.risk === 'critical') return decision;
  if (decision.path === 'doc-pipeline') return decision;

  const bucket = bucketKey(input);
  const stats = await loadStats(bucket);
  const queenScore = score(stats.queen);
  const specScore = score(stats.specialist);
  const gap = Math.abs(queenScore - specScore);
  if (gap < BOOST_THRESHOLD) return decision;
  if (stats.queen.n < 5 && stats.specialist.n < 5) return decision;

  let next = decision.path;
  let reasonExtra = '';
  if (decision.path === 'specialist' && queenScore > specScore + BOOST_THRESHOLD) {
    /* NV-QUEEN-EARNED-001 — the learned layer may escalate, but never over a
     * request the deterministic tier can close with zero tokens. A store hit is
     * not an ambiguous boundary case: it is a measured cheap win, and flipping it
     * to the swarm would re-open exactly the "agent before tools" ordering that
     * the admission gate exists to close. The gate's own ambiguity band already
     * handles genuine boundary requests. */
    const storeCanAnswer =
      decision.queenAdmission?.reason === 'deny:store_can_answer'
      || decision.queenAdmission?.evidence.deterministicCandidate === true
      || decision.queenAdmission?.evidence.mappingQuestion === true;
    if (storeCanAnswer) {
      logger.info('adaptive_path_ema_flip_suppressed', {
        bucket,
        reason: 'deterministic_tier_can_answer',
        admission: decision.queenAdmission?.reason,
      });
      return decision;
    }
    next = 'queen';
    reasonExtra = `path-ema flip→queen (q=${queenScore.toFixed(2)} s=${specScore.toFixed(2)})`;
  } else if (
    decision.path === 'queen'
    && specScore > queenScore + BOOST_THRESHOLD
    && decision.complexity !== 'complex'
  ) {
    next = 'specialist';
    reasonExtra = `path-ema flip→specialist (q=${queenScore.toFixed(2)} s=${specScore.toFixed(2)})`;
  }
  if (next === decision.path) return decision;

  logger.info('adaptive_path_ema_flip', { bucket, from: decision.path, to: next, reasonExtra });
  return {
    ...decision,
    path: next,
    reason: `${decision.reason} | ${reasonExtra}`,
    requireCoT: next === 'queen' ? true : decision.requireCoT,
    requireQueenDepth: next === 'queen' ? true : decision.requireQueenDepth,
  };
}

export async function recordAdaptivePathOutcome(opts: {
  prompt: string;
  complexity?: string;
  risk?: string;
  path: AdaptivePath;
  success: boolean;
  grounded?: boolean;
  latencyMs?: number;
}): Promise<void> {
  if (process.env.JRX_ADAPTIVE_PATH_LEARNING === '0') return;
  const bucket = bucketKey({
    prompt: opts.prompt,
    complexity: opts.complexity,
    risk: opts.risk,
  });
  try {
    const redis = await getClient();
    if (!redis) return;
    const key = `${KEY_PREFIX}${bucket}`;
    const raw = await redis.hget(key, opts.path);
    const prev: PathStats = raw
      ? JSON.parse(raw)
      : { n: 0, success: 0, grounded: 0, avgLatencyMs: 0 };
    const n = prev.n + 1;
    const success = prev.success + (opts.success ? 1 : 0);
    const grounded = prev.grounded + (opts.grounded ? 1 : 0);
    const avgLatencyMs =
      ((prev.avgLatencyMs || 0) * prev.n + (opts.latencyMs || 0)) / n;
    const next: PathStats = { n, success, grounded, avgLatencyMs };
    await redis.hset(key, opts.path, JSON.stringify(next));
    await redis.expire(key, 60 * 60 * 24 * 30);
    memCache.delete(bucket);
  } catch (e: any) {
    logger.warn('adaptive_path_ema_record_failed', { err: e?.message });
  }
}
