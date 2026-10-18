/**
 * NV-LEGAL-WORK-ROUTES-001 — /api/jrx/legal-work/*
 * Async agentic legal work + benchmark task catalog (NYS federation).
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import {
  createLegalWorkRun,
  evaluateLegalWorkRun,
  getLegalWorkRun,
  getLegalWorkRunAsync,
  getLegalWorkTask,
  listLegalWorkRuns,
  listLegalWorkTasks,
} from '../services/jrx-legal-work-service.js';
import {
  forwardKeyFromReq,
  isNysKnowledgeConfigured,
  nysKnowledgeRequest,
} from '../services/jrx-nys-knowledge-client.js';
import { sendApiError, sendApiSuccess } from '../utils/jrx-api-error.js';

const router = Router();
router.use(dualSdkOrJwt);

function requirePlane(res: Response): boolean {
  if (!isJrxFeatureOn('nysKnowledgePlane')) {
    sendApiError(res, 'FORBIDDEN', {
      status: 503,
      overrideMessage: 'JRX_F_JRX_ECOSYSTEM_KNOWLEDGE_PLANE is off',
    });
    return false;
  }
  return true;
}

/** GET /api/jrx/legal-work/tasks */
router.get('/tasks', async (req, res) => {
  if (!requirePlane(res)) return;
  const result = await listLegalWorkTasks({
    q: req.query.q ? String(req.query.q) : undefined,
    jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
    category: req.query.category ? String(req.query.category) : undefined,
    workType: req.query.workType ? String(req.query.workType) : undefined,
  });
  if (result.ok === false) {
    res.status(result.status).json({ success: false, error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: result.error } });
    return;
  }
  sendApiSuccess(res, result.data);
});

router.get('/tasks/:id', async (req, res) => {
  if (!requirePlane(res)) return;
  const result = await getLegalWorkTask(req.params.id);
  if (result.ok === false) {
    res.status(result.status).json({ success: false, error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: result.error } });
    return;
  }
  sendApiSuccess(res, result.data);
});

/** POST /api/jrx/legal-work/runs — async 202 */
router.post('/runs', async (req, res) => {
  if (!requirePlane(res)) return;
  const instruction = String(req.body?.instruction ?? '').trim();
  if (instruction.length < 10) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'instruction (min 10 chars) is required' });
    return;
  }
  try {
    const run = await createLegalWorkRun({
      instruction,
      context: req.body?.context ? String(req.body.context) : undefined,
      jurisdiction: req.body?.jurisdiction ? String(req.body.jurisdiction) : 'IN',
      taskId: req.body?.taskId ? String(req.body.taskId) : undefined,
      userId: (req as any).user?.id || (req as any).userId,
      orgId: (req as any).user?.orgId || (req as any).orgId,
    });
    res.status(202).json({ success: true, data: run });
  } catch (e) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (e as Error).message });
  }
});

router.get('/runs', (_req, res) => {
  if (!requirePlane(res)) return;
  sendApiSuccess(res, listLegalWorkRuns());
});

router.get('/runs/:id', async (req, res) => {
  if (!requirePlane(res)) return;
  const run = (await getLegalWorkRunAsync(req.params.id)) || getLegalWorkRun(req.params.id);
  if (!run) {
    sendApiError(res, 'NOT_FOUND');
    return;
  }
  sendApiSuccess(res, run);
});

router.post('/runs/:id/evaluate', async (req, res) => {
  if (!requirePlane(res)) return;
  try {
    const run = await evaluateLegalWorkRun(req.params.id);
    sendApiSuccess(res, run);
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/**
 * NSP Wave-C: POST /api/jrx/legal-work/evaluate — sync evaluate from instruction
 * (create run → wait → evaluate). Avoids 404 LEGAL_WORK_UNAVAILABLE on missing path.
 */
router.post('/evaluate', async (req, res) => {
  if (!requirePlane(res)) return;
  const instruction = String(req.body?.instruction ?? req.body?.prompt ?? '').trim();
  if (instruction.length < 10) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'instruction (min 10 chars) is required' });
    return;
  }
  try {
    const run = await createLegalWorkRun({
      instruction,
      context: req.body?.context ? String(req.body.context) : undefined,
      jurisdiction: req.body?.jurisdiction ? String(req.body.jurisdiction) : 'IN',
      taskId: req.body?.taskId ? String(req.body.taskId) : undefined,
      userId: (req as any).user?.id || (req as any).userId || (req as any).sdkContext?.customerUserId,
      orgId: (req as any).user?.orgId || (req as any).orgId || (req as any).sdkContext?.organizationId,
    });
    /* Wave-C sync evaluate: allow up to Queen wall (default 300s, cap 590s). */
    const deadline = Date.now() + Math.min(
      590_000,
      Math.max(60_000, Number(req.body?.timeoutMs) || 300_000),
    );
    let current = run;
    while (Date.now() < deadline) {
      current = (await getLegalWorkRunAsync(run.runId)) || getLegalWorkRun(run.runId) || current;
      if (current.status === 'completed' || current.status === 'failed' || current.status === 'evaluated') break;
      await new Promise((r) => setTimeout(r, 750));
    }
    if (current.status === 'completed') {
      try {
        current = await evaluateLegalWorkRun(current.runId);
      } catch {
        /* return completed run without evaluation block */
      }
    }
    if (current.status === 'queued' || current.status === 'working') {
      res.status(202).json({ success: true, data: current, message: 'Legal work still running — poll GET /runs/:id' });
      return;
    }
    sendApiSuccess(res, current);
  } catch (e) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (e as Error).message });
  }
});

/** Alias: POST /chat → create conversation (NSP Wave-C). */
router.post('/chat', async (req, res) => {
  if (!requirePlane(res)) return;
  if (!isNysKnowledgeConfigured()) {
    sendApiError(res, 'QUEUE_UNAVAILABLE', { overrideMessage: 'NYS not configured' });
    return;
  }
  const result = await nysKnowledgeRequest({
    method: 'POST',
    path: '/chat/conversations',
    body: req.body || {},
    forwardApiKey: forwardKeyFromReq(req),
  });
  if (result.ok === false) {
    res.status(result.status).json({ success: false, error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: result.error } });
    return;
  }
  sendApiSuccess(res, result.data);
});

/** Legal chat proxy (generation still on NYS until full cutover; retrieval-first). */
router.post('/chat/conversations', async (req, res) => {
  if (!requirePlane(res)) return;
  if (!isNysKnowledgeConfigured()) {
    sendApiError(res, 'QUEUE_UNAVAILABLE', { overrideMessage: 'NYS not configured' });
    return;
  }
  const result = await nysKnowledgeRequest({
    method: 'POST',
    path: '/chat/conversations',
    body: req.body,
    forwardApiKey: forwardKeyFromReq(req),
  });
  if (result.ok === false) {
    res.status(result.status).json({ success: false, error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: result.error } });
    return;
  }
  sendApiSuccess(res, result.data);
});

router.post('/chat/conversations/:id/messages', async (req, res) => {
  if (!requirePlane(res)) return;
  const result = await nysKnowledgeRequest({
    method: 'POST',
    path: `/chat/conversations/${encodeURIComponent(req.params.id)}/messages`,
    body: req.body,
    timeoutMs: 120_000,
    forwardApiKey: forwardKeyFromReq(req),
  });
  if (result.ok === false) {
    res.status(result.status).json({ success: false, error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: result.error } });
    return;
  }
  sendApiSuccess(res, result.data);
});

export default router;
