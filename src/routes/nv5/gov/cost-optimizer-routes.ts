// /api/nv5/gov/cost-optimizer/* — admin read endpoints for the cost-
// optimization suite (prompt cache, token-budget, usage-by-user). Pure
// service — no LLM calls, no daemons. Strict SDK auth + admin scope.
import { Router, type Request, type Response } from 'express';
import { nvCostOptimizationSuite } from '../../../services/jrx-cost-optimization-suite.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/status', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      service: './jrx-cost-optimization-suite',
      capabilities: [
        'getSystemPromptCached', 'speculativeDecode', 'compressContext',
        'checkTokenBudget', 'deductTokens', 'getUserTokenUsage',
      ],
    });
  } catch (e) { safeError(res, e); }
});

router.get('/usage/:userId', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const period = (req.query.period === 'month' ? 'month' : 'day') as 'day' | 'month';
    const report = await nvCostOptimizationSuite.getUserTokenUsage(String(req.params.userId), period);
    res.json({ success: true, report });
  } catch (e) { safeError(res, e); }
});

router.get('/budget/:userId', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const estTokens = Math.max(0, parseInt(String(req.query.estimatedTokens ?? '0'), 10) || 0);
    const check = await nvCostOptimizationSuite.checkTokenBudget(String(req.params.userId), estTokens);
    res.json({ success: true, check });
  } catch (e) { safeError(res, e); }
});

export default router;
