// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — Admin Heap Snapshot route
 * NYV-NS-013  ·  P2 G1  ·  2026-05-01
 *
 * POST /api/jrx/admin/heap          → write a v8 heap snapshot, return path
 * GET  /api/jrx/admin/heap/list     → list previously-taken snapshots
 * GET  /api/jrx/admin/heap/:file    → stream a snapshot file (super_admin only)
 *
 * Security
 * --------
 *   - authenticateToken + requireAdmin (mounted in src/index.ts)
 *   - Additionally enforces user.role === 'super_admin' inline; plain admins
 *     can hit the endpoint but receive 403. Heap snapshots can leak secrets,
 *     PII, and JWTs and must never be exposed below super_admin.
 *   - Filenames are validated to prevent directory traversal.
 *   - Rate-limited to one snapshot every 60 seconds across the process.
 *
 * Storage
 * -------
 *   Snapshots are written under `process.env.NYV_HEAP_DIR` if set, else
 *   `./.local/heapdumps/`. The directory is auto-created.
 */

import { Router, Request, Response } from 'express';
import * as v8 from 'node:v8';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/jrx-auth.js';

const logger = createLogger('./jrx-admin-heap');
const router = Router();

const HEAP_DIR = process.env.NYV_HEAP_DIR
  ? path.resolve(process.env.NYV_HEAP_DIR)
  : path.resolve(process.cwd(), '.local', 'heapdumps');

const MIN_INTERVAL_MS = 60_000;
let lastSnapshotAt = 0;
// Atomic in-flight guard: prevents two concurrent POSTs from both passing
// the rate-limit check before either updates `lastSnapshotAt`. Heap snapshots
// are blocking and expensive — overlapping them is never desired.
let snapshotInFlight = false;

function ensureHeapDir(): void {
  if (!fs.existsSync(HEAP_DIR)) {
    fs.mkdirSync(HEAP_DIR, { recursive: true });
  }
}

function requireSuperAdmin(req: Request, res: Response): boolean {
  const user = (req as AuthRequest).user;
  if (!user || user.role !== 'super_admin') {
    res.status(403).json({
      success: false,
      message: 'super_admin role required for heap operations',
      code: 'SUPER_ADMIN_REQUIRED',
    });
    return false;
  }
  return true;
}

function safeFileName(name: string): string | null {
  // Only basename, only [A-Za-z0-9._-], must end with .heapsnapshot
  const base = path.basename(name);
  if (base !== name) return null;
  if (!/^[A-Za-z0-9._-]+\.heapsnapshot$/.test(base)) return null;
  return base;
}

router.post('/', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const now = Date.now();
  // Atomic claim: check time gate AND in-flight flag together, then flip
  // the flag synchronously before any await. The flag is reset in finally.
  if (snapshotInFlight) {
    res.status(429).json({
      success: false,
      message: 'A heap snapshot is already in progress',
      code: 'HEAP_IN_FLIGHT',
    });
    return;
  }
  if (now - lastSnapshotAt < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (now - lastSnapshotAt);
    res.status(429).json({
      success: false,
      message: `Heap snapshots are rate-limited. Try again in ${Math.ceil(waitMs / 1000)}s`,
      code: 'HEAP_RATE_LIMITED',
    });
    return;
  }
  snapshotInFlight = true;

  try {
    ensureHeapDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `nyv-${stamp}-pid${process.pid}.heapsnapshot`;
    const fullPath = path.join(HEAP_DIR, filename);

    // v8.writeHeapSnapshot blocks the event loop while serializing;
    // log before + after so SREs can correlate any latency spike.
    logger.warn(`[NYV-NS-013] Heap snapshot starting → ${fullPath}`);
    const written = v8.writeHeapSnapshot(fullPath);
    lastSnapshotAt = Date.now();
    const stat = fs.statSync(written);
    logger.warn(`[NYV-NS-013] Heap snapshot complete (${stat.size} bytes)`);

    const heap = v8.getHeapStatistics();
    // NOTE: do NOT return the absolute filesystem path. Even though the route
    // is super_admin gated, leaking the on-disk layout enlarges the blast
    // radius (logs, screenshots, etc.). Clients use the downloadUrl + file.
    res.json({
      success: true,
      file: filename,
      sizeBytes: stat.size,
      heap: {
        used: heap.used_heap_size,
        total: heap.total_heap_size,
        limit: heap.heap_size_limit,
      },
      downloadUrl: `/api/jrx/admin/heap/${filename}`,
    });
  } catch (err: any) {
    logger.error(`[NYV-NS-013] Heap snapshot failed: ${err?.message || err}`);
    res.status(500).json({
      success: false,
      message: 'Heap snapshot failed',
      code: 'HEAP_FAILED',
      error: err?.message,
    });
  } finally {
    snapshotInFlight = false;
  }
});

router.get('/list', (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    ensureHeapDir();
    const files = fs.readdirSync(HEAP_DIR)
      .filter((f) => f.endsWith('.heapsnapshot'))
      .map((f) => {
        const s = fs.statSync(path.join(HEAP_DIR, f));
        return { file: f, sizeBytes: s.size, mtime: s.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ success: true, dir: HEAP_DIR, count: files.length, files });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

router.get('/:file', (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const safe = safeFileName(String(req.params.file));
  if (!safe) {
    res.status(400).json({ success: false, message: 'Invalid filename', code: 'BAD_FILE' });
    return;
  }
  const full = path.join(HEAP_DIR, safe);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    res.status(404).json({ success: false, message: 'Snapshot not found', code: 'NOT_FOUND' });
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Content-Length', String(stat.size));
  const stream = fs.createReadStream(full);
  // Attach an error handler so a mid-stream FS error or a client disconnect
  // doesn't bubble up as an unhandled 'error' event and crash the process.
  stream.on('error', (err) => {
    logger.error(`[NYV-NS-013] Heap snapshot stream error for ${safe}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy(err);
    }
  });
  // Best-effort cleanup on client abort.
  req.on('close', () => stream.destroy());
  stream.pipe(res);
});

router.delete('/:file', (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const safe = safeFileName(String(req.params.file));
  if (!safe) {
    res.status(400).json({ success: false, message: 'Invalid filename', code: 'BAD_FILE' });
    return;
  }
  const full = path.join(HEAP_DIR, safe);
  if (!fs.existsSync(full)) {
    res.status(404).json({ success: false, message: 'Snapshot not found', code: 'NOT_FOUND' });
    return;
  }
  try {
    fs.unlinkSync(full);
  } catch (err: any) {
    logger.error(`[NYV-NS-013] Heap snapshot delete failed for ${safe}: ${err?.message || err}`);
    res.status(500).json({
      success: false,
      message: 'Snapshot delete failed',
      code: 'DELETE_FAILED',
      error: err?.message,
    });
    return;
  }
  logger.warn(`[NYV-NS-013] Heap snapshot deleted: ${safe}`);
  res.json({ success: true, deleted: safe });
});

export default router;
