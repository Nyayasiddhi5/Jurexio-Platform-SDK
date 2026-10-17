/**
 * Jurexio Enterprise Platform — Console-side /api/nv5/* proxy
 * Task #115 (2026-05-11)
 *
 * The Platform-v5 Console pages (`client/src/pages/platform-v5/*.tsx`) call
 * `/api/nv5/*` admin sub-routes whose canonical authentication is an
 * admin-scoped SDK key on `X-API-Key` (NV-AUTH-HEADER-001). The Console
 * itself only carries a JWT (`Authorization: Bearer <jwt>`), so the
 * try-it forms previously returned 401 `BEARER_NOT_SDK_KEY` until an
 * operator manually pasted an SDK key into `localStorage['nyv.admin.sdkKey']`.
 *
 * This proxy closes that gap WITHOUT putting an admin SDK secret in the
 * browser:
 *
 *   1. Mount path: `/api/jrx/admin/nv5-proxy/<rest>`
 *   2. Auth (Console-side): JWT-only (`authenticateToken` + `requireAdmin`)
 *      — applied at mount time in `src/index.ts`. Plain users get 401/403
 *      from the JWT layer before ever touching this router.
 *   3. SDK key (server-side): read once from `process.env.NYV_CONSOLE_ADMIN_SDK_KEY`.
 *      When unset, the proxy returns a 503 with an explicit operator
 *      runbook hint — it never silently falls back to "no key" (which
 *      would re-create the original 401 the user reported).
 *   4. Forward: dispatch the request to `/api/nv5/<rest>` over the
 *      gateway's own loopback (`127.0.0.1:${NYV_PORT_GATEWAY}`) with
 *      `X-API-Key` set server-side. Method, query string, request body,
 *      and `Content-Type` are passed through as-is.
 *   5. Audit: every dispatch (success or failure) writes one
 *      `nv5_proxy_dispatch` entry into the canonical hash-chained
 *      `nv_audit_logs` via `appendAuditRecord`, recording BOTH the
 *      originating Console `user_id` AND the masked prefix of the
 *      proxied SDK key. This satisfies the task's audit-chain
 *      requirement and matches the existing audit-payload shape.
 *
 * Guardrails honored:
 *   - NV-AUTH-HEADER-001 — uses canonical `X-API-Key` only; no new headers.
 *   - NV-NAMING-001      — `nv-` prefix; net-new file (no existing concept).
 *   - NV-WIRING-001      — wired from `src/index.ts` (see Batch K mount).
 *   - NV-CONTRACT-001    — additive route surface, no removals.
 */

import { Router, Request, Response } from 'express';
import http from 'node:http';
import type { AuthRequest } from '../middleware/jrx-auth.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-admin-nv5-proxy');
const router = Router();

const ADMIN_SDK_KEY_ENV = 'NYV_CONSOLE_ADMIN_SDK_KEY';

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function loopbackHost(): string {
  return '127.0.0.1';
}
function loopbackPort(): number {
  return parseInt(process.env.NYV_PORT_GATEWAY || process.env.PORT || '5000', 10);
}

/**
 * Catch-all mounted under `/api/jrx/admin/nv5-proxy`. `req.path` is the
 * portion AFTER the mount prefix, e.g. for an incoming request to
 * `/api/jrx/admin/nv5-proxy/orch/roma/audit-trail`, `req.path` is
 * `/orch/roma/audit-trail`. We forward that verbatim under `/api/nv5`.
 */
