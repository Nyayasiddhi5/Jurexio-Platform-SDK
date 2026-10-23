// /api/nv5/workflows/autonomous/* — Autonomous Continuous Execution Engine
// (JRX_F_WORKFLOW_AUTONOMOUS).
//
// Lifecycle contract (per task-100.md step 1):
//   POST /start          — explicit SDK trigger, starts the 2s/10s/5s loops
//   POST /stop           — gracefully stops loops
//   GET  /status         — returns isExecutionRunning + agent count
//   GET  /agents         — list autonomous agents + their status
//   GET  /conflicts      — current conflict-detection map
//   GET  /healing        — self-healing action history
//   POST /tasks          — submit task (agent-distributed, in-memory)
//   POST /agents/:id/pause   /  /resume
//
// The engine module no longer auto-starts at boot (architect review —
// module-load auto-start removed entirely); the singleton sits idle
// until /start is called via SDK. Routes are NV-AUTH-HEADER-001 compliant
// via requireSdkKey (strict variant — no JWT bypass) on every handler.
import { Router, type Request, type Response } from 'express';
import { autonomousExecutionEngine } from '../../../packages/workflows/autonomous-continuous-execution-engine.js';
import { requireSdkKeyStrict as requireSdkKey, safeError } from '../_auth.js';

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'autonomous-continuous-execution-engine',
    running: autonomousExecutionEngine.isExecutionRunning(),
  });
});

router.get('/status', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const agents = autonomousExecutionEngine.getAgentStatus();
    res.json({
      success: true,
      running: autonomousExecutionEngine.isExecutionRunning(),
      agentCount: agents.size,
      conflictCount: autonomousExecutionEngine.getConflictStatus().size,
      healingActionCount: autonomousExecutionEngine.getHealingHistory().size,
    });
  } catch (e) { safeError(res, e); }
});

router.post('/start', requireSdkKey, async (_req: Request, res: Response) => {
  try {
    await autonomousExecutionEngine.startAutonomousExecution();
    res.json({ success: true, running: autonomousExecutionEngine.isExecutionRunning() });
  } catch (e) { safeError(res, e); }
});

router.post('/stop', requireSdkKey, async (_req: Request, res: Response) => {
  try {
    await autonomousExecutionEngine.stopAutonomousExecution();
    res.json({ success: true, running: autonomousExecutionEngine.isExecutionRunning() });
  } catch (e) { safeError(res, e); }
});

router.get('/agents', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const agents = Array.from(autonomousExecutionEngine.getAgentStatus().values()).map(a => ({
      id: a.id, type: a.type, name: a.name, status: a.status,
      capabilities: a.capabilities, performance: a.performance,
      queueLength: a.executionQueue.length,
    }));
    res.json({ success: true, agents, count: agents.length });
  } catch (e) { safeError(res, e); }
});

router.get('/conflicts', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const conflicts = Array.from(autonomousExecutionEngine.getConflictStatus().values());
    res.json({ success: true, conflicts, count: conflicts.length });
  } catch (e) { safeError(res, e); }
});

router.get('/healing', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const actions = Array.from(autonomousExecutionEngine.getHealingHistory().values());
    res.json({ success: true, healingActions: actions, count: actions.length });
  } catch (e) { safeError(res, e); }
});

router.post('/tasks', requireSdkKey, async (req: Request, res: Response) => {
  try {
    const { type, payload, priority } = req.body ?? {};
    if (typeof type !== 'string' || !type.length) {
      return safeError(res, '`type` is required (string)', 400);
    }
    await autonomousExecutionEngine.addTask({ type, payload: payload ?? {}, priority });
    res.json({ success: true, accepted: true, type });
  } catch (e) { safeError(res, e); }
});

router.post('/agents/:id/pause', requireSdkKey, async (req: Request, res: Response) => {
  try {
    const ok = await autonomousExecutionEngine.pauseAgent(String(req.params.id));
    res.json({ success: true, paused: ok, agentId: req.params.id });
  } catch (e) { safeError(res, e); }
});

router.post('/agents/:id/resume', requireSdkKey, async (req: Request, res: Response) => {
  try {
    const ok = await autonomousExecutionEngine.resumeAgent(String(req.params.id));
    res.json({ success: true, resumed: ok, agentId: req.params.id });
  } catch (e) { safeError(res, e); }
});

export default router;
