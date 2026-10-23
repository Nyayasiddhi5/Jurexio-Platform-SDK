// /api/nv5/doc-ai/convert/* — Document conversion (JRX_F_DOC_AI_CONVERT).
//
// Async job pattern (per task-100.md step 4):
//   POST /jobs  (multipart with file=… OR { sourceBase64, sourceFormat })
//        → returns { jobId, status: 'queued' }
//   GET  /jobs/:id        → poll job status (queued/running/done/failed)
//   GET  /jobs/:id/result → download converted bytes (mimeType from converter)
//   GET  /supported       → list { source: target[] } supported pairs
//
// JRX-WIRING-BUDGET-001 Session-11 (2026-05-10): refactored from
// memoryStorage → diskStorage so multer streams the multipart body straight
// to a tmp file instead of buffering up to 1 GB in RSS during parse.
//
// task-106 (2026-05-11): the converter library now accepts a path (not just
// a Buffer) and per-format extractors prefer path-based parsers (mammoth
// path, XLSX.readFile, streaming utf-8 read) so the whole tmp file never
// lands in RSS ahead of the parser. The route hands the tmp file PATH
// straight through; we never call fs.readFile here.
//
// task-130 (2026-05-11): job state moved off-pod. The job ledger lives in
// Redis (24h TTL) keyed by jobId, source + result bytes live in Replit
// Object Storage, and the conversion runs through the BullMQ queue
// `jrx-doc-ai-convert`. Net effect:
//   • a pod restart mid-conversion → BullMQ re-leases the job to any live
//     worker; the client's jobId is still resolvable.
//   • horizontal scale-out → /jobs/:id and /jobs/:id/result resolve from
//     ANY pod (read shared Redis + shared object storage).
//   • concurrency cap is now GLOBAL (JRX_WORKER_DOC_AI_CONVERT_CONCURRENCY)
//     because BullMQ leases jobs cluster-wide, instead of per-pod
//     JRX_DOC_CONVERT_CONCURRENCY × pod count.
// When BullMQ or object storage is unavailable (dev / no Redis), the
// route falls back to the previous in-process Map + bounded-concurrency
// dispatcher so single-pod dev keeps working. POST responses include
// `mode: 'distributed' | 'in-process'` so callers can verify which mode
// they got.
//
// task-129 (2026-05-11): the OUTPUT side now spills to a tmp file above
// JRX_DOC_CONVERT_OUTPUT_DISK_THRESHOLD_BYTES (default 1 MiB) — see the
// converter service. The legacy in-process /jobs/:id/result streams
// that file via fs.createReadStream(...).pipe(res) instead of
// `res.send(buffer)`, and gcLegacyJobs() unlinks the output tmp file
// when the job ages out. Below the threshold the original buffer path
// is preserved. (Distributed mode goes through object storage, so the
// disk-spill optimisation only applies to the legacy fallback.)
// The converter itself is pure — no LLM, no provider call, NV-LLM-001 N/A.
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { nvDocumentConverter, type SourceFormat, type TargetFormat, type ConversionOptions } from '../../../services/jrx-document-converter-service.js';
import { requireSdkKeyStrict as requireSdkKey, safeError } from '../_auth.js';
import {
  createJob as ledgerCreateJob,
  getJob as ledgerGetJob,
  putSourceFromPath,
  putSourceFromBytes,
  getResultBytes,
  getStoreMode,
  cleanup as ledgerCleanup,
  getLastSweepStats,
  type DocAiJobRecord,
} from '../../../services/queue/doc-ai-job-store.js';
import { enqueueDocAiConvert, isQueueLive, type DisabledQueueResult } from '../../../services/queue/bullmq-queue.js';

/**
 * Job-ID prefixes encode the execution mode at creation time so polls
 * and the worker know — without consulting a (potentially flapping)
 * runtime mode probe — whether the ledger is the source of truth for a
 * given job. Distributed jobs MUST use strict ledger reads on every
 * lookup; in-process jobs MUST NOT touch the ledger at all.
 */
