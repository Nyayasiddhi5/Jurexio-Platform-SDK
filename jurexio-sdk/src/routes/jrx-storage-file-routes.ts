/**
 * jrx-storage-file-routes.ts — serves local-backend signed URLs.
 *
 * NV-LOCAL-SIGNED-URL-001. `LocalStorageAdapter.getSignedUrl()` has always emitted
 * `/api/jrx/storage/files/<path>?exp=…&token=…`, but **no route existed for it**, so every
 * signed URL 404'd. Because `local` is the default backend when no S3 bucket is
 * configured (`jrx-master-config.ts:290-292`), that meant dev and any non-S3 deployment
 * could not serve a document it had successfully stored.
 *
 * Deliberately NOT mounted behind `dualSdkOrJwt`: the token IS the authorisation, exactly
 * as with an S3 presigned URL. That is the whole point of a signed URL — it is handed to
 * a browser or a partner that does not hold an API key. Security therefore rests on:
 *   1. a timing-safe HMAC over `path:exp` (`verifyLocalSignedUrlToken`),
 *   2. a short expiry (default 3600 s, `JRX_S3_SIGNED_URL_EXPIRY`),
 *   3. path-traversal rejection before any filesystem access,
 *   4. S3 backend never reaching this route at all.
 *
 * This is a dev/self-hosted convenience path. On S3 it is inert.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyLocalSignedUrlToken } from '../services/jrx-document-storage-service.js';
import { JRX_STORAGE } from '../config/jrx-master-config.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-storage-file-routes');

/**
 * Reject anything that could escape the storage root before touching the filesystem.
 * `path.normalize` collapses `..` segments, so comparing the resolved path against the
 * root is the check that actually holds — a regex on the raw input would miss encoded
 * and mixed-separator variants.
 */
function resolveWithinRoot(root: string, storagePath: string): string | null {
  if (!storagePath || storagePath.includes('\0')) return null;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, storagePath);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) return null;
  return candidate;
}

router.get('/files/*', async (req: Request, res: Response): Promise<void> => {
  /* The signed path may contain '/', so it arrives as a wildcard rather than a param. */
  const storagePath = decodeURIComponent(String((req.params as Record<string, string>)[0] || ''));
  const exp = Number(req.query.exp);
  const token = String(req.query.token || '');

  if (JRX_STORAGE.backend === 's3') {
    /* On S3 the adapter issues real presigned URLs; this route must never be used as a
     * side door around them. */
    res.status(404).json({ success: false, error: 'Not available on the S3 backend', code: 'STORAGE_ROUTE_INERT' });
    return;
  }

  const verdict = verifyLocalSignedUrlToken(storagePath, exp, token);
  if (verdict.ok === false) {
    /* 410 for an expired-but-genuine link is materially more useful than 403: the caller
     * should request a fresh URL, not re-check credentials. */
    const status = verdict.reason === 'expired' ? 410 : 403;
    logger.warn('storage_signed_url_rejected', { reason: verdict.reason, storagePath: storagePath.slice(0, 120) });
    res.status(status).json({
      success: false,
      error: verdict.reason === 'expired' ? 'Signed URL has expired' : 'Invalid signature',
      code: verdict.reason === 'expired' ? 'SIGNED_URL_EXPIRED' : 'SIGNED_URL_INVALID',
      retryable: verdict.reason === 'expired',
    });
    return;
  }

  const full = resolveWithinRoot(JRX_STORAGE.local.basePath, storagePath);
  if (!full) {
    logger.error('storage_path_traversal_blocked', { storagePath: storagePath.slice(0, 120) });
    res.status(400).json({ success: false, error: 'Invalid storage path', code: 'STORAGE_PATH_INVALID' });
    return;
  }

  try {
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) {
      res.status(404).json({ success: false, error: 'Not found', code: 'STORAGE_NOT_FOUND' });
      return;
    }
    res.setHeader('Content-Length', String(stat.size));
    /* Signed URLs are per-user and time-boxed, so they must never land in a shared cache. */
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    /* Attachment rather than inline: serving arbitrary stored bytes inline invites
     * stored-XSS via an uploaded HTML/SVG document. */
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full).replace(/"/g, '')}"`);
    fs.createReadStream(full).pipe(res);
  } catch {
    res.status(404).json({ success: false, error: 'Not found', code: 'STORAGE_NOT_FOUND' });
  }
});

export default router;
