// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * AutomateAI™ REST Routes — /api/jrx/automateai/*
 * Visual Workflow Builder | Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   POST   /workflows                        Create workflow
 *   GET    /workflows                        List workflows for org
 *   GET    /workflows/:workflowId            Get workflow
 *   PUT    /workflows/:workflowId            Update workflow
 *   DELETE /workflows/:workflowId            Delete workflow
 *   POST   /workflows/:workflowId/activate   Activate workflow
 *   POST   /workflows/:workflowId/pause      Pause workflow
 *
 *   POST   /workflows/:workflowId/execute    Execute workflow
 *   GET    /executions/:executionId          Get execution
 *   GET    /workflows/:workflowId/executions List executions
 *   POST   /executions/:executionId/approve  Approve HITL gate
 *
 *   GET    /gate-types                       List all 8 gate types
 *   GET    /stats                            Service stats
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { automateAIService } from '../services/automateai/automateai-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const router = Router();
router.use(authenticateToken as any);

// task-224: caller's org scope. Falls back to a per-user pseudo-org so that two
// users WITHOUT an organizationId on their token are still isolated from each
// other (was previously hard-coded to '1', leaking every tenant's data).
function getOrgId(req: Request): string {
  const user: any = req.user;
  const org = user?.organizationId ?? user?.orgId ?? user?.org_id;
  if (org !== undefined && org !== null && String(org).length > 0) return String(org);
  return `__user_${user?.id ?? 'anon'}__`;
}

// task-224: ownership guard. Resolves the workflow and returns it only if the
// caller owns it. `mode='read'` returns 404 on miss; `mode='write'` returns 403
// when the row exists but belongs to another org (to surface the auth failure
// instead of pretending it doesn't exist).
function loadOwnedWorkflow(req: Request, res: Response, mode: 'read' | 'write'): any | null {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const wf = automateAIService.getWorkflow(req.params.workflowId);
  if (!wf) {
    res.status(404).json({ success: false, error: 'Workflow not found' });
    return null;
  }
  if (String(wf.orgId) !== getOrgId(req)) {
    if (mode === 'write') {
      res.status(403).json({ success: false, error: 'Forbidden: workflow belongs to another organization' });
    } else {
      res.status(404).json({ success: false, error: 'Workflow not found' });
    }
    return null;
  }
  return wf;
}

// ── WORKFLOW CRUD ─────────────────────────────────────────────────────────────
router.post('/workflows', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(120),
      description: z.string().optional(),
      nodes: z.array(z.record(z.unknown())).optional(),
      edges: z.array(z.record(z.unknown())).optional(),
      trigger: z.object({
        type: z.enum(['manual', 'webhook', 'schedule', 'event']),
        config: z.record(z.unknown()).optional(),
      }).optional(),
      jurisdiction: z.string().optional(),
    });
    const input = schema.parse(req.body);
    const orgId = getOrgId(req);
    const workflow = automateAIService.createWorkflow({ ...input, orgId, nodes: input.nodes as any, edges: input.edges as any });
    res.status(201).json({ success: true, workflow });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/workflows', (req: Request, res: Response) => {
  const workflows = automateAIService.listWorkflows(getOrgId(req));
  res.json({ success: true, workflows, total: workflows.length });
});

router.get('/workflows/:workflowId', (req: Request, res: Response) => {
  const wf = loadOwnedWorkflow(req, res, 'read');
  if (!wf) return;
  res.json({ success: true, workflow: wf });
});

