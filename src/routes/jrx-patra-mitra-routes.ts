/**
 * NV-PATRA-MITRA-001 — Partner API for Patra Mitra (Document Companion)
 *
 * POST /sessions          — upload + parse + fields + summary
 * GET  /sessions/:id      — session state
 * POST /sessions/:id/chat — ask questions grounded in the document
 */
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { patraMitraService } from '../services/jrx-patra-mitra-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-patra-mitra-routes');
const router = Router();

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(consentGate({ purpose: 'ai_processing', triggeredBy: 'patra-mitra' }));

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      product: 'Patra Mitra',
      code: 'patra-mitra',
      tagline: 'Parse · Understand · Ask',
      status: 'ready',
      capabilities: [
        'parse',
        'ocr',
        'fields',
        'summary',
        'document_chat',
        'session_history',
        'parse_tools',
        'multilingual',
      ],
      formats: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'gif'],
      tools: [
        'detect_language',
        'extract_parties',
        'extract_dates',
        'extract_amounts',
        'extract_citations',
        'find_clauses',
        'pii_scan',
        'regenerate_summary',
        'export_fields',
      ],
      languages: ['en', 'hi', 'bn', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'or', 'mixed'],
    },
  });
});

router.get('/sessions', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { sessions: await patraMitraService.listSessions(50) },
  });
});

router.post('/sessions', async (req: Request, res: Response) => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes || [], 'documents:write') && !checkScope(ctx.scopes || [], 'documents:read')) {
    // Allow when scopes are broad partner defaults
    if (!(ctx.scopes || []).length) {
      /* partner keys often carry implicit doc access */
    } else if (!checkScope(ctx.scopes || [], '*')) {
      res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write' });
      return;
    }
  }

  const { base64, content, fileName, mimeType, jurisdiction, includeFullText } = req.body || {};
  if (!base64 && !content) {
    res.status(400).json({
      success: false,
      error: 'Provide base64 (binary document/image) or content (plain text)',
    });
    return;
  }

  try {
    const session = await patraMitraService.createSession({
      base64,
      content,
      fileName,
      mimeType,
      jurisdiction: jurisdiction || ctx.jurisdiction || 'IN',
      orgId: ctx.organizationId != null ? String(ctx.organizationId) : undefined,
      platformCode: (ctx as any).platformUatLabel || (ctx as any).appType,
      userId: (req as any).user?.id || (ctx as any).customerUserId,
      sdkContext: ctx as any,
    });
    res.status(201).json({
      success: true,
      data: patraMitraService.toPublic(session, { includeFullText: !!includeFullText }),
    });
  } catch (err: any) {
    logger.warn('[PatraMitra] create session failed', { err: err?.message });
    res.status(422).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  const session = await patraMitraService.getSessionAsync(String(req.params.sessionId));
  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found or expired' });
    return;
  }
  res.json({
    success: true,
    data: patraMitraService.toPublic(session, { includeFullText: req.query.fullText === '1' }),
  });
});

router.post('/sessions/:sessionId/chat', async (req: Request, res: Response) => {
  const ctx = req.sdkContext!;
  const message = req.body?.message ?? req.body?.question;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }
  try {
    const result = await patraMitraService.chat({
      sessionId: String(req.params.sessionId),
      message,
      jurisdiction: req.body?.jurisdiction || ctx.jurisdiction || 'IN',
      answerLanguage: req.body?.answerLanguage || req.body?.language,
      sdkContext: ctx as any,
      userId: (req as any).user?.id || (ctx as any).customerUserId,
    });
    res.json({
      success: true,
      data: {
        answer: result.answer,
        session: result.session,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const status = /not found|expired/i.test(msg) ? 404 : 422;
    logger.warn('[PatraMitra] chat failed', { err: msg.slice(0, 200) });
    res.status(status).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/sessions/:sessionId/tools', async (req: Request, res: Response) => {
  const ctx = req.sdkContext!;
  const tool = req.body?.tool || req.body?.toolId;
  if (!tool || typeof tool !== 'string') {
    res.status(400).json({ success: false, error: 'tool is required' });
    return;
  }
  try {
    const result = await patraMitraService.runTool({
      sessionId: String(req.params.sessionId),
      tool,
      answerLanguage: req.body?.answerLanguage || req.body?.language,
      sdkContext: ctx as any,
      userId: (req as any).user?.id || (ctx as any).customerUserId,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const status = /not found|expired/i.test(msg) ? 404 : /Unknown tool/i.test(msg) ? 400 : 422;
    logger.warn('[PatraMitra] tool failed', { err: msg.slice(0, 200) });
    res.status(status).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
