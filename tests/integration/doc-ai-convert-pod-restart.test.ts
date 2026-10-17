/**
 * tests/integration/doc-ai-convert-pod-restart.test.ts
 *
 * Task #134 (2026-05-11): regression coverage for the cross-pod survival
 * promise made by task #130. The /api/nv5/doc-ai/convert flow now lives
 * on three shared backends (BullMQ + Redis ledger + object storage) so:
 *
 *   (a) a pod restart mid-conversion does NOT 404 the jobId — another
 *       worker pod re-leases the job and finishes it, and the SAME jobId
 *       continues to resolve on the public route.
 *   (b) horizontal scale-out works — a jobId issued by pod A's POST
 *       resolves on pod B's GET /jobs/:id and GET /jobs/:id/result.
 *
 * Both properties are easy to break in a refactor of `bullmq-queue.ts`,
 * `doc-ai-job-store.ts`, `doc-ai-worker.ts`, or `convert-routes.ts`
 * (e.g. accidentally caching job state in process memory, swallowing
 * the stalled-job retry, using a per-pod blob path, or making the GET
 * handlers depend on the originating pod's in-memory map). This file
 * covers them at the **public HTTP API** layer with real moving parts:
 *
 *   - Real `redis-server` spawned on an ephemeral port (system dep
 *     installed via Nix). Both the job ledger AND the BullMQ broker
 *     point at it, exactly like prod.
 *   - Local-disk scratch under os.tmpdir() stands in for "shared object
 *     storage" because both simulated pods run on the same host during the
 *     test. In production, S3 is the shared backend.
 *   - The document converter is mocked to either hang forever (so we
 *     can force-close the worker mid-flight to simulate a pod crash)
 *     or succeed on retry. The conversion itself is not what's being
 *     tested — survival of the orchestration + route layer is.
 *   - Each "pod" is a fresh module graph + a fresh express app on its
 *     own port. POSTs and GETs go through the real router via fetch.
 *
 * NV-LLM-001 N/A — converter is pure, no provider call.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// tests/setup.ts globally stubs `ioredis` with a tiny in-memory shim that
// only implements ping/incr/multi — fine for unit tests, useless here
// because we're talking to a real redis-server. Restore the real module
// before any of the modules under test load it.
vi.unmock('ioredis');
vi.mock('ioredis', async (importOriginal) => await importOriginal<typeof import('ioredis')>());

// The /api/nv5/doc-ai/convert router enforces SDK-key auth via
// `requireSdkKeyStrict`, which does DB-backed key validation. None of
// that is what task-134 is testing — we want to hit the route's job
// orchestration directly. Replace the auth + safeError shims with
// pass-throughs so the test is hermetic.
vi.mock('../../src/routes/nv5/_auth.js', () => {
  const passThrough = (req: any, _res: any, next: any) => {
    req.sdkContext = { keyId: 'test-key', orgId: 1, scopes: ['*'] };
    next();
  };
  const safeError = (res: any, err: unknown, status = 500) => {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(typeof status === 'number' ? status : 500).json({ success: false, error: msg });
  };
  return {
    requireSdkKey: passThrough,
    requireSdkKeyStrict: passThrough,
    requireSdkKeyOnly: passThrough,
    requireScope: () => passThrough,
    safeError,
    delegateTo: () => passThrough,
  };
});

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';

/* ─── shared test scratch space ─────────────────────────────────────────── */

const G = globalThis as any;

/* ─── converter mock — hang/fail/ok controlled per-test via globalThis ── */

interface ConverterBehaviour {
  mode: 'ok' | 'hang' | 'fail-once';
  failed: boolean;
}
G.__JRX_TEST_CONVERTER_BEHAVIOUR ??= { mode: 'ok', failed: false } as ConverterBehaviour;
function setConverter(behaviour: Partial<ConverterBehaviour>): void {
  Object.assign(G.__JRX_TEST_CONVERTER_BEHAVIOUR, behaviour);
}

