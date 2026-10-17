/**
 * NV-TEMPLATES-API-001 — Canonical legal templates API for NSP / ecosystem.
 *
 * Mounted at:
 *   /api/jrx/templates
 *   /api/jrx/templates/catalog  (alias)
 * Also mirrored on gateway via /api/jrx/gateway/templates
 *
 * SME review (NV-TEMPLATES-SME-REVIEW-001):
 *   GET  /reviews/queue
 *   GET  /reviews/stats
 *   GET  /approved
 *   POST /:id/review
 *   POST /reviews/bootstrap
 *
 * Auth: dualSdkOrJwt (X-API-Key or Authorization: Bearer <sdk-key>)
 */

import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError } from '../utils/jrx-api-error.js';
import {
  fillTemplate,
  getTemplateById,
  getTemplatesCatalog,
  nspCatalogEnvelope,
  type TemplateComplexity,
} from '../services/jrx-templates-catalog-service.js';
import {
  bootstrapPlatformCurated,
  listReviews,
  reviewStats,
  submitSmeReview,
  type TemplateApprovalStatus,
} from '../services/jrx-templates-sme-review-service.js';
import { isIndiaOnlyPartner } from '../utils/jrx-partner-platform.js';

const logger = createLogger('./jrx-templates-routes');
const router = Router();

router.use(dualSdkOrJwt);
router.use(partnerIndiaScopeMiddleware);

function queryFromReq(req: Request) {
  const approvedQ = req.query.approvedOnly ?? req.query.approved;
  const indiaOnly = isIndiaOnlyPartner(req);
  return {
    jurisdiction: indiaOnly ? 'IN' : (req.query.jurisdiction ? String(req.query.jurisdiction) : undefined),
    includeNonIndia: indiaOnly ? false : undefined,
    category: req.query.category
      ? String(req.query.category)
      : req.query.document_type
        ? String(req.query.document_type)
        : undefined,
    document_type: req.query.document_type ? String(req.query.document_type) : undefined,
    complexity: req.query.complexity
      ? (String(req.query.complexity) as TemplateComplexity)
      : undefined,
    q: req.query.q
      ? String(req.query.q)
      : req.query.search
        ? String(req.query.search)
        : undefined,
    kind: req.query.kind ? String(req.query.kind) : undefined,
    approvedOnly:
      approvedQ === undefined
        ? undefined
        : !['0', 'false', 'no'].includes(String(approvedQ).toLowerCase()),
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  };
}

function handleList(req: Request, res: Response): void {
  try {
    const envelope = nspCatalogEnvelope(queryFromReq(req));
    res.setHeader('X-NYV-Templates-Count', String(envelope.data.total));
    res.json(envelope);
  } catch (err) {
    logger.error('templates list failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', {
      overrideMessage: (err as Error).message,
    });
  }
}

router.get('/', handleList);
router.get('/catalog', handleList);

/**
 * NV-TEMPLATE-SYNC-001 — rebuild in-memory catalog + return honest digest for NSP sync jobs.
 * Does not rotate keys. Empty digest when catalog has zero rows.
 */