const DIST_JOB_PREFIX = 'doc_dist_';
const INP_JOB_PREFIX = 'doc_inp_';
function isDistributedJobId(id: string): boolean { return id.startsWith(DIST_JOB_PREFIX); }
function isInProcessJobId(id: string): boolean { return id.startsWith(INP_JOB_PREFIX); }

/** Typed guard for `enqueueDocAiConvert`'s union return — avoids `as any`. */
function isDisabledQueueResult(v: unknown): v is DisabledQueueResult {
  return !!v && typeof v === 'object' && (v as { disabled?: unknown }).disabled === true;
}

const ONE_GB = 1024 * 1024 * 1024;
const NV_TMP_DIR = path.join(os.tmpdir(), 'jrx-doc-ai-uploads');
try { fs.mkdirSync(NV_TMP_DIR, { recursive: true }); } catch { /* best-effort */ }

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, NV_TMP_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 80);
      cb(null, `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
    },
  }),
  limits: { fileSize: ONE_GB },
});

/**
 * Multer error-handling middleware. If multer rejects (LIMIT_FILE_SIZE,
 * malformed multipart, fileFilter), the per-route handler never runs and
 * any partially-written tmp file would leak. Unlink first, then return JSON.
 */
function uploadErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (!err) return next();
  const tmpPath = (req.file as { path?: string } | undefined)?.path;
  if (tmpPath) {
    fs.promises.unlink(tmpPath).catch(() => { /* best-effort cleanup */ });
  }
  const code = (err as { code?: string }).code;
  const status = code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  return safeError(res, err, status);
}

/* ─── In-process fallback dispatcher (legacy path, kept for dev / no-Redis) ─── */

type LegacyJobStatus = 'queued' | 'running' | 'done' | 'failed';
interface LegacyDocJob {
  id: string;
  status: LegacyJobStatus;
  sourceFormat: SourceFormat;
  targetFormat: TargetFormat;
  bytesIn: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: Awaited<ReturnType<typeof nvDocumentConverter.convert>>;
  error?: string;
  tmpPath?: string;
}

const legacyJobs = new Map<string, LegacyDocJob>();
const LEGACY_JOB_TTL_MS = 10 * 60 * 1000;

const CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.JRX_DOC_CONVERT_CONCURRENCY ?? '4', 10) || 4,
);
let inFlight = 0;
const waiters: Array<() => void> = [];
async function acquireSlot(): Promise<void> {
  if (inFlight < CONCURRENCY) { inFlight++; return; }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}
function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

function gcLegacyJobs(): void {
  const cutoff = Date.now() - LEGACY_JOB_TTL_MS;
  for (const [id, j] of legacyJobs.entries()) {
    const when = (j.completedAt ?? j.createdAt).getTime();
    if (when < cutoff) {
      // task-129: when the converter spilled the output to disk, unlink the
      // tmp file so an expired job doesn't leak it. The buffer-only path
      // has no extra cleanup — GC of the Map entry releases the heap.
      const outPath = j.result?.outputPath;
      if (outPath) {
        fs.promises.unlink(outPath).catch(() => { /* best-effort */ });
      }
      legacyJobs.delete(id);
    }
  }
}

function legacyEnqueueFromDisk(job: LegacyDocJob, options: ConversionOptions | undefined): void {
  void (async () => {
    await acquireSlot();
    try {
      job.status = 'running';
      job.startedAt = new Date();
      if (!job.tmpPath) throw new Error('job missing tmpPath');
      const result = await nvDocumentConverter.convert({
        sourcePath: job.tmpPath,
        sourceFormat: job.sourceFormat,
        targetFormat: job.targetFormat,
        options,
      });
      job.result = result;
      job.status = result.success ? 'done' : 'failed';
      job.error = result.error;
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.completedAt = new Date();
      if (job.tmpPath) {
        fs.promises.unlink(job.tmpPath).catch(() => { /* best-effort */ });
        job.tmpPath = undefined;
      }
      gcLegacyJobs();
      releaseSlot();
    }
  })();
}

/* ─── routes ─── */

const router = Router();

router.get('/health', requireSdkKey, async (_req: Request, res: Response) => {
  const mode = await getStoreMode().catch(() => null);
  res.json({
    success: true,
    service: './jrx-document-converter',
    distributedMode: !!mode?.distributed,
    storeMode: mode,
    queueLive: isQueueLive(),
    activeLegacyJobs: legacyJobs.size,
    podId: mode?.podId,
    // task-133: surface the most recent blob-sweep summary so operators
    // can see how many orphaned blobs were swept in the last run without
    // having to grep logs. `null` until the first sweep completes.
    lastBlobSweep: getLastSweepStats(),
  });
});

router.get('/supported', requireSdkKey, (_req: Request, res: Response) => {
  try {
    res.json({ success: true, supported: nvDocumentConverter.getSupportedConversions() });
  } catch (e) { safeError(res, e); }
});

router.post('/jobs', requireSdkKey, upload.single('file'), uploadErrorHandler, async (req: Request, res: Response) => {
  const tmpPath = (req.file as { path?: string } | undefined)?.path;
  let workingTmpPath: string | undefined = tmpPath;
  let workingTmpIsB64Staged = false;

  try {
    const sourceFormat = String(req.body?.sourceFormat ?? '').toLowerCase() as SourceFormat;
    const targetFormat = String(req.body?.targetFormat ?? '').toLowerCase() as TargetFormat;
    if (!sourceFormat || !targetFormat) {
      if (tmpPath) fs.promises.unlink(tmpPath).catch(() => {});
      return safeError(res, '`sourceFormat` and `targetFormat` are required form fields', 400);
    }
    if (!nvDocumentConverter.isSupported(sourceFormat, targetFormat)) {
      if (tmpPath) fs.promises.unlink(tmpPath).catch(() => {});
      return safeError(res, `unsupported conversion: ${sourceFormat} → ${targetFormat}`, 400);
    }

    let bytesIn = 0;
    let b64Buffer: Buffer | null = null;
    if (tmpPath && req.file?.size) {
      bytesIn = req.file.size;
    } else if (typeof req.body?.sourceBase64 === 'string') {
      b64Buffer = Buffer.from(req.body.sourceBase64, 'base64');
      bytesIn = b64Buffer.length;
      // Stage to disk so the legacy path has a tmpPath; the distributed
      // path streams from the buffer directly into object storage and
      // doesn't need this. We still write it for the legacy fallback.
      workingTmpPath = path.join(NV_TMP_DIR, `${Date.now()}_${process.pid}_b64_${Math.random().toString(36).slice(2, 8)}`);
      fs.writeFileSync(workingTmpPath, b64Buffer);
      workingTmpIsB64Staged = true;
    }
    if ((!workingTmpPath && !b64Buffer) || bytesIn === 0) {
      return safeError(res, 'either multipart `file` or JSON `sourceBase64` is required', 400);
    }

    const parseOpts = (raw: unknown): ConversionOptions | undefined => {
      if (raw && typeof raw === 'object') return raw as ConversionOptions;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          return parsed && typeof parsed === 'object' ? (parsed as ConversionOptions) : undefined;
        } catch { return undefined; }
      }
      return undefined;
    };
    const options = parseOpts(req.body?.options);

    // Decide mode. Distributed requires BOTH the BullMQ queue and the
    // shared blob/ledger backends. If either is missing, fall back to
    // legacy in-process so single-pod dev keeps working.
    const mode = await getStoreMode();
    const distributed = mode.distributed && isQueueLive();

    // Encode the execution mode in the jobId itself so polls can decide
    // strict-vs-non-strict ledger reads WITHOUT depending on a
    // request-time `getStoreMode()` probe (which can flap during a Redis
    // brown-out and cause cross-pod false 404s — exactly the failure
    // class this task removes). `dist_` ⇒ ledger is the source of truth
    // for this job, must read strict; `inp_` ⇒ legacy in-memory only.
    const idPrefix = distributed ? DIST_JOB_PREFIX : INP_JOB_PREFIX;
    const id = `${idPrefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    if (distributed) {
      // Push the source bytes to object storage, then enqueue. We do this
      // BEFORE replying so the client can never see a queued jobId whose
      // source blob is missing.
      try {
        if (b64Buffer) {
          await putSourceFromBytes(id, b64Buffer);
        } else if (workingTmpPath) {
          await putSourceFromPath(id, workingTmpPath);
        }
      } catch (e) {
        if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});
        return safeError(res, e);
      }

      const record: DocAiJobRecord = {
        id,
        status: 'queued',
        sourceFormat,
        targetFormat,
        bytesIn,
        createdAt: new Date().toISOString(),
        optionsJson: options ? JSON.stringify(options) : undefined,
      };
      // STRICT ledger write — fail-closed. If the Redis write throws,
      // we MUST NOT silently fall back to the in-process map: workers
      // on other pods would 404 the job (the route already promised
      // mode:distributed) and the client would see a phantom jobId.
      // Translate to 503 + cleanup the source blob we just uploaded.
      try {
        await ledgerCreateJob(record, { strict: true });
      } catch (ledgerErr) {
        await ledgerCleanup(id); // removes source blob; ledger entry never landed
        if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});
        return safeError(res, ledgerErr, 503);
      }
      // Transactional-ish: any failure between ledger-create and a
      // successful enqueue (returned-disabled OR thrown) MUST tear down
      // the ledger entry + uploaded source blob, otherwise we leak a
      // stale `queued` job that no worker will ever pick up.
      try {
        const enq = await enqueueDocAiConvert({ jobId: id });
        // Typed disabled-marker check — no `as any`. enqueueDocAiConvert
        // returns either a BullMQ `Job` (has numeric/string id) or a
        // `DisabledQueueResult { disabled: true }` when the queue is off.
        if (isDisabledQueueResult(enq)) {
          await ledgerCleanup(id);
          if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});
          return safeError(res, 'queue unavailable', 503);
        }
      } catch (enqErr) {
        await ledgerCleanup(id);
        if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});
        return safeError(res, enqErr, 503);
      }
      // We've handed the source to object storage; the multer tmp file is
      // no longer needed on this pod.
      if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});

      return res.json({
        success: true,
        jobId: id,
        status: 'queued',
        bytesIn,
        mode: 'distributed',
        ledger: mode.ledger,
        blob: mode.blob,
      });
    }

    // ── legacy in-process path ──
    const job: LegacyDocJob = {
      id, status: 'queued', sourceFormat, targetFormat,
      bytesIn, createdAt: new Date(),
      tmpPath: workingTmpPath,
    };
    legacyJobs.set(id, job);
    legacyEnqueueFromDisk(job, options);
    return res.json({
      success: true,
      jobId: id,
      status: job.status,
      bytesIn: job.bytesIn,
      mode: 'in-process',
      ledger: mode.ledger,
      blob: mode.blob,
    });
  } catch (e) {
    if (workingTmpPath) fs.promises.unlink(workingTmpPath).catch(() => {});
    if (workingTmpIsB64Staged && workingTmpPath) {
      fs.promises.unlink(workingTmpPath).catch(() => {});
    }
    safeError(res, e);
  }
});

