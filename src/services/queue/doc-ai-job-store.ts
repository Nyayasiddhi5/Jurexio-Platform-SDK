/**
 * doc-ai-job-store.ts — out-of-process job ledger + blob store for the
 * /api/nv5/doc-ai/convert async-job pattern.
 *
 * Task #130 (2026-05-11): the original implementation kept job state in
 * a single in-process `Map<id, DocJob>` and the converted output buffer
 * in heap, both per pod. That meant:
 *   (a) a pod restart mid-conversion turned the jobId into a 404,
 *   (b) horizontal scale-out silently 404'd polls hitting a different
 *       pod from the one that received the POST,
 *   (c) per-pod NYV_DOC_CONVERT_CONCURRENCY × pod count = real
 *       concurrency — no global cap.
 *
 * This module gives the route handler a single coherent surface:
 *   - createJob() / getJob() / updateJob()    → Redis ledger keyed by jobId
 *   - putSourceFromPath() / getSourceToPath() → object-storage blob for source
 *   - putResultBytes()    / getResultBytes()  → object-storage blob for output
 *   - cleanup()                               → delete blobs + ledger
 *
 * Both backends are optional:
 *   - If `NYV_REDIS_TCP_URL` is unusable, the ledger falls back to an
 *     in-process Map (with the existing 10 min TTL). Polls then only
 *     resolve on the originating pod — same as pre-task-130 behaviour.
 *   - Blobs are stored on AWS S3 when `NYV_S3_BUCKET` / `AWS_S3_BUCKET` is set.
 *     On local/dev environments without S3, blobs fall back to local-disk
 *     staging under `os.tmpdir()/nyv-doc-ai-blobs/`. Same caveat — only the
 *     originating pod can fulfil /jobs/:id/result in local-disk mode.
 *
 * `isDistributed()` reports the actual mode so the route can advertise
 * `distributed:true` in POST responses (and so callers / tests can assert
 * the intended cross-pod semantics are live).
 *
 * NV-SECRETS-001: Redis URL resolved via the canonical `resolveRedisTcpUrl()`.
 * NV-LLM-001: N/A — converter is pure (no LLM).
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createLogger } from '../../utils/logger.js';
import { resolveRedisTcpUrl } from '../../utils/redis-tcp-url.js';

const logger = createLogger('doc-ai-job-store');

/* ---------- public types ---------- */

export type DocAiJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface DocAiJobRecord {
  id: string;
  status: DocAiJobStatus;
  sourceFormat: string;
  targetFormat: string;
  bytesIn: number;
  bytesOut?: number;
  mimeType?: string;
  fileName?: string;
  conversionMs?: number;
  error?: string;
  /** ISO timestamps so the value is JSON-safe across the wire / Redis. */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** PID/host of the pod that ACCEPTED the POST — useful for triage. */
  acceptedByPod?: string;
  /** PID/host of the pod that EXECUTED the conversion (may differ). */
  executedByPod?: string;
  /** Serialized ConversionOptions (JSON string) — small, stays inside ledger. */
  optionsJson?: string;
}

/* ---------- internals ---------- */

const POD_ID =
  process.env.HOSTNAME ||
  `${os.hostname()}#${process.pid}`;

const KEY_PREFIX = 'nyv:doc-ai:job:';
// 24h TTL on the ledger entry — long enough for clients to retrieve the
// result, far longer than the previous 10 min in-memory TTL (the old TTL
// was tuned for a single pod's heap; persisted state can outlive that).
const LEDGER_TTL_SEC = Number.parseInt(process.env.NYV_DOC_AI_JOB_TTL_SEC ?? '86400', 10) || 86400;

const BLOB_PREFIX = process.env.NYV_DOC_AI_BLOB_PREFIX || 'temp/doc-ai';

const LOCAL_BLOB_DIR = path.join(os.tmpdir(), 'nyv-doc-ai-blobs');

let _redisInited = false;
let _redis: import('ioredis').Redis | null = null;
let _objectStoreClient: any = null;
let _objectStoreTried = false;
let _objectStoreOk = false;

