// /api/nv5/workflows/continuous/* — Continuous Execution Engine
// (JRX_F_WORKFLOW_CONTINUOUS).
//
// Lifecycle contract (per task-100.md step 1):
//   POST /start                 — explicit SDK trigger; starts the 1s exec
//                                  loop + 10s heartbeat + 30s health-check
//   POST /stop                  — graceful shutdown
//   GET  /status                — isRunning + queued/running/completed counts
//   GET  /metrics               — full ExecutionMetrics
//   POST /tasks                 — submit a continuous task (returns id)
//   GET  /tasks/:id             — task status by id (queued/running/done)
//   POST /tasks/:id/cancel      — cancel a queued or running task
//
// The singleton is constructed at module-load time but its intervals only
// start on POST /start (no boot-time daemon). All engine introspection +
// mutation goes through public methods on ContinuousExecutionEngine
// (added Batch C per architect review NV-CONTRACT-001 — no `as any`).
import { Router, type Request, type Response } from 'express';
import { continuousExecutionEngine } from '../../../packages/workflows/continuous-execution-engine.js';
import { requireSdkKeyStrict as requireSdkKey, safeError } from '../_auth.js';

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'continuous-execution-engine',
    running: continuousExecutionEngine.isEngineRunning(),
  });
});

router.get('/status', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const s = continuousExecutionEngine.getStatus();
    res.json({ success: true, ...s });
  } catch (e) { safeError(res, e); }
});

router.get('/metrics', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const m = continuousExecutionEngine.getMetrics();
    res.json({
      success: true,
      metrics: {
        totalTasks: m.totalTasks,
        completedTasks: m.completedTasks,
        failedTasks: m.failedTasks,
        averageExecutionTime: m.averageExecutionTime,
        throughput: m.throughput,
        uptime: m.uptime,
        errorRate: m.errorRate,
        agentUtilization: Object.fromEntries(m.agentUtilization ?? new Map()),
      },
    });
  } catch (e) { safeError(res, e); }
});

router.post('/start', requireSdkKey, async (_req: Request, res: Response) => {
  try {
    await continuousExecutionEngine.start();
    res.json({ success: true, running: continuousExecutionEngine.isEngineRunning() });
  } catch (e) { safeError(res, e); }
});

router.post('/stop', requireSdkKey, async (_req: Request, res: Response) => {
  try {
    await continuousExecutionEngine.stop();
    res.json({ success: true, running: continuousExecutionEngine.isEngineRunning() });
  } catch (e) { safeError(res, e); }
});

router.post('/tasks', requireSdkKey, async (req: Request, res: Response) => {
  try {
    const { projectId, agentId, taskType, priority, payload, context, dependencies, maxRetries, estimatedDuration } = req.body ?? {};
    if (typeof projectId !== 'string' || !projectId.length) return safeError(res, '`projectId` required (string)', 400);
    if (typeof agentId !== 'string'   || !agentId.length)   return safeError(res, '`agentId` required (string)', 400);
    const allowed = ['code_generation','testing','review','deployment','analysis','design'];
    if (!allowed.includes(taskType)) return safeError(res, `\`taskType\` must be one of ${allowed.join('|')}`, 400);
    const id = await continuousExecutionEngine.submitTask({
      projectId, agentId, taskType, priority, payload, context,
      dependencies, maxRetries, estimatedDuration,
    });
    res.json({ success: true, taskId: id, status: 'queued' });
  } catch (e) { safeError(res, e); }
});

router.get('/tasks/:id', requireSdkKey, (req: Request, res: Response) => {
  try {
    const t = continuousExecutionEngine.getTaskById(String(req.params.id));
    if (!t) return safeError(res, `task not found: ${req.params.id}`, 404);
    res.json({
      success: true,
      task: {
        id: t.id, projectId: t.projectId, agentId: t.agentId,
        taskType: t.taskType, priority: t.priority, status: t.status,
        retryCount: t.retryCount, maxRetries: t.maxRetries,
        createdAt: t.createdAt, startedAt: t.startedAt, completedAt: t.completedAt,
        actualDuration: t.actualDuration,
        checkpointCount: t.checkpoints?.length ?? 0,
      },
    });
  } catch (e) { safeError(res, e); }
});

router.post('/tasks/:id/cancel', requireSdkKey, (req: Request, res: Response) => {
  try {
    const r = continuousExecutionEngine.cancelTask(String(req.params.id));
    if (!r.cancelled) return safeError(res, `task not found or already completed: ${req.params.id}`, 404);
    res.json({ success: true, taskId: req.params.id, ...r });
  } catch (e) { safeError(res, e); }
});

export default router;
