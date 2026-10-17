// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Shared Document Processing — delegates to NV-EDJ-001 durable jobs.
 * @deprecated Prefer POST /api/jrx/v1/sdk/ecosystem-documents/jobs
 */
import { Router, Request, Response, NextFunction } from 'express';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import { extractSdkApiKey } from '../middleware/jrx-sdk-auth-header.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { consentManagementService } from '../services/consent-management-service.js';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import {
  createEcosystemDocumentJob,
  formatEdjStatusResponse,
  getEcosystemDocumentJobRow,
  legacySharedDocsToEdj,
  canAccessEdjJob,
} from '../services/jrx-ecosystem-document-job-service.js';

const logger = createLogger('shared-docs-routes');

const VALID_NSP_CLIENTS = new Set([
  'nyayasiddhi-professional',
  'nyayasiddhi-professional/1.0.0',
  'nyayasiddhi',
]);

function nvClientAuth(req: Request, res: Response, next: NextFunction): void {
  const clientHeader = req.headers['x-nsp-client'] as string || '';
  const clientBase = clientHeader.split('/')[0];
  const apiKey = extractSdkApiKey(req) ?? '';
  const envApiKey = process.env.NYAYAVIGYA_API_KEY || '';

  if (VALID_NSP_CLIENTS.has(clientBase)) { next(); return; }
  if (envApiKey && apiKey === envApiKey) { next(); return; }
  if (apiKey) { next(); return; }

  sendApiError(res, 'UNAUTHORIZED');
}

const router = Router();

function jobContext(req: Request) {
  return {
    userId: req.sdkContext?.customerUserId || req.user?.id || 'nsp-shared-docs',
    applicationId: req.sdkContext?.applicationId,
    appType: req.sdkContext?.appType || 'nyayasiddhi-professional',
  };
}

router.post('/process', nvClientAuth, dualSdkOrJwt, consentGate({ purpose: 'ai_processing', triggeredBy: 'shared-docs:/process' }), async (req: Request, res: Response) => {
  try {
    const body = { ...(req.body || {}) } as Record<string, unknown>;

    // NV-EDJ-INLINE-001: NSP/NYM often send contentBase64 during integration
    // testing without a prior shared-storage upload. Materialize to storage
    // so durable EDJ fetch does not fail with storageKey="undefined".
    const hasStorageKey = typeof body.storageKey === 'string' && String(body.storageKey).trim() && String(body.storageKey) !== 'undefined';
    const inlineB64 = typeof body.contentBase64 === 'string' ? String(body.contentBase64).trim() : '';
    const inlineText = typeof body.content === 'string' ? String(body.content) : (typeof body.text === 'string' ? String(body.text) : '');
    if (!hasStorageKey && (inlineB64 || inlineText)) {
      const { nyvDocumentStorage } = await import('../services/nyv-document-storage-service.js');
      const buf = inlineB64
        ? Buffer.from(inlineB64, 'base64')
        : Buffer.from(inlineText, 'utf8');
      if (!buf.length) {
        sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'contentBase64/content is empty' });
        return;
      }
      const orgId = String(body.orgId || req.sdkContext?.customerOrgId || 'dev-org');
      const docId = String(body.docId || body.correlationId || crypto.randomUUID());
      const fileName = String(body.fileName || `inline-${docId}.bin`);
      const mimeType = String(body.mimeType || 'application/octet-stream');
      const platform = String(req.sdkContext?.appType || 'nyayasiddhi-professional').replace(/[^a-zA-Z0-9_-]/g, '_');
      const storageKey = `ecosystem-edj/${platform}/${orgId}/${docId}/${fileName}`;
      await nyvDocumentStorage.uploadRaw(storageKey, buf, mimeType);
      body.storageKey = storageKey;
      body.orgId = orgId;
      body.docId = body.docId || docId;
      body.sizeBytes = buf.length;
      logger.info('[NV-SharedDocs] materialized inline content to shared storage', {
        storageKey,
        bytes: buf.length,
        mimeType,
      });
    }

    if (!body.storageKey || String(body.storageKey) === 'undefined') {
      sendApiError(res, 'BAD_REQUEST', {
        overrideMessage: 'storageKey or contentBase64/content is required for shared-docs/process',
      });
      return;
    }
    if (!body.orgId) body.orgId = String(req.sdkContext?.customerOrgId || 'dev-org');

    const edjBody = legacySharedDocsToEdj(body);
    const created = await createEcosystemDocumentJob(edjBody, jobContext(req));
    res.status(202).json({
      success: true,
      data: {
        jobId: created.jobId,
        taskId: created.taskId,
        status: created.status,
        message: 'Document queued for Jurexio AI analysis (durable EDJ)',
        pollUrl: created.statusUrl,
        statusUrl: created.statusUrl,
        resultUrl: created.resultUrl,
        pollIntervalMs: created.pollIntervalMs,
        expiresAt: created.expiresAt,
        storageKey: body.storageKey,
      },
    });
  } catch (error: unknown) {
    safeError(res, error as Error, 500);
  }
});