/** In-process fallback ledger when Redis is disabled. */
const _localLedger = new Map<string, DocAiJobRecord>();
const LOCAL_LEDGER_TTL_MS = LEDGER_TTL_SEC * 1000;

function gcLocalLedger(): void {
  const cutoff = Date.now() - LOCAL_LEDGER_TTL_MS;
  for (const [id, j] of _localLedger.entries()) {
    const t = Date.parse(j.completedAt ?? j.createdAt);
    if (Number.isFinite(t) && t < cutoff) _localLedger.delete(id);
  }
}

async function getRedis(): Promise<import('ioredis').Redis | null> {
  if (_redisInited) return _redis;
  _redisInited = true;
  const r = resolveRedisTcpUrl();
  if (!r.enabled || !r.url) {
    logger.warn('Redis TCP not configured — doc-ai job ledger will run in-process only', {
      reason: r.reason,
    });
    return null;
  }
  try {
    const { Redis } = await import('ioredis');
    _redis = new Redis(r.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });
    _redis.on('error', (e: Error) => {
      // Surfaced once; do not spam.
      if (!(_redis as any)._loggedErr) {
        (_redis as any)._loggedErr = true;
        logger.warn('doc-ai ledger redis error (degraded to in-process ledger from now)', { err: e.message });
      }
    });
    return _redis;
  } catch (e: any) {
    logger.warn('ioredis unavailable for doc-ai ledger', { err: e?.message });
    return null;
  }
}

async function getObjectStore(): Promise<any | null> {
  if (_objectStoreTried) return _objectStoreOk ? _objectStoreClient : null;
  _objectStoreTried = true;
  // AWS S3 is the production object-store backend for doc-ai blobs.
  // If no bucket is configured, the route falls back to local-disk staging.
  try {
    const { createAwsS3DocAiBlobClient } = await import('./jrx-doc-ai-s3-adapter.js');
    const s3 = await createAwsS3DocAiBlobClient();
    if (s3) {
      _objectStoreClient = s3;
      _objectStoreOk = true;
      return _objectStoreClient;
    }
  } catch (e: any) {
    logger.warn('AWS S3 doc-ai adapter failed; blobs will stage on local disk only', { err: e?.message });
  }
  logger.warn('object-storage unavailable — doc-ai blobs will stage on local disk only');
  _objectStoreOk = false;
  return null;
}

function localBlobPath(jobId: string, kind: 'source' | 'result'): string {
  try { fs.mkdirSync(path.join(LOCAL_BLOB_DIR, jobId), { recursive: true }); } catch { /* best-effort */ }
  return path.join(LOCAL_BLOB_DIR, jobId, kind);
}

function blobKey(jobId: string, kind: 'source' | 'result'): string {
  return `${BLOB_PREFIX}/${jobId}/${kind}`;
}

/* ---------- ledger API ---------- */

export interface LedgerOpOptions {
  /**
   * Fail-closed semantics. When `true`, any Redis error throws instead
   * of silently falling back to the in-process map. The route uses this
   * for the distributed code path so a transient Redis fault can't
   * cause a "POST returned mode:distributed but ledger only exists on
   * this pod" split-brain — workers on other pods would 404 / drop the
   * job. Legacy in-process callers omit / pass false.
   */
  strict?: boolean;
}

export async function createJob(record: DocAiJobRecord, opts?: LedgerOpOptions): Promise<void> {
  record.acceptedByPod = record.acceptedByPod || POD_ID;
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(KEY_PREFIX + record.id, JSON.stringify(record), 'EX', LEDGER_TTL_SEC);
      return;
    } catch (e: any) {
      if (opts?.strict) {
        // Fail-closed: route will translate this to a 503 + blob cleanup.
        throw new Error(`ledger redis write failed (strict): ${e?.message ?? e}`);
      }
      logger.warn('redis create failed; falling back to local ledger for this job', { id: record.id, err: e?.message });
    }
  } else if (opts?.strict) {
    throw new Error('ledger redis unavailable (strict)');
  }
  _localLedger.set(record.id, record);
  gcLocalLedger();
}