router.use(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id ? String(authReq.user.id) : 'unknown';
  const userRole = authReq.user?.role ?? 'unknown';

  const sdkKey = process.env[ADMIN_SDK_KEY_ENV];
  if (!sdkKey || !sdkKey.trim()) {
    res.status(503).json({
      success: false,
      error: {
        code: 'CONSOLE_ADMIN_SDK_KEY_NOT_PROVISIONED',
        message:
          `Console-bound admin SDK key is not configured. Set ${ADMIN_SDK_KEY_ENV} ` +
          `in the gateway environment (an admin-scoped key from sdk_app_api_keys) ` +
          `and restart the gateway. See docs/canonical/00-README.md § Console proxy.`,
        env: ADMIN_SDK_KEY_ENV,
      },
    });
    return;
  }

  // `req.path` is post-mount-prefix. Reject empty / root requests — the
  // proxy only forwards explicit sub-paths, never a bare `/api/nv5`.
  const subPath = req.path && req.path !== '/' ? req.path : null;
  if (!subPath) {
    res.status(400).json({
      success: false,
      error: {
        code: 'PROXY_PATH_REQUIRED',
        message:
          'Provide a sub-path under /api/jrx/admin/nv5-proxy/, e.g. ' +
          '/api/jrx/admin/nv5-proxy/orch/roma/audit-trail',
      },
    });
    return;
  }

  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamPath = `/api/nv5${subPath}${qs}`;

  // Body — Express has already parsed JSON (express.json mounted globally
  // at index.ts:381). Re-serialize for the upstream request. Non-JSON
  // bodies (multipart, etc.) are intentionally not supported by this
  // proxy — the Platform-v5 try-it forms are JSON-only by design (see
  // doc-ai.tsx blurb explaining multipart endpoints are out-of-scope).
  let bodyBuf: Buffer | null = null;
  let contentType: string | undefined;
  // Forward a JSON body for any non-GET/HEAD method when the upstream expects
  // one. We forward EVEN when the parsed body is `{}` so strict downstream
  // handlers that require a JSON object still see a well-formed request
  // (code-review fix). express.json() leaves `req.body` as `{}` for both
  // an empty body and an explicit `{}`; we conservatively forward `{}` for
  // the methods that conventionally carry a payload.
  const methodHasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (methodHasBody) {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    bodyBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    contentType = 'application/json';
  }

  const startedAt = Date.now();
  let upstreamStatus = 0;
  let upstreamBodyChunks: Buffer[] = [];
  let upstreamContentType = 'application/json';

  try {
    await new Promise<void>((resolve, reject) => {
      const upstreamReq = http.request(
        {
          host: loopbackHost(),
          port: loopbackPort(),
          method: req.method,
          path: upstreamPath,
          headers: {
            'X-API-Key': sdkKey,
            'Accept': 'application/json',
            ...(contentType ? { 'Content-Type': contentType } : {}),
            ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
          },
        },
        (upstreamRes) => {
          upstreamStatus = upstreamRes.statusCode ?? 0;
          upstreamContentType = upstreamRes.headers['content-type']?.toString() ?? 'application/json';
          upstreamRes.on('data', (chunk: Buffer) => upstreamBodyChunks.push(chunk));
          upstreamRes.on('end', () => resolve());
          upstreamRes.on('error', reject);
        },
      );
      upstreamReq.on('error', reject);
      if (bodyBuf) upstreamReq.write(bodyBuf);
      upstreamReq.end();
    });

    const respBuf = Buffer.concat(upstreamBodyChunks);
    res.status(upstreamStatus);
    res.setHeader('Content-Type', upstreamContentType);
    res.setHeader('X-NV5-Proxy', 'console-admin');
    res.send(respBuf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[nv5-proxy] upstream dispatch failed', { upstreamPath, err: msg });
    res.status(502).json({
      success: false,
      error: {
        code: 'NV5_PROXY_UPSTREAM_ERROR',
        message: `Failed to reach upstream /api/nv5 route: ${msg}`,
        upstreamPath,
      },
    });
    upstreamStatus = 502;
  } finally {
    // Audit-chain entry. `appendAuditRecord` is hash-chained + cross-pod
    // serialized — never block the response on it; log at debug if it
    // fails (matches the pattern in writeAuditLog at nv-sdk-tracking-
    // middleware.ts:525).
    const auditPayload = JSON.stringify({
      console_user_id: userId,
      console_user_role: userRole,
      proxied_sdk_key_prefix: maskKey(sdkKey),
      route: upstreamPath,
      method: req.method,
      status_code: upstreamStatus,
      latency_ms: Date.now() - startedAt,
    });
    appendAuditRecord({
      eventType: 'nv5_proxy_dispatch',
      payload: auditPayload,
    }).catch((err) => {
      logger.debug('[nv5-proxy] audit append failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }
});

export default router;