router.post('/sync', (req: Request, res: Response): void => {
  try {
    // Touch catalog builders (side-effect free refresh of seed-backed cache)
    const all = getTemplatesCatalog();
    const envelope = nspCatalogEnvelope({
      ...queryFromReq(req),
      approvedOnly: false,
      limit: 5,
    });
    const digest = {
      generatedAt: new Date().toISOString(),
      total: all.length,
      sampleIds: all.slice(0, 5).map((t) => t.id),
      provenance: 'nyv-templates-catalog',
      empty: all.length === 0,
      message: all.length === 0 ? 'Honest empty digest — no templates loaded' : undefined,
    };
    res.json({ success: true, data: digest, catalog: envelope.data });
  } catch (err) {
    logger.error('templates sync failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

router.get('/sync', (req: Request, res: Response): void => {
  req.method = 'POST';
  // fallthrough not supported — duplicate thin GET
  try {
    const all = getTemplatesCatalog();
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        total: all.length,
        empty: all.length === 0,
        provenance: 'nyv-templates-catalog',
      },
    });
  } catch (err) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

/** Approved partner set (platform_curated + sme_approved). */
router.get('/approved', (req: Request, res: Response): void => {
  try {
    const envelope = nspCatalogEnvelope({ ...queryFromReq(req), approvedOnly: true });
    res.setHeader('X-NYV-Templates-Count', String(envelope.data.total));
    res.json(envelope);
  } catch (err) {
    logger.error('templates approved list failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

router.get('/reviews/stats', (_req: Request, res: Response): void => {
  try {
    // Ensure bootstrap ran
    getTemplatesCatalog();
    res.json({ success: true, data: reviewStats(), generatedAt: new Date().toISOString() });
  } catch (err) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

/** SME queue: comprehensive templates not yet partner-approved. */
router.get('/reviews/queue', (req: Request, res: Response): void => {
  try {
    getTemplatesCatalog();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const full = nspCatalogEnvelope({ approvedOnly: false, limit: 2000 });
    const queue = full.data.templates
      .filter((t) => !t.partner_approved)
      .slice(0, limit)
      .map((t) => ({
        id: t.id,
        name: t.name,
        document_type: t.document_type,
        complexity: t.complexity,
        content_len: t.content.length,
        approval_status: t.approval_status,
        jurisdiction_code: t.jurisdiction_code,
      }));
    res.json({
      success: true,
      data: {
        queue,
        total: queue.length,
        reviewStats: reviewStats(),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error('templates review queue failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

router.get('/reviews', (req: Request, res: Response): void => {
  try {
    getTemplatesCatalog();
    const status = req.query.status
      ? (String(req.query.status) as TemplateApprovalStatus)
      : undefined;
    const rows = listReviews({ status, limit: Number(req.query.limit) || 200 });
    res.json({ success: true, data: { reviews: rows, total: rows.length, stats: reviewStats() } });
  } catch (err) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

router.post('/reviews/bootstrap', (_req: Request, res: Response): void => {
  try {
    const result = bootstrapPlatformCurated(getTemplatesCatalog(), { maxSeeds: 80, perCategory: 2 });
    res.json({ success: true, data: { ...result, stats: reviewStats() } });
  } catch (err) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (err as Error).message });
  }
});

router.get('/:id', (req: Request, res: Response): void => {
  try {
    const template = getTemplateById(String(req.params.id), {
      indiaOnly: isIndiaOnlyPartner(req),
    });
    if (!template) {
      sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Template not found' });
      return;
    }
    res.json({ success: true, data: template });
  } catch (err) {
    logger.error('templates get failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', {
      overrideMessage: (err as Error).message,
    });
  }
});

/** SME submit review / approval. */
router.post('/:id/review', (req: Request, res: Response): void => {
  try {
    const id = String(req.params.id);
    const template = getTemplateById(id, { indiaOnly: isIndiaOnlyPartner(req) });
    if (!template) {
      sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Template not found' });
      return;
    }
    const status = String(req.body?.status || '') as TemplateApprovalStatus;
    if (!status) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'status is required' });
      return;
    }
    const sdkCtx: any = (req as any).sdkContext;
    const reviewerId =
      req.body?.reviewerId ||
      req.user?.id ||
      (sdkCtx ? `sdk:${sdkCtx.appName || sdkCtx.applicationId}` : 'anonymous');
    const record = submitSmeReview({
      templateId: template.id,
      status,
      reviewerId: String(reviewerId),
      reviewerRole: req.body?.reviewerRole || 'sme',
      notes: req.body?.notes ? String(req.body.notes) : undefined,
      rubric: req.body?.rubric,
      jurisdiction_code: template.jurisdiction_code,
    });
    res.json({
      success: true,
      data: {
        review: record,
        template: getTemplateById(template.id, { indiaOnly: isIndiaOnlyPartner(req) }),
      },
    });
  } catch (err) {
    logger.error('templates review failed', { error: (err as Error).message });
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (err as Error).message });
  }
});

router.post('/:id/generate', (req: Request, res: Response): void => {
  try {
    const variables =
      (req.body?.variables as Record<string, unknown>) ||
      (req.body?.fields as Record<string, unknown>) ||
      {};
    const filled = fillTemplate(String(req.params.id), variables, {
      indiaOnly: isIndiaOnlyPartner(req),
    });
    if (!filled) {
      sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Template not found' });
      return;
    }
    res.json({
      success: true,
      data: {
        templateId: filled.template.id,
        name: filled.template.name,
        content: filled.content,
        variables,
        jurisdiction_code: filled.template.jurisdiction_code,
        document_type: filled.template.document_type,
        approval_status: filled.template.approval_status,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error('templates generate failed', { error: (err as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', {
      overrideMessage: (err as Error).message,
    });
  }
});

export default router;