export async function getJob(id: string, opts?: LedgerOpOptions): Promise<DocAiJobRecord | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(KEY_PREFIX + id);
      if (raw) return JSON.parse(raw) as DocAiJobRecord;
      // Strict means "Redis is the source of truth" — `null` means really
      // not there (don't peek at the local map, which would be a different
      // pod's stale state).
      if (opts?.strict) return null;
    } catch (e: any) {
      if (opts?.strict) {
        throw new Error(`ledger redis read failed (strict): ${e?.message ?? e}`);
      }
      logger.warn('redis get failed; checking local ledger', { id, err: e?.message });
    }
  } else if (opts?.strict) {
    throw new Error('ledger redis unavailable (strict)');
  }
  return _localLedger.get(id) ?? null;
}

export async function updateJob(
  id: string,
  patch: Partial<DocAiJobRecord>,
  opts?: LedgerOpOptions,
): Promise<DocAiJobRecord | null> {
  // Read-modify-write. We tolerate a lost update under heavy contention —
  // the only writers are (1) POST /jobs (create) and (2) the worker
  // handler (status transitions). They never touch the same fields.
  const current = await getJob(id, opts);
  if (!current) return null;
  const merged: DocAiJobRecord = { ...current, ...patch };
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(KEY_PREFIX + id, JSON.stringify(merged), 'EX', LEDGER_TTL_SEC);
      return merged;
    } catch (e: any) {
      if (opts?.strict) {
        throw new Error(`ledger redis update failed (strict): ${e?.message ?? e}`);
      }
      logger.warn('redis update failed; falling back to local ledger', { id, err: e?.message });
    }
  } else if (opts?.strict) {
    throw new Error('ledger redis unavailable (strict)');
  }
  _localLedger.set(id, merged);
  return merged;
}

/* ---------- blob API ---------- */

export async function putSourceFromPath(jobId: string, srcPath: string): Promise<void> {
  const client = await getObjectStore();
  if (client) {
    const key = blobKey(jobId, 'source');
    const r = await client.uploadFromFilename(key, srcPath);
    if (!r?.ok) throw new Error(`object-storage source upload failed: ${r?.error?.message || 'unknown'}`);
    return;
  }
  // Local fallback: copy to a stable location so the worker (same pod) can find it.
  const dest = localBlobPath(jobId, 'source');
  await fs.promises.copyFile(srcPath, dest);
}

export async function putSourceFromBytes(jobId: string, buf: Buffer): Promise<void> {
  const client = await getObjectStore();
  if (client) {
    const key = blobKey(jobId, 'source');
    const r = await client.uploadFromBytes(key, buf);
    if (!r?.ok) throw new Error(`object-storage source upload failed: ${r?.error?.message || 'unknown'}`);
    return;
  }
  const dest = localBlobPath(jobId, 'source');
  await fs.promises.writeFile(dest, buf);
}

/**
 * Materialise the source blob to a local path the converter can read.
 * Returns {path, cleanup}. Caller MUST invoke cleanup() in a finally
 * to remove the staged tmp copy.
 */
export async function getSourceToTempPath(jobId: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const client = await getObjectStore();
  if (client) {
    const key = blobKey(jobId, 'source');
    const stagedDir = path.join(os.tmpdir(), 'nyv-doc-ai-stage');
    try { fs.mkdirSync(stagedDir, { recursive: true }); } catch { /* best-effort */ }
    const staged = path.join(stagedDir, `${jobId}_${Date.now()}`);
    // downloadAsStream so we never load the whole 1 GB source into RSS.
    const stream: Readable = client.downloadAsStream(key);
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(staged);
      stream.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', () => resolve());
      stream.pipe(ws);
    });
    return {
      path: staged,
      cleanup: () => fs.promises.unlink(staged).catch(() => { /* best-effort */ }),
    };
  }
  // Local fallback: source already on this pod's tmp.
  const local = localBlobPath(jobId, 'source');
  if (!fs.existsSync(local)) {
    throw new Error(`source blob missing for job ${jobId} (object-storage disabled and not on this pod)`);
  }
  return { path: local, cleanup: async () => { /* leave for cleanup() */ } };
}

