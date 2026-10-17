// /api/nv5/workflows/* — barrel router for Batch C workflow sub-routers.
//
// Two surface tiers exposed (per task-100.md step 1 + post-architect review):
//
//  (a) Canonical lifecycle endpoints at the namespace root (gated by EITHER
//      workflow flag being ON; required by task contract):
//        POST /api/nv5/workflows/start         — start engines (idempotent)
//        GET  /api/nv5/workflows/:id           — task lookup by id
//        POST /api/nv5/workflows/:id/cancel    — cancel by id
//      These are thin shims that delegate to the continuous engine (the
//      canonical task-id surface; the autonomous engine has no per-task
//      retrieval API). Strict SDK-key auth (no JWT bypass).
//
//  (b) Engine-specific sub-routers under /autonomous/* + /continuous/*,
//      each independently flag-gated. With both flags OFF the entire
//      namespace returns 404.
//
// Workflow engines are import-loaded for wiring-audit reachability but
// their background loops do NOT start at gateway boot — they start only
// when /start is POSTed by an SDK caller. The legacy boot-time auto-start
// has been REMOVED entirely from autonomous-continuous-execution-engine.ts
// (architect review — no env-based boot-start path remains).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isNyvFeatureOn, type NyvFeatureFlag } from '../../../config/jrx-feature-flags.js';
import { requireSdkKeyStrict, safeError } from '../_auth.js';
import { autonomousExecutionEngine } from '../../../packages/workflows/autonomous-continuous-execution-engine.js';
import { continuousExecutionEngine } from '../../../packages/workflows/continuous-execution-engine.js';
import autonomousRouter from './autonomous-routes.js';
import continuousRouter from './continuous-routes.js';

const router = Router();

// Always-on liveness + namespace-listing endpoints (Phase 1 audit fix
// 2026-05-11). MUST be declared BEFORE the parameterised `/:id` route so
// Express routing precedence picks them first. Returns engine-running flags
// so the console health-map can render a per-engine dot. Additive, NV-LLM-001
// inert (no provider call).
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'workflows',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      autonomous: isNyvFeatureOn('workflowAutonomous'),
      continuous: isNyvFeatureOn('workflowContinuous'),
    },
    engines: {
      autonomousRunning: autonomousExecutionEngine.isExecutionRunning?.() ?? false,
      continuousRunning: continuousExecutionEngine.isEngineRunning?.() ?? false,
    },
  });
});

// Root list — returns engine status + counts. Always 200, never 404.
router.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'workflows',
    engines: {
      autonomous: {
        flagOn: isNyvFeatureOn('workflowAutonomous'),
        running: autonomousExecutionEngine.isExecutionRunning?.() ?? false,
      },
      continuous: {
        flagOn: isNyvFeatureOn('workflowContinuous'),
        running: continuousExecutionEngine.isEngineRunning?.() ?? false,
      },
    },
    routes: {
      start:  'POST /api/nv5/workflows/start',
      get:    'GET  /api/nv5/workflows/:id',
      cancel: 'POST /api/nv5/workflows/:id/cancel',
      autonomousSubmount: '/api/nv5/workflows/autonomous/*',
      continuousSubmount: '/api/nv5/workflows/continuous/*',
    },
  });
});

const gate = (flag: NyvFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isNyvFeatureOn(flag) ? sub(req, res, next) : next();

// Root-level gate: at least one workflow flag ON for canonical lifecycle.
const anyWorkflowFlagOn = (_req: Request, _res: Response, next: NextFunction) => {
  if (isNyvFeatureOn('workflowAutonomous') || isNyvFeatureOn('workflowContinuous')) return next();
  return next('route');
};

// (a) Canonical lifecycle endpoints — task-100.md step 1 contract.
router.post('/start', anyWorkflowFlagOn, requireSdkKeyStrict, async (_req: Request, res: Response) => {
  try {
    const started: Record<string, boolean> = {};
    if (isNyvFeatureOn('workflowContinuous')) {
      await continuousExecutionEngine.start();
      started.continuous = continuousExecutionEngine.isEngineRunning();
    }
    if (isNyvFeatureOn('workflowAutonomous')) {
      await autonomousExecutionEngine.startAutonomousExecution();
      started.autonomous = autonomousExecutionEngine.isExecutionRunning();
    }
    res.json({ success: true, started });
  } catch (e) { safeError(res, e); }
});

router.get('/:id', anyWorkflowFlagOn, requireSdkKeyStrict, (req: Request, res: Response) => {
  try {
    // Continuous engine owns task-id space (autonomous engine has no
    // per-task retrieval API). Sub-namespaces (/autonomous, /continuous)
    // are excluded by Express routing precedence (literal mounts win).
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

router.post('/:id/cancel', anyWorkflowFlagOn, requireSdkKeyStrict, (req: Request, res: Response) => {
  try {
    const r = continuousExecutionEngine.cancelTask(String(req.params.id));
    if (!r.cancelled) return safeError(res, `task not found or already completed: ${req.params.id}`, 404);
    res.json({ success: true, taskId: req.params.id, ...r });
  } catch (e) { safeError(res, e); }
});

// (b) Engine-specific sub-routers (independent flag gating).
router.use('/autonomous', gate('workflowAutonomous', autonomousRouter));
router.use('/continuous', gate('workflowContinuous', continuousRouter));

export default router;