router.get('/jobs/:id', requireSdkKey, async (req: Request, res: Response) => {
  // Try the distributed ledger first; it's the source of truth when the
  // job was created in distributed mode. Fall back to the legacy map for
  // jobs created on this pod in in-process mode.
  const jobId = String(req.params.id);
  // The jobId prefix encodes the execution mode at creation time, so
  // poll routing is deterministic and immune to live mode-probe flap:
  //   • dist_ → ledger is the source of truth; ALWAYS strict-read; a
  //     Redis fault on this path returns 503, never a false 404 from
  //     peeking at the (other-pod) local map.
  //   • inp_  → legacy in-memory only on the originating pod; never
  //     touch the ledger.
  let ledgered: Awaited<ReturnType<typeof ledgerGetJob>> = null;
  if (isDistributedJobId(jobId)) {
    try {
      ledgered = await ledgerGetJob(jobId, { strict: true });
    } catch (e) {
      return safeError(res, e, 503);
    }
    if (!ledgered) return safeError(res, `job not found: ${jobId}`, 404);
  } else if (!isInProcessJobId(jobId)) {
    // Untagged ID (e.g. an old jobId from before this rollout). Try the
    // ledger non-strict so we get backward compatibility, then fall
    // through to the legacy map.
    ledgered = await ledgerGetJob(jobId).catch(() => null);
  }
  if (ledgered) {
    return res.json({
      success: true,
      job: {
        id: ledgered.id,
        status: ledgered.status,
        sourceFormat: ledgered.sourceFormat,
        targetFormat: ledgered.targetFormat,
        bytesIn: ledgered.bytesIn,
        bytesOut: ledgered.bytesOut,
        conversionMs: ledgered.conversionMs,
        createdAt: ledgered.createdAt,
        startedAt: ledgered.startedAt,
        completedAt: ledgered.completedAt,
        error: ledgered.error,
        acceptedByPod: ledgered.acceptedByPod,
        executedByPod: ledgered.executedByPod,
      },
    });
  }
  const j = legacyJobs.get(jobId);
  if (!j) return safeError(res, `job not found: ${jobId}`, 404);
  res.json({
    success: true,
    job: {
      id: j.id, status: j.status,
      sourceFormat: j.sourceFormat, targetFormat: j.targetFormat,
      bytesIn: j.bytesIn,
      bytesOut: j.result?.sizeBytes,
      conversionMs: j.result?.conversionMs,
      createdAt: j.createdAt, startedAt: j.startedAt, completedAt: j.completedAt,
      error: j.error,
    },
  });
});