export async function putResultBytes(jobId: string, buf: Buffer): Promise<void> {
  const client = await getObjectStore();
  if (client) {
    const key = blobKey(jobId, 'result');
    const r = await client.uploadFromBytes(key, buf);
    if (!r?.ok) throw new Error(`object-storage result upload failed: ${r?.error?.message || 'unknown'}`);
    return;
  }
  await fs.promises.writeFile(localBlobPath(jobId, 'result'), buf);
}

export async function getResultBytes(jobId: string): Promise<Buffer | null> {
  const client = await getObjectStore();
  if (client) {
    const key = blobKey(jobId, 'result');
    const r = await client.downloadAsBytes(key);
    if (!r?.ok) return null;
    const v = Array.isArray(r.value) ? r.value[0] : r.value;
    return Buffer.isBuffer(v) ? v : Buffer.from(v);
  }
  const local = localBlobPath(jobId, 'result');
  if (!fs.existsSync(local)) return null;
  return fs.promises.readFile(local);
}

/**
 * Delete BOTH blobs and the ledger entry for a job. Used on
 * orphan-cleanup paths (e.g. the route created the ledger + uploaded
 * source, then enqueue threw) so we don't leave a stale `queued` record
 * pointing at a job that will never run.
 */
export async function cleanup(jobId: string): Promise<void> {
  // 1. Blobs (object storage or local).
  const client = await getObjectStore();
  if (client) {
    for (const kind of ['source', 'result'] as const) {
      try { await client.delete(blobKey(jobId, kind)); } catch { /* best-effort */ }
    }
  } else {
    for (const kind of ['source', 'result'] as const) {
      const p = localBlobPath(jobId, kind);
      fs.promises.unlink(p).catch(() => { /* best-effort */ });
    }
  }
  // 2. Ledger entry (Redis + in-process fallback).
  const redis = await getRedis();
  if (redis) {
    try { await redis.del(KEY_PREFIX + jobId); } catch { /* best-effort */ }
  }
  _localLedger.delete(jobId);
}

/* ---------- sweeper (task-133) ---------- */
//
// The route's success path intentionally LEAVES the result blob in object
// storage so the client can still GET /jobs/:id/result after the worker
// finishes, and the failure path doesn't always sweep the source blob.
// The Redis ledger expires after LEDGER_TTL_SEC (default 24 h) so the
// lookup table self-heals; without a sweeper, the underlying blobs would
// accumulate forever.
//
// `sweepExpiredBlobs()` lists every blob under BLOB_PREFIX (object storage)
// or every entry under LOCAL_BLOB_DIR (local fallback), groups them by
// jobId, and deletes any blob whose ledger entry no longer exists. We
// also enforce a minimum age (parsed from the jobId timestamp prefix, or
// the file mtime in local mode) so we never race a freshly-POSTed job
// whose source uploaded just before the ledger write committed.
//
// Returns a per-run summary that the periodic runner stashes in
// `_lastSweepStats`; the route's /health endpoint surfaces it.

export interface DocAiSweepStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mode: 'object-storage' | 'local-disk' | 'disabled';
  scanned: number;     // distinct jobIds observed
  expired: number;     // jobIds whose ledger entry was missing
  deleted: number;     // individual blob deletions that succeeded
  skippedYoung: number; // skipped because the jobId/file is younger than the grace window
  errors: number;
}

let _lastSweepStats: DocAiSweepStats | null = null;
let _sweepRunning = false;

export function getLastSweepStats(): DocAiSweepStats | null {
  return _lastSweepStats;
}

/**
 * Minimum age of a blob (or its jobId timestamp) before the sweeper is
 * willing to delete it. Defaults to ledger TTL + 1 h grace, which means
 * "the ledger has definitely had a chance to expire naturally". Lowering
 * this is only safe if you're sure no in-flight job is mid-upload.
 */