vi.mock('../../src/services/jrx-document-converter-service.js', () => {
  const isSupported = (_s: string, _t: string) => true;
  const getSupportedConversions = () => ({ txt: ['md'] });
  const conv = async (req: { sourcePath?: string }) => {
    const behave: ConverterBehaviour = G.__JRX_TEST_CONVERTER_BEHAVIOUR;
    const fsP = await import('node:fs/promises');
    const src = req.sourcePath ? await fsP.readFile(req.sourcePath, 'utf8') : '';
    if (behave.mode === 'hang') {
      await new Promise<never>(() => { /* never resolves; test force-closes worker */ });
    }
    if (behave.mode === 'fail-once' && !behave.failed) {
      behave.failed = true;
      throw new Error('simulated transient failure');
    }
    const out = Buffer.from(`# Converted\n\n${src}\n`, 'utf8');
    return {
      success: true,
      outputBuffer: out,
      sizeBytes: out.length,
      mimeType: 'text/markdown',
      fileName: 'converted.md',
      conversionMs: 1,
    };
  };
  return {
    nvDocumentConverter: { convert: conv, isSupported, getSupportedConversions },
  };
});

/* ─── helpers ─────────────────────────────────────────────────────────── */

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForRedis(host: string, port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createConnection({ host, port });
        const done = (err?: Error) => {
          sock.removeAllListeners();
          try { sock.destroy(); } catch { /* */ }
          err ? reject(err) : resolve();
        };
        sock.once('connect', () => {
          sock.once('data', (buf) => {
            const s = buf.toString('utf8');
            done(s.startsWith('+PONG') ? undefined : new Error(`unexpected reply: ${s}`));
          });
          sock.write('*1\r\n$4\r\nPING\r\n');
        });
        sock.once('error', done);
        sock.setTimeout(1_000, () => done(new Error('socket timeout')));
      });
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  throw new Error(`redis at ${host}:${port} never came up: ${(lastErr as Error)?.message}`);
}

async function waitForJob(
  baseUrl: string,
  jobId: string,
  predicate: (status: string) => boolean,
  timeoutMs: number,
): Promise<any> {
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${baseUrl}/api/nv5/doc-ai/convert/jobs/${jobId}`);
    if (r.ok) {
      last = await r.json();
      if (last?.job?.status && predicate(last.job.status)) return last.job;
    } else {
      last = { _httpStatus: r.status, _body: await r.text().catch(() => '') };
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`waitForJob(${jobId}) timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}`);
}

interface Pod {
  podId: string;
  baseUrl: string;
  server: import('node:http').Server;
  store: typeof import('../../src/services/queue/doc-ai-job-store.js');
  queue: typeof import('../../src/services/queue/bullmq-queue.js');
  worker: typeof import('../../src/services/queue/doc-ai-worker.js');
  shutdown: () => Promise<void>;
}

async function bootPod(podId: string): Promise<Pod> {
  // Fresh module graph so the job-store, queue, AND route singletons all
  // pick up the env we set in beforeAll AND get a different POD_ID.
  vi.resetModules();
  process.env.HOSTNAME = podId;

  const expressMod = await import('express');
  const express = (expressMod as any).default ?? expressMod;
  const route = (await import('../../src/routes/nv5/doc-ai/convert-routes.js')).default;
  const store = await import('../../src/services/queue/doc-ai-job-store.js');
  const queue = await import('../../src/services/queue/bullmq-queue.js');
  const worker = await import('../../src/services/queue/doc-ai-worker.js');

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/nv5/doc-ai/convert', route);

  const port = await getFreePort();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });

  return {
    podId,
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    store,
    queue,
    worker,
    shutdown: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function postConvert(
  baseUrl: string,
  payload: { sourceFormat: string; targetFormat: string; fileBytes: Buffer; filename?: string },
): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  fd.append('sourceFormat', payload.sourceFormat);
  fd.append('targetFormat', payload.targetFormat);
  fd.append('file', new Blob([payload.fileBytes]), payload.filename ?? 'input.txt');
  const r = await fetch(`${baseUrl}/api/nv5/doc-ai/convert/jobs`, { method: 'POST', body: fd });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: r.status, body };
}

/* ─── shared test fixtures ────────────────────────────────────────────── */

let redisProc: ChildProcessWithoutNullStreams | null = null;
let redisPort = 0;
let redisUrl = '';
let redisDataDir = '';

beforeAll(async () => {
  redisPort = await getFreePort();
  redisDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrx-test-redis-'));
  redisProc = spawn(
    'redis-server',
    [
      '--port', String(redisPort),
      '--dir', redisDataDir,
      '--save', '',
      '--appendonly', 'no',
      '--bind', '127.0.0.1',
      '--protected-mode', 'no',
      '--daemonize', 'no',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  redisProc.on('error', (e) => console.error('redis-server spawn error:', e));
  redisUrl = `redis://127.0.0.1:${redisPort}/0`;
  await waitForRedis('127.0.0.1', redisPort);

  // Set env BEFORE the modules under test load.
  process.env.JRX_REDIS_TCP_URL = redisUrl;
  // No object storage credentials → doc-ai-job-store falls back to local-disk
  // staging. Both simulated pods share the same host /tmp, so this satisfies
  // the cross-pod survival test on a single machine.
  process.env.JRX_DOC_AI_BLOB_PREFIX = `temp/doc-ai-test-${Date.now()}`;
  process.env.JRX_DOC_AI_JOB_TTL_SEC = '600';
}, 30_000);

