/**
 * NV-EDJ-ROUTES-001 — Ecosystem Document Job HTTP API + legacy shims.
 * Canonical: /api/jrx/v1/sdk/ecosystem-documents/jobs
 * Legacy NSP:  /api/jrx-docs/process, /api/jrx/shared-docs/*
 *
 * NV-EDJ-ACL-001: all read paths enforce applicationId / platformCode isolation.
 */
import { Router, Request, Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { extractSdkApiKey } from '../middleware/jrx-sdk-auth-header.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import {
  createEcosystemDocumentJob,
  formatEdjStatusResponse,
  getEcosystemDocumentJobRow,
  getEcosystemDocumentJobResult,
  getEcosystemDocumentJobContent,
  legacySharedDocsToEdj,
  canAccessEdjJob,
  type CreateEdjRequest,
  type EdjAccessCaller,
} from '../services/jrx-ecosystem-document-job-service.js';

const router = Router();
const logger = createLogger('ecosystem-document-routes');

function jobContext(req: Request) {
  return {
    userId: req.sdkContext?.customerUserId || req.user?.id || 'ecosystem-sdk',
    applicationId: req.sdkContext?.applicationId,
    appType: req.sdkContext?.appType,
  };
}

function accessCaller(req: Request): EdjAccessCaller {
  const role = String(req.user?.role || '').toLowerCase();
  const isPlatformAdmin =
    role === 'super_admin' ||
    role === 'superadmin' ||
    role === 'platform_admin';
  return {
    applicationId: req.sdkContext?.applicationId,
    appType: req.sdkContext?.appType,
    userId: req.sdkContext?.customerUserId || req.user?.id,
    isPlatformAdmin,
  };
}

/**
 * Load job and enforce tenant ACL.
 * Returns null when not found; sends 403 and returns undefined when denied.
 */
async function loadJobAuthorized(
  req: Request,
  res: Response,
  jobId: string,
): Promise<Record<string, unknown> | null | undefined> {
  const row = await getEcosystemDocumentJobRow(jobId);
  if (!row) {
    sendApiError(res, 'JOB_NOT_FOUND');
    return undefined;
  }
  const caller = accessCaller(req);
  if (!canAccessEdjJob(row, caller)) {
    logger.warn('edj_access_denied', {
      jobId,
      applicationId: caller.applicationId,
      appType: caller.appType,
    });
    // 404 (not 403) avoids job-id enumeration across tenants
    sendApiError(res, 'JOB_NOT_FOUND');
    return undefined;
  }
  return row;
}

router.post(
  '/jobs',
  dualSdkOrJwt,
  consentGate({ purpose: 'ai_processing', triggeredBy: 'ecosystem-documents:POST /jobs' }),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateEdjRequest;
      const created = await createEcosystemDocumentJob(body, jobContext(req));
      res.status(202).json({ success: true, data: created });
    } catch (err: unknown) {
      safeError(res, err, 400);
    }
  },
);

router.get('/jobs/:jobId', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const row = await loadJobAuthorized(req, res, String(req.params.jobId));
    if (!row) return;
    res.json({ success: true, data: formatEdjStatusResponse(row) });
  } catch (err: unknown) {
    safeError(res, err, 500);
  }
});

router.get('/jobs/:jobId/result', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const row = await loadJobAuthorized(req, res, String(req.params.jobId));
    if (row === undefined) return;
    const result = await getEcosystemDocumentJobResult(String(req.params.jobId));
    if (!result) {
      sendApiError(res, 'JOB_NOT_FOUND', { overrideMessage: 'Result not ready or job not found' });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    safeError(res, err, 500);
  }
});

/**
 * GET /jobs/:jobId/content — Retrieve raw parsed text + extracted fields.
 *
 * Query params:
 *   ?format=text          → text/plain body (raw text only, fields in X-EDJ-Fields header)
 *   ?format=fields_only   → JSON with fields + documentMeta only (no raw text)
 *   (default)             → full JSON: content + fields + documentMeta
 */
router.get('/jobs/:jobId/content', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const row = await loadJobAuthorized(req, res, String(req.params.jobId));
    if (row === undefined) return;

    const content = await getEcosystemDocumentJobContent(String(req.params.jobId));
    if (!content) {
      sendApiError(res, 'JOB_NOT_FOUND', {
        overrideMessage: 'Content not available — job may still be processing, failed, or not found',
      });
      return;
    }

    const format = req.query.format as string | undefined;

    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-EDJ-Job-Id', content.jobId);
      res.setHeader('X-EDJ-Platform', content.platformCode);
      res.setHeader('X-EDJ-Char-Count', String(content.charCount));
      res.setHeader('X-EDJ-Word-Count', String(content.wordCount));
      res.setHeader('X-EDJ-Page-Count', String(content.pageCount));
      if (content.fields) {
        res.setHeader('X-EDJ-Fields', JSON.stringify(content.fields));
      }
      res.send(content.content);
      return;
    }

    if (format === 'fields_only') {
      res.json({
        success: true,
        data: {
          jobId: content.jobId,
          platformCode: content.platformCode,
          correlationId: content.correlationId,
          fields: content.fields,
          documentMeta: content.documentMeta,
          charCount: content.charCount,
          wordCount: content.wordCount,
          pageCount: content.pageCount,
          extractedAt: content.extractedAt,
        },
      });
      return;
    }

    res.json({ success: true, data: content });
  } catch (err: unknown) {
    safeError(res, err, 500);
  }
});

/** Legacy NSP shim — POST /api/jrx-docs/process → EDJ */
export const nvDocsLegacyRouter = Router();

function legacyNspAuth(req: Request, res: Response, next: () => void): void {
  if (extractSdkApiKey(req) || req.headers['x-nsp-client']) {
    next();
    return;
  }
  sendApiError(res, 'API_KEY_MISSING', {
    overrideMessage: 'SDK API key or X-NSP-Client required',
  });
}

nvDocsLegacyRouter.post(
  '/process',
  legacyNspAuth,
  dualSdkOrJwt,
  consentGate({ purpose: 'ai_processing', triggeredBy: './jrx-docs:/process' }),
  async (req: Request, res: Response) => {
    try {
      const edjBody = legacySharedDocsToEdj(req.body);
      const created = await createEcosystemDocumentJob(edjBody, jobContext(req));
      res.status(202).json({
        success: true,
        data: {
          taskId: created.taskId,
          jobId: created.jobId,
          status: created.status,
          statusUrl: created.statusUrl,
          resultUrl: created.resultUrl,
          pollUrl: created.statusUrl,
          pollIntervalMs: created.pollIntervalMs,
          expiresAt: created.expiresAt,
        },
      });
    } catch (err: unknown) {
      safeError(res, err, 400);
    }
  },
);

nvDocsLegacyRouter.get('/status/:jobId', legacyNspAuth, dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const row = await loadJobAuthorized(req, res, String(req.params.jobId));
    if (!row) return;
    res.json({ success: true, data: formatEdjStatusResponse(row) });
  } catch (err: unknown) {
    safeError(res, err, 500);
  }
});

export default router;