function sweeperMinAgeMs(): number {
  const override = Number.parseInt(process.env.NYV_DOC_AI_SWEEP_MIN_AGE_SEC ?? '', 10);
  if (Number.isFinite(override) && override > 0) return override * 1000;
  return (LEDGER_TTL_SEC + 3600) * 1000;
}

/** Parse the timestamp prefix from a doc_dist_/doc_inp_ jobId. Returns NaN if absent. */
function jobIdTimestampMs(jobId: string): number {
  // ids look like: `doc_dist_<Date.now()>_<rand>` or `doc_inp_<Date.now()>_<rand>`.
  const m = /^(?:doc_dist_|doc_inp_)?(\d{10,})_/.exec(jobId);
  if (!m) return NaN;
  const t = Number(m[1]);
  return Number.isFinite(t) ? t : NaN;
}

export async function sweepExpiredBlobs(): Promise<DocAiSweepStats> {
  // Re-entrancy guard: if a previous sweep is still running (e.g. a slow
  // object-store list against a very large bucket), skip this tick rather
  // than pile up overlapping passes.
  if (_sweepRunning) {
    const stats: DocAiSweepStats = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      mode: 'disabled',
      scanned: 0, expired: 0, deleted: 0, skippedYoung: 0, errors: 0,
    };
    return stats;
  }
  _sweepRunning = true;
  const startedAt = Date.now();
  const stats: DocAiSweepStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: '',
    durationMs: 0,
    mode: 'disabled',
    scanned: 0, expired: 0, deleted: 0, skippedYoung: 0, errors: 0,
  };
  const minAgeMs = sweeperMinAgeMs();
  const now = Date.now();

  try {
    const client = await getObjectStore();
    if (client) {
      stats.mode = 'object-storage';
      // Group blob keys by jobId so we make ONE ledger lookup per job
      // (and one delete per blob kind that actually exists).
      const byJob = new Map<string, string[]>();
      try {
        const r = await client.list({ prefix: `${BLOB_PREFIX}/` });
        if (r?.ok && Array.isArray(r.value)) {
          for (const obj of r.value as Array<{ name: string }>) {
            // Expect: `${BLOB_PREFIX}/<jobId>/<source|result>`
            const rel = obj.name.startsWith(`${BLOB_PREFIX}/`)
              ? obj.name.slice(BLOB_PREFIX.length + 1)
              : obj.name;
            const slash = rel.indexOf('/');
            const jobId = slash > 0 ? rel.slice(0, slash) : rel;
            if (!jobId) continue;
            const arr = byJob.get(jobId) ?? [];
            arr.push(obj.name);
            byJob.set(jobId, arr);
          }
        } else if (r && !r.ok) {
          stats.errors++;
          logger.warn('doc-ai sweep: object-storage list failed', { err: r?.error?.message });
        }
      } catch (e: any) {
        stats.errors++;
        logger.warn('doc-ai sweep: object-storage list threw', { err: e?.message });
      }

      stats.scanned = byJob.size;
      for (const [jobId, keys] of byJob) {
        // Age gate: never delete a blob younger than the grace window —
        // it might belong to a job whose ledger write is in flight.
        const ts = jobIdTimestampMs(jobId);
        if (Number.isFinite(ts) && now - ts < minAgeMs) {
          stats.skippedYoung++;
          continue;
        }
        // Ledger probe — distributed jobs (the only ones whose blobs
        // live in object storage) MUST use strict reads so a transient
        // Redis fault is distinguishable from "ledger truly absent". A
        // non-strict read would fall back to this pod's empty in-process
        // map during a Redis brown-out and we'd nuke live blobs whose
        // ledger entry is actually fine and just unreadable right now.
        let ledger: DocAiJobRecord | null = null;
        let ledgerReadable = true;
        try {
          ledger = await getJob(jobId, { strict: true });
        } catch (e: any) {
          ledgerReadable = false;
          stats.errors++;
          logger.warn('doc-ai sweep: ledger unreadable, skipping delete (preserving blob)', {
            jobId, err: e?.message,
          });
        }
        if (!ledgerReadable) continue;     // fail-closed: keep the blob
        if (ledger) continue;              // job still tracked → leave blobs alone
        stats.expired++;
        for (const key of keys) {
          try {
            await client.delete(key);
            stats.deleted++;
          } catch (e: any) {
            stats.errors++;
            logger.warn('doc-ai sweep: delete failed', { key, err: e?.message });
          }
        }
      }
    } else if (fs.existsSync(LOCAL_BLOB_DIR)) {
      stats.mode = 'local-disk';
      let entries: string[] = [];
      try { entries = await fs.promises.readdir(LOCAL_BLOB_DIR); } catch { entries = []; }
      stats.scanned = entries.length;
      for (const jobId of entries) {
        const jobDir = path.join(LOCAL_BLOB_DIR, jobId);
        let st: fs.Stats | null = null;
        try { st = await fs.promises.stat(jobDir); } catch { continue; }
        if (!st.isDirectory()) continue;
        // Prefer mtime for the local fallback (jobIds are tagged but the
        // file is the actual artifact we're cleaning).
        const ageMs = now - st.mtimeMs;
        if (ageMs < minAgeMs) { stats.skippedYoung++; continue; }
        let ledger: DocAiJobRecord | null = null;
        try { ledger = await getJob(jobId); } catch { ledger = null; }
        if (ledger) continue;
        stats.expired++;
        // rmdir recursively (source + result + the dir itself).
        try {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
          stats.deleted++;
        } catch (e: any) {
          stats.errors++;
          logger.warn('doc-ai sweep: local rm failed', { jobDir, err: e?.message });
        }
      }
    } else {
      // Neither object storage nor a local-blob dir — nothing to sweep.
      stats.mode = 'disabled';
    }
  } finally {
    stats.finishedAt = new Date().toISOString();
    stats.durationMs = Date.now() - startedAt;
    _lastSweepStats = stats;
    _sweepRunning = false;
  }
  if (stats.expired > 0 || stats.errors > 0) {
    logger.info('doc-ai sweep finished', stats as unknown as Record<string, unknown>);
  } else {
    logger.debug?.('doc-ai sweep finished (clean)', stats as unknown as Record<string, unknown>);
  }
  return stats;
}