router.get('/jobs/:id/result', requireSdkKey, async (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  // Prefix-driven mode routing — same rationale as GET /jobs/:id.
  // Distributed jobIds always strict-read the ledger (Redis fault →
  // 503, never local fallback to a stale shadow); in-process jobIds
  // skip the ledger entirely; untagged legacy IDs fall back non-strict
  // for backward compatibility. (Object storage delivers a Buffer —
  // distributed mode doesn't benefit from the legacy disk-spill
  // optimisation, since the bytes already round-tripped through object
  // storage.)
  let ledgered: Awaited<ReturnType<typeof ledgerGetJob>> = null;
  if (isDistributedJobId(jobId)) {
    try {
      ledgered = await ledgerGetJob(jobId, { strict: true });
    } catch (e) {
      return safeError(res, e, 503);
    }
    if (!ledgered) return safeError(res, `job not found: ${jobId}`, 404);
  } else if (!isInProcessJobId(jobId)) {
    ledgered = await ledgerGetJob(jobId).catch(() => null);
  }
  if (ledgered) {
    if (ledgered.status !== 'done') {
      return safeError(res, `job not complete (status=${ledgered.status})`, 409);
    }
    let buf: Buffer | null = null;
    try {
      buf = await getResultBytes(jobId);
    } catch (e) {
      // Blob store unavailable — distinct from "blob actually missing".
      return safeError(res, e, 503);
    }
    if (!buf) {
      return safeError(res, 'job marked done but result blob is missing', 410);
    }
    res.setHeader('Content-Type', ledgered.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ledgered.fileName || 'converted.bin'}"`);
    return res.send(buf);
  }
  // Legacy in-process path retains task-129 disk-streaming for the
  // converter's spill-to-disk output.
  const j = legacyJobs.get(jobId);
  if (!j) return safeError(res, `job not found: ${jobId}`, 404);
  if (j.status !== 'done' || !j.result || (!j.result.outputBuffer && !j.result.outputPath)) {
    return safeError(res, `job not complete (status=${j.status})`, 409);
  }
  res.setHeader('Content-Type', j.result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${j.result.fileName}"`);
  if (typeof j.result.sizeBytes === 'number') {
    res.setHeader('Content-Length', String(j.result.sizeBytes));
  }
  // task-129: if the converter spilled the output to disk, stream from the
  // tmp file so the converted document never gets copied through the heap
  // again on send. We DO NOT unlink here — the file is owned by the job
  // and lives until JOB_TTL_MS so the client may re-fetch within the
  // window. gcJobs() unlinks on TTL expiry.
  if (j.result.outputPath) {
    const stream = fs.createReadStream(j.result.outputPath);
    stream.on('error', (err) => {
      if (!res.headersSent) {
        safeError(res, err, 500);
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
    return;
  }
  res.send(j.result.outputBuffer);
});

export default router;