router.get('/status/:jobId', nvClientAuth, dualSdkOrJwt, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const row = await getEcosystemDocumentJobRow(String(jobId));
  if (!row) {
    sendApiError(res, 'JOB_NOT_FOUND', { status: 404 });
    return;
  }
  const role = String(req.user?.role || '').toLowerCase();
  const allowed = canAccessEdjJob(row, {
    applicationId: req.sdkContext?.applicationId,
    appType: req.sdkContext?.appType || 'nyayasiddhi-professional',
    userId: req.sdkContext?.customerUserId || req.user?.id,
    isPlatformAdmin: role === 'super_admin' || role === 'superadmin',
  });
  if (!allowed) {
    sendApiError(res, 'JOB_NOT_FOUND', { status: 404 });
    return;
  }
  const data = formatEdjStatusResponse(row);
  res.json({
    success: true,
    data: {
      ...data,
      result: data.resultInline,
      elapsedMs: data.startedAt ? Date.now() - new Date(String(data.startedAt)).getTime() : 0,
    },
  });
});

router.post('/bulk-process', nvClientAuth, dualSdkOrJwt, consentGate({ purpose: 'ai_processing', triggeredBy: 'shared-docs:/bulk-process' }), async (req: Request, res: Response) => {
  try {
    const { documents, jurisdiction = 'IN' } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'documents array required' });
      return;
    }
    if (documents.length > 20) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Maximum 20 documents per bulk request' });
      return;
    }

    const enforce = process.env.NV_DPDPA_CONSENT_ENFORCE === '1' || process.env.NV_DPDPA_CONSENT_ENFORCE === 'true';
    const breaches: Array<{ docId: number; orgId: number; status: string }> = [];
    for (const doc of documents) {
      if (!doc?.orgId) continue;
      try {
        const result = await consentManagementService.checkConsent(
          `nsp:org:${doc.orgId}`,
          'ai_processing',
          {
            orgId: String(doc.orgId),
            jurisdiction,
            attemptedUse: true,
            requestId: crypto.randomUUID(),
            triggeredBy: `shared-docs:/bulk-process doc=${doc.docId}`,
          },
        );
        if (!result.granted) {
          breaches.push({ docId: doc.docId, orgId: doc.orgId, status: result.status });
        }
      } catch (err: unknown) {
        logger.warn('[NV-SharedDocs] per-doc consent check failed', { docId: doc.docId, err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (enforce && breaches.length > 0) {
      sendApiError(res, 'FORBIDDEN', {
        overrideMessage: 'DPDPA consent required for one or more documents',
        details: { code: 'DPDPA_CONSENT_BREACH', purpose: 'ai_processing', breaches },
      });
      return;
    }

    const jobs = [];
    for (const doc of documents) {
      const edjBody = legacySharedDocsToEdj({ ...doc, jurisdiction });
      const created = await createEcosystemDocumentJob(edjBody, jobContext(req));
      jobs.push({
        jobId: created.jobId,
        taskId: created.taskId,
        docId: doc.docId,
        storageKey: doc.storageKey,
        pollUrl: created.statusUrl,
      });
    }

    res.status(202).json({
      success: true,
      data: {
        jobs,
        total: jobs.length,
        message: `${jobs.length} documents queued for durable EDJ analysis`,
        pollUrls: jobs.map((j) => j.pollUrl),
      },
    });
  } catch (error: unknown) {
    safeError(res, error as Error, 500);
  }
});

export default router;