/* ---------- mode probe ---------- */

export interface DocAiStoreMode {
  ledger: 'redis' | 'in-process';
  blob: 'object-storage' | 'local-disk';
  /** Both backends shared → true cross-pod survival of restarts + horizontal scale. */
  distributed: boolean;
  podId: string;
}

/**
 * Probe the live mode. `distributed` is only true when BOTH backends
 * pass a lightweight readiness check — a Redis PING (cheap, ~1 RTT) and
 * an object-storage client construction. Without these gates the route
 * would advertise `distributed:true` during a Redis brown-out and the
 * client would get an enqueued jobId whose ledger write silently failed.
 */
export async function getStoreMode(): Promise<DocAiStoreMode> {
  const redis = await getRedis();
  let redisOk = false;
  if (redis) {
    try {
      // 500 ms ping budget — if the broker is too slow to PING we treat
      // the ledger as not-ready and fall back to in-process for this
      // request rather than block the POST.
      await Promise.race([
        redis.ping(),
        new Promise<void>((_r, rej) => setTimeout(() => rej(new Error('ping-timeout')), 500)),
      ]);
      redisOk = true;
    } catch (e: any) {
      logger.warn('doc-ai ledger redis ping failed; treating as in-process for this request', { err: e?.message });
    }
  }
  const obj = await getObjectStore();
  return {
    ledger: redisOk ? 'redis' : 'in-process',
    blob: obj ? 'object-storage' : 'local-disk',
    distributed: redisOk && !!obj,
    podId: POD_ID,
  };
}

export function getPodId(): string { return POD_ID; }
