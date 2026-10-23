// /api/nv5/orch/roma/* — ROMA L5 governance pipeline introspection.
//
// Session-10 Batch A. NV-LLM-001 honored: read-only audit trail +
// performance store + outcome track (write but no LLM emission). The
// previous /governance/run endpoint was dropped because
// `runGovernancePipeline` invokes private subsystems (registryOptimizer,
// policyEngine, adaptiveLearning) that may chain to LLM calls.
import { Router, type Request, type Response } from 'express';
import { romaL5Engine } from '../packages/protocols/roma/roma-l5-engine.js';
import { requireSdkKey, safeError } from './_nv5-orch-auth.js';

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'roma-l5-engine' });
});

router.post('/outcome/track', (req: Request, res: Response) => {
  try {
    const { agentId, outcome } = req.body || {};
    if (!agentId || !outcome) return safeError(res, 'agentId and outcome required', 400);
    romaL5Engine.trackOutcome(agentId, outcome);
    res.json({ success: true });
  } catch (e) { safeError(res, e); }
});

router.get('/audit-trail', (_req: Request, res: Response) => {
  try {
    const trail = romaL5Engine.getAuditTrail();
    res.json({ success: true, auditTrail: trail, count: trail.length });
  } catch (e) { safeError(res, e); }
});

router.get('/performance-store', async (_req: Request, res: Response) => {
  try {
    await romaL5Engine.hydrate();
    const store = romaL5Engine.getPerformanceStore();
    res.json({
      success: true,
      performanceStore: store,
      keys: Object.keys(store).length,
      persisted: true,
    });
  } catch (e) { safeError(res, e); }
});

export default router;