afterAll(async () => {
  if (redisProc && !redisProc.killed) {
    redisProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!redisProc.killed) redisProc.kill('SIGKILL');
  }
  try { fs.rmSync(redisDataDir, { recursive: true, force: true }); } catch { /* */ }
}, 10_000);

/* ─── tests ───────────────────────────────────────────────────────────── */

describe('doc-ai converter survives a pod restart end-to-end (HTTP)', () => {
  it('POST → kill worker mid-flight → restart worker → SAME jobId polls done → result downloads', async () => {
    setConverter({ mode: 'hang', failed: false });

    const pod = await bootPod('pod-restart-test');
    const { Worker } = await import('bullmq');
    const { Redis } = await import('ioredis');
    let wA: import('bullmq').Worker | null = null;
    let wB: import('bullmq').Worker | null = null;
    let connA: import('ioredis').Redis | null = null;
    let connB: import('ioredis').Redis | null = null;

    try {
      // Sanity: distributed mode must be live, otherwise we'd silently
      // exercise the in-process legacy path.
      const mode = await pod.store.getStoreMode();
      expect(mode.distributed).toBe(true);
      expect(mode.ledger).toBe('redis');
      expect(pod.queue.isQueueLive()).toBe(true);

      // ── workerA: hangs forever on first attempt. Each Worker gets its
      //    OWN ioredis connection so closing one doesn't disrupt the
      //    queue's connection or workerB. lockDuration short so the
      //    stalled-job timer fires quickly after force-close.
      connA = new Redis(redisUrl, { maxRetriesPerRequest: null });
      wA = new Worker(
        pod.queue.QueueNames.DOC_AI_CONVERT,
        async (job) => pod.worker.handleDocAiConvert(job.data as { jobId: string }, job),
        { connection: connA, concurrency: 1, lockDuration: 2_000, stalledInterval: 1_000 },
      );

      // ── client POSTs the conversion through the public HTTP route ──
      const sourceBytes = Buffer.from('Hello pod-restart world.\n', 'utf8');
      const post = await postConvert(pod.baseUrl, {
        sourceFormat: 'txt',
        targetFormat: 'md',
        fileBytes: sourceBytes,
      });
      expect(post.status).toBe(200);
      expect(post.body?.success).toBe(true);
      expect(post.body?.mode).toBe('distributed');
      const jobId: string = post.body.jobId;
      expect(typeof jobId).toBe('string');
      expect(jobId.startsWith('doc_dist_')).toBe(true);

      // The route should return 200 from GETs throughout — this proves
      // the jobId never 404s, which is the regression task-130 fixed.
      // Wait until workerA actually leases it.
      await waitForJob(pod.baseUrl, jobId, (s) => s === 'running', 8_000);

      // ── kill workerA mid-flight ──
      // close(true) = force; the active job is abandoned and its lock
      // expires after lockDuration → BullMQ moves it back to wait via
      // the stalled-job mechanism.
      await wA.close(true);
      try { await connA.quit(); } catch { /* */ }
      wA = null;
      connA = null;

      // While "no worker is alive", the GET must STILL return 200 with
      // the same jobId — the route reads from the shared ledger, not
      // from any in-memory state of the (now-dead) worker. This is the
      // exact regression we are guarding against.
      const midResp = await fetch(`${pod.baseUrl}/api/nv5/doc-ai/convert/jobs/${jobId}`);
      expect(midResp.status).toBe(200);
      const midBody = await midResp.json();
      expect(midBody.job.id).toBe(jobId);

      // ── workerB starts up: should pick the job up (via stalled-job
      //    recovery) and finish it ──
      setConverter({ mode: 'ok', failed: false });
      connB = new Redis(redisUrl, { maxRetriesPerRequest: null });
      wB = new Worker(
        pod.queue.QueueNames.DOC_AI_CONVERT,
        async (job) => pod.worker.handleDocAiConvert(job.data as { jobId: string }, job),
        { connection: connB, concurrency: 1, lockDuration: 30_000, stalledInterval: 5_000 },
      );

      const finalJob = await waitForJob(
        pod.baseUrl, jobId, (s) => s === 'done' || s === 'failed', 30_000,
      );
      expect(finalJob.status).toBe('done');
      expect(finalJob.bytesOut).toBeGreaterThan(0);

      // ── result download via the public route ──
      const resultResp = await fetch(`${pod.baseUrl}/api/nv5/doc-ai/convert/jobs/${jobId}/result`);
      expect(resultResp.status).toBe(200);
      expect(resultResp.headers.get('content-type')).toContain('text/markdown');
      const resultText = await resultResp.text();
      expect(resultText).toContain('Hello pod-restart world.');
      expect(resultText.startsWith('# Converted')).toBe(true);

      await pod.store.cleanup(jobId).catch(() => { /* */ });
    } finally {
      if (wA) { await wA.close(true).catch(() => {}); }
      if (wB) { await wB.close().catch(() => {}); }
      if (connA) { try { await connA.quit(); } catch { /* */ } }
      if (connB) { try { await connB.quit(); } catch { /* */ } }
      await pod.shutdown();
    }
  }, 60_000);

  it('jobId from pod A POST resolves on pod B GET /jobs/:id and /jobs/:id/result', async () => {
    setConverter({ mode: 'ok', failed: false });

    // ── pod A: POST + run worker to completion ──
    const podA = await bootPod('pod-a-http-test');
    const { Worker } = await import('bullmq');
    const { Redis } = await import('ioredis');
    const connA = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const wA = new Worker(
      podA.queue.QueueNames.DOC_AI_CONVERT,
      async (job) => podA.worker.handleDocAiConvert(job.data as { jobId: string }, job),
      { connection: connA, concurrency: 1, lockDuration: 30_000 },
    );

    let jobId = '';
    let podABytesOut = 0;
    try {
      const sourceBytes = Buffer.from('cross-pod payload\n', 'utf8');
      const post = await postConvert(podA.baseUrl, {
        sourceFormat: 'txt', targetFormat: 'md', fileBytes: sourceBytes,
      });
      expect(post.status).toBe(200);
      expect(post.body?.mode).toBe('distributed');
      jobId = post.body.jobId;
      expect(jobId.startsWith('doc_dist_')).toBe(true);

      const doneA = await waitForJob(
        podA.baseUrl, jobId, (s) => s === 'done' || s === 'failed', 20_000,
      );
      expect(doneA.status).toBe('done');
      expect(doneA.executedByPod).toContain('pod-a-http-test');
      podABytesOut = doneA.bytesOut;
    } finally {
      await wA.close().catch(() => {});
      try { await connA.quit(); } catch { /* */ }
    }

    // ── pod B: brand-new module graph + brand-new express app on its
    //    own port. The Redis URL + the in-memory blob map are SHARED,
    //    faithfully simulating "another pod with no in-process knowledge
    //    of the job receives the polling request". ──
    await podA.shutdown();
    const podB = await bootPod('pod-b-http-test');
    expect(podB.podId).not.toBe(podA.podId);

    try {
      // GET /jobs/:id on pod B — proves cross-pod ledger lookup.
      const r1 = await fetch(`${podB.baseUrl}/api/nv5/doc-ai/convert/jobs/${jobId}`);
      expect(r1.status).toBe(200);
      const j1 = await r1.json();
      expect(j1.success).toBe(true);
      expect(j1.job.id).toBe(jobId);
      expect(j1.job.status).toBe('done');
      expect(j1.job.bytesOut).toBe(podABytesOut);
      expect(j1.job.executedByPod).toContain('pod-a-http-test');
      expect(j1.job.acceptedByPod).toContain('pod-a-http-test');

      // GET /jobs/:id/result on pod B — proves cross-pod blob lookup.
      const r2 = await fetch(`${podB.baseUrl}/api/nv5/doc-ai/convert/jobs/${jobId}/result`);
      expect(r2.status).toBe(200);
      expect(r2.headers.get('content-type')).toContain('text/markdown');
      const resultText = await r2.text();
      expect(resultText).toContain('cross-pod payload');
      expect(resultText.startsWith('# Converted')).toBe(true);

      await podB.store.cleanup(jobId).catch(() => { /* */ });
    } finally {
      await podB.shutdown();
    }
  }, 60_000);
});