router.put('/workflows/:workflowId', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedWorkflow(req, res, 'write')) return;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const wf = automateAIService.updateWorkflow(req.params.workflowId, req.body);
    if (!wf) { res.status(404).json({ success: false, error: 'Workflow not found' }); return; }
    res.json({ success: true, workflow: wf });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.delete('/workflows/:workflowId', (req: Request, res: Response) => {
  if (!loadOwnedWorkflow(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const deleted = automateAIService.deleteWorkflow(req.params.workflowId);
  if (!deleted) { res.status(404).json({ success: false, error: 'Workflow not found' }); return; }
  res.json({ success: true, message: 'Workflow deleted' });
});

router.post('/workflows/:workflowId/activate', (req: Request, res: Response) => {
  if (!loadOwnedWorkflow(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const wf = automateAIService.updateWorkflow(req.params.workflowId, { status: 'active' });
  if (!wf) { res.status(404).json({ success: false, error: 'Workflow not found' }); return; }
  res.json({ success: true, workflow: wf, message: `Workflow "${wf.name}" activated` });
});

router.post('/workflows/:workflowId/pause', (req: Request, res: Response) => {
  if (!loadOwnedWorkflow(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const wf = automateAIService.updateWorkflow(req.params.workflowId, { status: 'paused' });
  if (!wf) { res.status(404).json({ success: false, error: 'Workflow not found' }); return; }
  res.json({ success: true, workflow: wf, message: `Workflow "${wf.name}" paused` });
});

// ── EXECUTION ─────────────────────────────────────────────────────────────────
// @ts-expect-error NV-TS230 legacy typing gap (TS7030)
router.post('/workflows/:workflowId/execute', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedWorkflow(req, res, 'write')) return;
    const user = req.user;
    const execution = await automateAIService.executeWorkflow(
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      req.params.workflowId,
      req.body ?? {},
      String(user?.email ?? user?.id ?? 'api')
    );
    const statusCode = execution.status === 'completed' ? 200 : execution.status === 'failed' ? 500 : 202;
    res.status(statusCode).json({ success: execution.status !== 'failed', execution });
  } catch (err: any) {
    if ((err as Error).message?.includes('not found')) return res.status(404).json({ error: (err as Error).message });
    if ((err as Error).message?.includes('cannot execute')) return res.status(409).json({ error: (err as Error).message });
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/executions/:executionId', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const exec = automateAIService.getExecution(req.params.executionId);
  if (!exec) { res.status(404).json({ success: false, error: 'Execution not found' }); return; }
  // task-224: scope by parent workflow's org
  const parent = automateAIService.getWorkflow(exec.workflowId);
  if (!parent || String(parent.orgId) !== getOrgId(req)) {
    res.status(404).json({ success: false, error: 'Execution not found' });
    return;
  }
  res.json({ success: true, execution: exec });
});

router.get('/workflows/:workflowId/executions', (req: Request, res: Response) => {
  if (!loadOwnedWorkflow(req, res, 'read')) return;
  const limit = parseInt(String(req.query.limit ?? '20'), 10);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const executions = automateAIService.listExecutions(req.params.workflowId, limit);
  res.json({ success: true, executions, total: executions.length });
});

router.post('/executions/:executionId/approve', async (req: Request, res: Response) => {
  try {
    // task-224: ownership check via the execution's parent workflow.
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const existing = automateAIService.getExecution(req.params.executionId);
    if (!existing) { res.status(404).json({ success: false, error: 'Execution not found or not awaiting approval' }); return; }
    const parent = automateAIService.getWorkflow(existing.workflowId);
    if (!parent) { res.status(404).json({ success: false, error: 'Execution not found or not awaiting approval' }); return; }
    if (String(parent.orgId) !== getOrgId(req)) {
      res.status(403).json({ success: false, error: 'Forbidden: execution belongs to another organization' });
      return;
    }
    const user = req.user;
    const approvedBy = String(req.body?.approvedBy ?? user?.email ?? user?.id ?? 'system');
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const exec = await automateAIService.approveExecution(req.params.executionId, approvedBy);
    if (!exec) { res.status(404).json({ success: false, error: 'Execution not found or not awaiting approval' }); return; }
    res.json({ success: true, execution: exec, message: 'Execution approved and completed' });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── GATE TYPES + STATS ───────────────────────────────────────────────────────
router.get('/gate-types', (_req: Request, res: Response) => {
  res.json({ success: true, gateTypes: automateAIService.getGateTypes() });
});

router.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, ...automateAIService.getServiceStats() });
});

export default router;
